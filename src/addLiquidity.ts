import { formatUnits, encodeFunctionData } from 'viem';
import { getContract } from 'viem';
import * as dotenv from 'dotenv';
import { getChainConfig, liquidityDefaults, type ChainConfig } from './config/chains';
import { ContractClient } from './utils/contracts';
import {
  calculateTickBounds,
  encodeSqrtPriceX96,
  sortTokens,
  calculateMinAmounts,
  calculateTokenAmountsForLiquidity,
  calculateTotalCollateralNeeded,
  getTickSpacing
} from './utils/dex';
import {
  algebraPositionManagerABI,
  uniswapV3PositionManagerABI
} from './config/abis';
import { RetryConfig, TimeConstants } from './config/retry';

dotenv.config();

/**
 * Calculate complementary ranges for Down and Up pools
 * For a given range [min, max], creates:
 * - Down pool: [min, max] with initial price (min + max) / 2
 * - Up pool: [1-max, 1-min] with initial price (1-max + 1-min) / 2
 */
function calculateComplementaryRanges(minPrice: number, maxPrice: number): PoolRangeConfig[] {
  // Validate input range
  if (minPrice >= maxPrice || minPrice < 0 || maxPrice > 1) {
    throw new Error(`Invalid price range: [${minPrice}, ${maxPrice}]. Must be 0 <= min < max <= 1`);
  }
  
  // Up pool uses the original range (swapped from previous logic)
  const upRange: PoolRangeConfig = {
    poolIndex: 1,
    minPrice: minPrice,
    maxPrice: maxPrice,
    initialPrice: (minPrice + maxPrice) / 2,
    poolName: 'Up'
  };
  
  // Down pool uses the complement range: [1-max, 1-min] (swapped from previous logic)
  const downMinPrice = 1 - maxPrice;
  const downMaxPrice = 1 - minPrice;
  const downRange: PoolRangeConfig = {
    poolIndex: 0,
    minPrice: downMinPrice,
    maxPrice: downMaxPrice,
    initialPrice: (downMinPrice + downMaxPrice) / 2,
    poolName: 'Down'
  };
  
  console.log(`\n📊 Calculated complementary ranges:`);
  console.log(`  Down pool: [${downRange.minPrice.toFixed(3)}, ${downRange.maxPrice.toFixed(3)}] with initial price ${downRange.initialPrice.toFixed(3)}`);
  console.log(`  Up pool:   [${upRange.minPrice.toFixed(3)}, ${upRange.maxPrice.toFixed(3)}] with initial price ${upRange.initialPrice.toFixed(3)}`);
  console.log(`  Sum check: ${downRange.initialPrice.toFixed(3)} + ${upRange.initialPrice.toFixed(3)} = ${(downRange.initialPrice + upRange.initialPrice).toFixed(3)} (should be ~1.0)`);
  
  return [downRange, upRange];
}

interface LiquidityParams {
  marketAddress: `0x${string}`;
  collateralAmount: bigint;
  minPrice?: number;
  maxPrice?: number;
  slippageTolerance?: number;
  chainId?: number;
}

interface PoolRangeConfig {
  poolIndex: number;
  minPrice: number;
  maxPrice: number;
  initialPrice: number;
  poolName: string;
}

interface PoolAnalysis {
  wrappedToken: `0x${string}`;
  collateralToken: `0x${string}`;
  poolAddress: `0x${string}` | null;
  exists: boolean;
  currentTick?: number;
  tickLower: number;
  tickUpper: number;
  tickSpacing?: number;
  isToken0Outcome: boolean;
  collateralNeeded: bigint;
  outcomeNeeded: bigint;
  amount0: bigint;
  amount1: bigint;
}

export async function addLiquidity({
  marketAddress,
  collateralAmount,
  minPrice,
  maxPrice,
  slippageTolerance,
  chainId = 8453 // Default to Base
}: LiquidityParams): Promise<void> {
  const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY not found in environment variables');
  }

  const rpcUrl = process.env.RPC_URL;
  
  // Get fee tier from environment or use default 0.01% (100 basis points)
  const feeTier = process.env.FEE_TIER ? Number(process.env.FEE_TIER) : 100;

  // Get chain configuration
  const config = getChainConfig(chainId);
  const client = new ContractClient(config, privateKey, rpcUrl);

  // Use defaults from config if not provided
  const priceMin = minPrice ?? liquidityDefaults.minPrice;
  const priceMax = maxPrice ?? liquidityDefaults.maxPrice;
  const slippage = slippageTolerance ?? liquidityDefaults.slippageTolerance;

  console.log(`\nAdding liquidity on ${config.chain.name}`);
  console.log(`Market: ${marketAddress}`);
  console.log(`Amount: ${formatUnits(collateralAmount, 18)} collateral per pool`);
  console.log(`Price range: ${priceMin} - ${priceMax}`);
  console.log(`Slippage tolerance: ${slippage * 100}%`);

  try {
    // Get market information from contract
    console.log('\n1. Fetching market information...');
    const marketInfo = await client.executeWithRetry(
      () => client.getMarketInfo(marketAddress),
      3,
      2000
    );
    const collateralDecimals = await client.getTokenDecimals(marketInfo.collateralToken);

    console.log(`  Condition ID: ${marketInfo.conditionId}`);
    console.log(`  Wrapped tokens: ${marketInfo.wrappedTokens.join(', ')}`);

    // Calculate complementary ranges for Down and Up pools
    const poolRanges = calculateComplementaryRanges(priceMin, priceMax);
    
    // Analyze pools and calculate requirements
    console.log('\n2. Analyzing pools and calculating token requirements...');
    const poolAnalyses: PoolAnalysis[] = [];
    let totalCollateralNeeded = 0n;
    let totalOutcomeNeeded: bigint[] = [];
    
    // Analyze first 2 pools (skip invalid result token) with their respective ranges
    for (let i = 0; i < Math.min(2, marketInfo.wrappedTokens.length - 1); i++) {
      const wrappedToken = marketInfo.wrappedTokens[i];
      const poolRange = poolRanges[i];
      console.log(`\n  Analyzing ${poolRange.poolName} pool (${i + 1}) for token ${wrappedToken}...`);
      console.log(`    Range: [${poolRange.minPrice.toFixed(3)}, ${poolRange.maxPrice.toFixed(3)}] with initial price ${poolRange.initialPrice.toFixed(3)}`);
      
      // Sort tokens to get correct pool order
      const [token0, token1] = sortTokens(wrappedToken, marketInfo.collateralToken);
      const isToken0Outcome = token0 === wrappedToken;
      
      // Check if pool exists with specified fee tier
      const poolAddress = await client.executeWithRetry(
        () => client.getPool(token0, token1, feeTier),
        3,
        1000
      );
      
      let analysis: PoolAnalysis;
      
      if (!poolAddress) {
        // Pool doesn't exist - we'll create it at midpoint price
        console.log(`    Pool does not exist, will create at midpoint price`);
        
        // Get proper tick spacing based on fee tier
        const tickSpacing = getTickSpacing(feeTier, config);
        const { tickLower, tickUpper } = calculateTickBounds(
          poolRange.minPrice,
          poolRange.maxPrice,
          tickSpacing,
          isToken0Outcome
        );
        
        // For new pool, calculate amounts based on expected initial tick
        const midPrice = poolRange.initialPrice;
        
        // Calculate expected initial tick from the midpoint price
        const initialPriceToken1PerToken0 = isToken0Outcome
          ? midPrice              // token1 is collateral, token0 is outcome
          : 1 / midPrice;         // token1 is outcome, token0 is collateral
        
        // Convert price to tick (approximate)
        const expectedTick = Math.floor(Math.log(initialPriceToken1PerToken0) / Math.log(1.0001));
        
        // Get token decimals for proper calculation
        const decimals0 = await client.getTokenDecimals(token0);
        const decimals1 = await client.getTokenDecimals(token1);
        
        // Use the proper liquidity calculation for new pools
        const { amount0, amount1, collateralNeeded, outcomeNeeded } = calculateTokenAmountsForLiquidity(
          expectedTick,
          tickLower,
          tickUpper,
          collateralAmount,
          isToken0Outcome,
          tickSpacing,
          config.chain.id,
          feeTier,
          decimals0,
          decimals1
        );
        
        analysis = {
          wrappedToken,
          collateralToken: marketInfo.collateralToken,
          poolAddress: null,
          exists: false,
          tickLower,
          tickUpper,
          tickSpacing,
          isToken0Outcome,
          collateralNeeded,
          outcomeNeeded,
          amount0,
          amount1
        };
      } else {
        // Pool exists - calculate based on current price
        console.log(`    Pool exists at ${poolAddress}`);
        
        const poolState = await client.executeWithRetry(
          () => client.getPoolState(poolAddress),
          3,
          1000
        );
        
        console.log(`    Current tick: ${poolState.tick}`);
        console.log(`    Current liquidity: ${formatUnits(poolState.liquidity, 18)}`);
        
        // Compute bounds in both token orientations and pick the one containing currentTick
        const boundsOutcomeAsT0 = calculateTickBounds(
          poolRange.minPrice,
          poolRange.maxPrice,
          poolState.tickSpacing,
          /* isToken0Outcome */ true
        );
        const boundsOutcomeAsT1 = calculateTickBounds(
          poolRange.minPrice,
          poolRange.maxPrice,
          poolState.tickSpacing,
          /* isToken0Outcome */ false
        );

        let chosenIsToken0Outcome = isToken0Outcome;
        let bounds = isToken0Outcome ? boundsOutcomeAsT0 : boundsOutcomeAsT1;

        const containsTick = (b: {tickLower:number; tickUpper:number}) => poolState.tick > b.tickLower && poolState.tick < b.tickUpper;

        if (!containsTick(bounds)) {
          const alt = isToken0Outcome ? boundsOutcomeAsT1 : boundsOutcomeAsT0;
          if (containsTick(alt)) {
            console.log(`    Switched token orientation to include current price: [${alt.tickLower}, ${alt.tickUpper}]`);
            bounds = alt;
            chosenIsToken0Outcome = !isToken0Outcome;
          } else {
            console.log(`    Current tick not inside either orientation bounds; proceeding with default.`);
          }
        }
        
        // Use real token decimals to avoid amount mis-scaling
        const decimals0 = await client.getTokenDecimals(token0);
        const decimals1 = await client.getTokenDecimals(token1);
        const { amount0, amount1, collateralNeeded, outcomeNeeded } = calculateTokenAmountsForLiquidity(
          poolState.tick,
          bounds.tickLower,
          bounds.tickUpper,
          collateralAmount,
          chosenIsToken0Outcome,
          poolState.tickSpacing,
          config.chain.id,
          feeTier,
          decimals0,
          decimals1
        );
        
        // Sort tokens again if orientation flipped
        const useOutcomeAsT0 = chosenIsToken0Outcome;
        const [finalToken0, finalToken1] = useOutcomeAsT0 ? sortTokens(wrappedToken, marketInfo.collateralToken) : sortTokens(marketInfo.collateralToken, wrappedToken);
        
        analysis = {
          wrappedToken,
          collateralToken: marketInfo.collateralToken,
          poolAddress,
          exists: true,
          currentTick: poolState.tick,
          tickLower: bounds.tickLower,
          tickUpper: bounds.tickUpper,
          isToken0Outcome: chosenIsToken0Outcome,
          collateralNeeded,
          outcomeNeeded,
          amount0,
          amount1
        };

        // Override tokens in the outer scope to match the chosen orientation for approvals and mint
        (analysis as any).token0 = finalToken0;
        (analysis as any).token1 = finalToken1;
      }
      
      poolAnalyses.push(analysis);
      totalCollateralNeeded += analysis.collateralNeeded;
      totalOutcomeNeeded.push(analysis.outcomeNeeded);
      
      console.log(`    Collateral needed: ${formatUnits(analysis.collateralNeeded, collateralDecimals)}`);
      console.log(`    Outcome needed: ${formatUnits(analysis.outcomeNeeded, 18)}`); // Outcome tokens always 18 decimals
    }
    
    console.log(`\n  Total collateral needed: ${formatUnits(totalCollateralNeeded, collateralDecimals)}`);
    
    // Check collateral balance
    console.log('\n3. Checking collateral balance...');
    const collateralBalance = await client.getTokenBalance(
      marketInfo.collateralToken, 
      client.account.address
    );
    
    if (collateralBalance < totalCollateralNeeded) {
      const decimals = await client.getTokenDecimals(marketInfo.collateralToken);
      throw new Error(
        `Insufficient collateral balance. Required: ${formatUnits(totalCollateralNeeded, decimals)}, Available: ${formatUnits(collateralBalance, decimals)}`
      );
    }
    console.log(`  ✓ Sufficient collateral balance: ${formatUnits(collateralBalance, collateralDecimals)}`);

    // Split only the amount needed
    const maxOutcomeNeeded = totalOutcomeNeeded.reduce((max, curr) => curr > max ? curr : max, 0n);
    if (maxOutcomeNeeded > 0n) {
      console.log('\n4. Splitting collateral into outcome tokens...');
      console.log(`  Splitting ${formatUnits(maxOutcomeNeeded, collateralDecimals)} collateral`);
      
      const splitTx = await client.splitPosition(
        marketAddress, 
        maxOutcomeNeeded,
        marketInfo.collateralToken
      );
      await client.waitForTransaction(splitTx);
      console.log(`  ✓ Split transaction: ${config.explorerUrl}/tx/${splitTx}`);
      
      // Wait for state to update after split
      await new Promise(resolve => setTimeout(resolve, RetryConfig.POST_SPLIT_DELAY));
      
      // Verify outcome tokens are available after split
      console.log('  Verifying outcome token balances after split...');
      for (let i = 0; i < poolAnalyses.length; i++) {
        const analysis = poolAnalyses[i];
        if (analysis.outcomeNeeded > 0n) {
          await client.executeWithRetry(
            async () => {
              const balance = await client.getTokenBalance(
                analysis.wrappedToken,
                client.account.address
              );
              if (balance < analysis.outcomeNeeded) {
                throw new Error(
                  `Insufficient outcome token balance after split. Required: ${formatUnits(analysis.outcomeNeeded, 18)}, Available: ${formatUnits(balance, 18)}`
                );
              }
              console.log(`    ✓ ${analysis.wrappedToken.slice(0, 8)}... balance: ${formatUnits(balance, 18)}`);
              return balance;
            },
            5, // More retries for balance verification
            2000 // Longer delay between retries
          );
        }
      }
    } else {
      console.log('\n4. No split needed (pools out of range or already have outcome tokens)');
    }

    // Add liquidity to pools using calculated amounts
    console.log('\n5. Adding liquidity to pools...');
    for (let i = 0; i < poolAnalyses.length; i++) {
      const analysis = poolAnalyses[i];
      
      console.log(`\n  Pool ${i + 1}:`);
      
      if (i > 0) {
        console.log('  Waiting before processing next pool...');
        await client.delay(RetryConfig.POOL_PROCESSING_DELAY);
      }
      
      // Create pool if it doesn't exist
      if (!analysis.exists) {
        await createAndAddLiquidity(
          client,
          config,
          analysis,
          poolRanges[i].minPrice,
          poolRanges[i].maxPrice,
          slippage,
          feeTier
        );
      } else {
        await addLiquidityToExistingPool(
          client,
          config,
          analysis,
          slippage,
          feeTier
        );
      }
    }

    console.log('\n✅ Liquidity added successfully!');
  } catch (error) {
    console.error('Error adding liquidity:', error);
    throw error;
  }
}

async function createAndAddLiquidity(
  client: ContractClient,
  config: ChainConfig,
  analysis: PoolAnalysis,
  minPrice: number,
  maxPrice: number,
  slippageTolerance: number,
  feeTier: number
): Promise<void> {
  const { wrappedToken, collateralToken } = analysis;
  
  // Sort tokens to get correct order
  const [token0, token1] = sortTokens(wrappedToken, collateralToken);
  
  console.log('    Creating new pool...');
  
  // Calculate initial price (midpoint of range) in terms of token1 per token0
  // IMPORTANT: Uniswap/Algebra expect price = token1/token0.
  // Our min/max are expressed as collateral per outcome when token0 is outcome;
  // if token0 is collateral, we must invert.
  const midpointCollateralPerOutcome = (minPrice + maxPrice) / 2;
  const isToken0Outcome = analysis.isToken0Outcome; // determined earlier from sorted addresses
  const initialPriceToken1PerToken0 = isToken0Outcome
    ? midpointCollateralPerOutcome              // token1 is collateral, token0 is outcome
    : 1 / midpointCollateralPerOutcome;         // token1 is outcome, token0 is collateral
  console.log(`    Initial price (token1/token0): ${initialPriceToken1PerToken0.toFixed(6)}`);
  
  // Get decimals for both tokens
  const decimals0 = await client.getTokenDecimals(token0);
  const decimals1 = await client.getTokenDecimals(token1);
  
  const sqrtPriceX96 = encodeSqrtPriceX96(initialPriceToken1PerToken0, decimals0, decimals1);
  
  // Create pool with specified fee tier
  const createTx = await client.createPool(token0, token1, sqrtPriceX96, feeTier);
  await client.waitForTransaction(createTx);
  console.log(`    ✓ Pool created: ${config.explorerUrl}/tx/${createTx}`);
  
  // Wait for chain state to update after pool creation
  await client.delay(RetryConfig.POOL_CREATION_DELAY);
  
  // Get the pool address with specified fee tier
  const poolAddress = await client.executeWithRetry(
    () => client.getPool(token0, token1, feeTier),
    3,
    1000
  );
  
  if (!poolAddress) {
    throw new Error('Failed to create pool');
  }
  
  console.log(`    Pool address: ${poolAddress}`);
  
  // Get actual pool state after creation
  const poolState = await client.executeWithRetry(
    () => client.getPoolState(poolAddress),
    3,
    1000
  );
  
  console.log(`    Pool created with tick: ${poolState.tick}`);
  
  // Use the original amounts that were calculated and split
  // Don't recalculate as this can lead to mismatches with available tokens
  console.log(`    Using original calculated amounts:`);
  console.log(`      Token0: ${formatUnits(analysis.amount0, 18)}`);
  console.log(`      Token1: ${formatUnits(analysis.amount1, 18)}`);

  await addLiquidityToExistingPool(client, config, {
    ...analysis,
    poolAddress,
    exists: true,
    currentTick: poolState.tick,
    // Keep original amounts instead of recalculating
    amount0: analysis.amount0,
    amount1: analysis.amount1
  }, slippageTolerance, feeTier);
}

async function addLiquidityToExistingPool(
  client: ContractClient,
  config: ChainConfig,
  analysis: PoolAnalysis,
  slippageTolerance: number,
  feeTier: number
): Promise<void> {
  const { 
    wrappedToken, 
    collateralToken,
    poolAddress, 
    amount0, 
    amount1, 
    tickLower, 
    tickUpper, 
    currentTick 
  } = analysis;
  
  if (!poolAddress) {
    throw new Error('Pool address is required for existing pool');
  }
  
  const [token0, token1] = sortTokens(wrappedToken, collateralToken);
  
  console.log(`    Pool address: ${poolAddress}`);
  console.log(`    Tick range: [${tickLower}, ${tickUpper}]`);
  console.log(`    Adding liquidity with amounts:`);
  console.log(`      Token0: ${formatUnits(amount0, 18)}`);
  console.log(`      Token1: ${formatUnits(amount1, 18)}`); // Pool tokens are always 18 decimals

  // Calculate minimum amounts with slippage protection
  // For new pools, use higher slippage tolerance to account for initialization variance
  const isNewPool = !analysis.exists;
  const effectiveSlippage = isNewPool ? Math.max(slippageTolerance, 0.05) : slippageTolerance;
  const { amount0Min, amount1Min } = calculateMinAmounts(
    amount0,
    amount1,
    effectiveSlippage
  );
  
  if (isNewPool) {
    console.log(`    Using increased slippage tolerance for new pool: ${(effectiveSlippage * 100).toFixed(1)}%`);
  }

  // Approve tokens sequentially with delays to avoid rate limits
  console.log('    Approving tokens...');
  
  const approve0Tx = await client.executeWithRetry(
    () => client.approveToken(token0, config.contracts.dexPositionManager, amount0),
    RetryConfig.DEFAULT_RETRIES,
    RetryConfig.DEFAULT_DELAY
  );
  await client.waitForTransaction(approve0Tx);
  console.log('    ✓ Token0 approved');
  
  // Minimal delay between approvals
  await client.delay(RetryConfig.OPERATION_DELAY);
  
  const approve1Tx = await client.executeWithRetry(
    () => client.approveToken(token1, config.contracts.dexPositionManager, amount1),
    RetryConfig.DEFAULT_RETRIES,
    RetryConfig.DEFAULT_DELAY
  );
  await client.waitForTransaction(approve1Tx);
  console.log('    ✓ Token1 approved');

  // Add liquidity
  console.log('    Adding liquidity...');
  
  // Minimal delay before minting
  await client.delay(RetryConfig.OPERATION_DELAY);
  
  // Verify token balances before minting
  console.log('    Verifying token balances before mint...');
  const balance0 = await client.getTokenBalance(token0, client.account.address);
  const balance1 = await client.getTokenBalance(token1, client.account.address);
  
  if (balance0 < amount0) {
    throw new Error(
      `Insufficient token0 balance. Required: ${formatUnits(amount0, 18)}, Available: ${formatUnits(balance0, 18)}`
    );
  }
  if (balance1 < amount1) {
    throw new Error(
      `Insufficient token1 balance. Required: ${formatUnits(amount1, 18)}, Available: ${formatUnits(balance1, 18)}`
    );
  }
  console.log(`    ✓ Token balances verified`);
  
  // Use appropriate ABI based on chain
  const positionManagerAbi = config.chain.id === 100 
    ? algebraPositionManagerABI 
    : uniswapV3PositionManagerABI;
    
  const positionManager = getContract({
    address: config.contracts.dexPositionManager,
    abi: positionManagerAbi as any,
    client: client.walletClient
  });
  
  // Check if we're providing single-sided liquidity
  const isSingleSided = amount0 === 0n || amount1 === 0n;
  if (isSingleSided && currentTick !== undefined) {
    if (currentTick < tickLower) {
      console.log(`    Current tick (${currentTick}) is below range, providing only token0`);
    } else if (currentTick >= tickUpper) {
      console.log(`    Current tick (${currentTick}) is above range, providing only token1`);
    }
  }
  
  // Prepare mint params based on chain type
  const mintParams = config.chain.id === 100 ? {
    // Algebra/Swapr format (tuple)
    token0,
    token1,
    tickLower,
    tickUpper,
    amount0Desired: amount0,
    amount1Desired: amount1,
    amount0Min: isSingleSided ? 0n : amount0Min,
    amount1Min: isSingleSided ? 0n : amount1Min,
    recipient: client.account.address,
    deadline: BigInt(Math.floor(Date.now() / 1000) + TimeConstants.DEADLINE_BUFFER_SECONDS)
  } : {
    // Uniswap V3 format (includes fee)
    token0,
    token1,
    fee: feeTier,
    tickLower,
    tickUpper,
    amount0Desired: amount0,
    amount1Desired: amount1,
    amount0Min: isSingleSided ? 0n : amount0Min,
    amount1Min: isSingleSided ? 0n : amount1Min,
    recipient: client.account.address,
    deadline: BigInt(Math.floor(Date.now() / 1000) + TimeConstants.DEADLINE_BUFFER_SECONDS)
  };

  // Estimate gas for mint operation
  console.log('    Estimating gas for liquidity addition...');
  try {
    const mintArgs = [mintParams];
    const gasEstimate = await positionManager.estimateGas.mint(mintArgs, {
      account: client.account
    });
    console.log(`    Estimated gas: ${gasEstimate.toString()}`);
    const gasPrice = await client.publicClient.getGasPrice();
    const estimatedCost = gasEstimate * gasPrice;
    console.log(`    Estimated cost: ${formatUnits(estimatedCost, 18)} ETH`);
  } catch (error) {
    console.log('    Warning: Could not estimate gas');
  }

  const mintArgs = [mintParams];
  const mintTx = await client.executeWithRetry(
    async () => positionManager.write.mint(mintArgs, {
      account: client.account,
      chain: config.chain
    }),
    RetryConfig.DEFAULT_RETRIES,
    RetryConfig.DEFAULT_DELAY
  );

  await client.waitForTransaction(mintTx);
  console.log(`    ✓ Liquidity added: ${config.explorerUrl}/tx/${mintTx}`);
}

// Function to check collateral solvency for multiple markets
export async function checkCollateralSolvency(
  markets: Array<{marketAddress: `0x${string}`, collateralAmount: bigint}>,
  chainId: number = 8453,
  minPrice: number = liquidityDefaults.minPrice,
  maxPrice: number = liquidityDefaults.maxPrice
): Promise<{issolvent: boolean, totalNeeded: bigint, available: bigint, collateralToken: `0x${string}`}> {
  const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY not found in environment variables');
  }

  const rpcUrl = process.env.RPC_URL;
  const config = getChainConfig(chainId);
  const client = new ContractClient(config, privateKey, rpcUrl);

  console.log('\n📊 Analyzing collateral requirements for all markets...');
  
  let totalCollateralNeeded = 0n;
  let collateralToken: `0x${string}` | null = null;
  let collateralDecimals: number = 18;

  for (const {marketAddress, collateralAmount} of markets) {
    console.log(`\n  Analyzing market: ${marketAddress}`);
    
    // Get market information
    const marketInfo = await client.executeWithRetry(
      () => client.getMarketInfo(marketAddress),
      3,
      2000
    );

    // Verify all markets use the same collateral token
    if (collateralToken === null) {
      collateralToken = marketInfo.collateralToken;
      collateralDecimals = await client.getTokenDecimals(collateralToken);
    } else if (collateralToken !== marketInfo.collateralToken) {
      throw new Error(`Markets use different collateral tokens: ${collateralToken} vs ${marketInfo.collateralToken}`);
    }

    // Calculate complementary ranges for this market
    const poolRanges = calculateComplementaryRanges(minPrice, maxPrice);
    
    // Calculate requirements for each pool in this market (first 2 pools)
    let marketCollateralNeeded = 0n;
    
    for (let i = 0; i < Math.min(2, marketInfo.wrappedTokens.length - 1); i++) {
      const wrappedToken = marketInfo.wrappedTokens[i];
      const poolRange = poolRanges[i];
      const [token0, token1] = sortTokens(wrappedToken, marketInfo.collateralToken);
      const isToken0Outcome = token0 === wrappedToken;
      
      // Use default fee tier for solvency check (0.01%)
      const feeTier = 100;
      const poolAddress = await client.executeWithRetry(
        () => client.getPool(token0, token1, feeTier),
        3,
        1000
      );
      
      if (!poolAddress) {
        // New pool - use the calculated initial price for this specific pool
        const midPrice = poolRange.initialPrice;
        const collateralForPool = collateralAmount * BigInt(Math.floor(midPrice * 1000)) / 1000n;
        marketCollateralNeeded += collateralForPool;
      } else {
        // Existing pool - calculate based on current tick
        const poolState = await client.executeWithRetry(
          () => client.getPoolState(poolAddress),
          3,
          1000
        );
        
        const tickSpacing = getTickSpacing(feeTier, config);
        const { tickLower, tickUpper } = calculateTickBounds(
          poolRange.minPrice,
          poolRange.maxPrice,
          poolState.tickSpacing || tickSpacing,
          isToken0Outcome
        );
        
        const { collateralNeeded } = calculateTokenAmountsForLiquidity(
          poolState.tick,
          tickLower,
          tickUpper,
          collateralAmount,
          isToken0Outcome,
          poolState.tickSpacing || tickSpacing,
          config.chain.id,
          feeTier
        );
        
        marketCollateralNeeded += collateralNeeded;
      }
    }
    
    totalCollateralNeeded += marketCollateralNeeded;
    console.log(`    Collateral needed: ${formatUnits(marketCollateralNeeded, collateralDecimals)}`);
  }

  if (!collateralToken) {
    throw new Error('No valid markets found');
  }

  // Check user's collateral balance
  const collateralBalance = await client.getTokenBalance(
    collateralToken,
    client.account.address
  );

  console.log(`\n📊 Solvency Check Summary:`);
  console.log(`  Total collateral needed: ${formatUnits(totalCollateralNeeded, collateralDecimals)}`);
  console.log(`  Available collateral: ${formatUnits(collateralBalance, collateralDecimals)}`);
  
  const issolvent = collateralBalance >= totalCollateralNeeded;
  
  if (!issolvent) {
    const shortfall = totalCollateralNeeded - collateralBalance;
    console.log(`  ❌ INSUFFICIENT: Need ${formatUnits(shortfall, collateralDecimals)} more collateral`);
  } else {
    const excess = collateralBalance - totalCollateralNeeded;
    console.log(`  ✅ SUFFICIENT: ${formatUnits(excess, collateralDecimals)} excess collateral`);
  }

  return {
    issolvent,
    totalNeeded: totalCollateralNeeded,
    available: collateralBalance,
    collateralToken
  };
}

// Export for use in other modules
export type { LiquidityParams };

// Main entry point when running as a script
