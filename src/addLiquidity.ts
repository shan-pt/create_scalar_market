import { formatUnits, encodeFunctionData } from 'viem';
import { getContract } from 'viem';
import * as dotenv from 'dotenv';
import { getChainConfig, liquidityDefaults, type ChainConfig } from './config/chains';
import { ContractClient } from './utils/contracts';
import {
  calculateTickBounds,
  encodeSqrtPriceX96,
  sortTokens,
  calculateMinAmounts
} from './utils/dex';
import {
  algebraPositionManagerABI,
  uniswapV3PositionManagerABI
} from './config/abis';
import { RetryConfig } from './config/retry';

dotenv.config();

interface LiquidityParams {
  marketAddress: `0x${string}`;
  collateralAmount: bigint;
  minPrice?: number;
  maxPrice?: number;
  slippageTolerance?: number;
  chainId?: number;
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

  // Get chain configuration
  const config = getChainConfig(chainId);
  const client = new ContractClient(config, privateKey, rpcUrl);

  // Use defaults from config if not provided
  const priceMin = minPrice ?? liquidityDefaults.minPrice;
  const priceMax = maxPrice ?? liquidityDefaults.maxPrice;
  const slippage = slippageTolerance ?? liquidityDefaults.slippageTolerance;

  console.log(`\nAdding liquidity on ${config.chain.name}`);
  console.log(`Market: ${marketAddress}`);
  console.log(`Amount: ${formatUnits(collateralAmount, 18)} collateral`);
  console.log(`Price range: ${priceMin} - ${priceMax}`);
  console.log(`Slippage tolerance: ${slippage * 100}%`);

  try {
    // Get market information from contract instead of subgraph
    console.log('\n1. Fetching market information...');
    const marketInfo = await client.executeWithRetry(
      () => client.getMarketInfo(marketAddress),
      3,
      2000
    );

    console.log(`  Condition ID: ${marketInfo.conditionId}`);
    console.log(`  Wrapped tokens: ${marketInfo.wrappedTokens.join(', ')}`);

    // Check collateral balance before attempting split
    console.log('\n2. Checking collateral balance...');
    const collateralBalance = await client.getTokenBalance(
      marketInfo.collateralToken, 
      client.account.address
    );
    
    if (collateralBalance < collateralAmount) {
      const decimals = await client.getTokenDecimals(marketInfo.collateralToken);
      throw new Error(
        `Insufficient collateral balance. Required: ${formatUnits(collateralAmount, decimals)}, Available: ${formatUnits(collateralBalance, decimals)}`
      );
    }
    console.log(`  ✓ Sufficient collateral balance: ${formatUnits(collateralBalance, 18)}`);

    // Split collateral into outcome tokens
    console.log('\n3. Splitting collateral into outcome tokens...');
    const splitTx = await client.splitPosition(
      marketAddress, 
      collateralAmount,
      marketInfo.collateralToken
    );
    await client.waitForTransaction(splitTx);
    console.log(`  ✓ Split transaction: ${config.explorerUrl}/tx/${splitTx}`);

    // Wait a bit for state to update
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get balances sequentially with delays to avoid rate limits
    const balances: bigint[] = [];
    for (const token of marketInfo.wrappedTokens) {
      const balance = await client.getTokenBalance(token, client.account.address);
      balances.push(balance);
      await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay between calls
    }
    
    const decimals = await client.getTokenDecimals(marketInfo.wrappedTokens[0]);
    
    console.log(`  Outcome token balances: ${balances.map(b => formatUnits(b, decimals)).join(', ')}`);

    // Add liquidity to both pools
    console.log('\n4. Adding liquidity to pools...');
    // skipping last wrappedToken which is invalid result
    for (let i = 0; i < marketInfo.wrappedTokens.length - 1; i++) {
      const wrappedToken = marketInfo.wrappedTokens[i];
      const balance = balances[i];

      if (balance === 0n) {
        console.log(`  ⚠ No balance for token ${i}, skipping...`);
        continue;
      }

      console.log(`\n  Pool ${i + 1}:`);
      
      // Add delay between processing pools to avoid rate limits
      if (i > 0) {
        console.log('  Waiting before processing next pool...');
        await client.delay(1500);
      }
      
      await addLiquidityToPool(
        client,
        config,
        wrappedToken,
        marketInfo.collateralToken,
        balance,
        balance, // Use equal amounts for now
        priceMin,
        priceMax,
        slippage
      );
    }

    console.log('\n✅ Liquidity added successfully!');
  } catch (error) {
    console.error('Error adding liquidity:', error);
    throw error;
  }
}

async function addLiquidityToPool(
  client: ContractClient,
  config: ChainConfig,
  tokenA: `0x${string}`,
  tokenB: `0x${string}`,
  amountA: bigint,
  amountB: bigint,
  minPrice: number,
  maxPrice: number,
  slippageTolerance: number,
  fee?: number
): Promise<void> {
  // Sort tokens to get correct pool order
  const [token0, token1] = sortTokens(tokenA, tokenB);
  // tokenA is the outcome token, tokenB is the collateral token
  const isToken0Outcome = token0 === tokenA;

  // Determine amounts based on token order
  const amount0 = token0 === tokenA ? amountA : amountB;
  const amount1 = token0 === tokenA ? amountB : amountA;

  // Check if pool exists with retry logic
  let poolAddress = await client.executeWithRetry(
    () => client.getPool(token0, token1, fee),
    RetryConfig.RATE_LIMIT_RETRIES,
    RetryConfig.RATE_LIMIT_DELAY
  );

  if (!poolAddress) {
    console.log('    Pool does not exist, creating...');

    // Calculate initial price (0.5 for equal probability)
    const sqrtPriceX96 = encodeSqrtPriceX96(0.5, 18, 18);

    // Estimate gas for pool creation
    console.log('    Estimating gas for pool creation...');
    const gasEstimate = await client.estimateGas(
      () => client.createPool(token0, token1, sqrtPriceX96, fee)
    );
    console.log(`    Estimated gas: ${gasEstimate.toString()}`);

    const createTx = await client.createPool(token0, token1, sqrtPriceX96, fee);
    await client.waitForTransaction(createTx);
    console.log(`    ✓ Pool created: ${config.explorerUrl}/tx/${createTx}`);
    
    // Wait a bit for chain state to update
    await client.delay(RetryConfig.POOL_CREATION_DELAY);

    poolAddress = await client.executeWithRetry(
      () => client.getPool(token0, token1, fee),
      RetryConfig.RATE_LIMIT_RETRIES,
      RetryConfig.RATE_LIMIT_DELAY
    );
    if (!poolAddress) throw new Error('Failed to create pool');
  }

  console.log(`    Pool address: ${poolAddress}`);

  // Get pool state with retry logic for rate limits
  const poolState = await client.executeWithRetry(
    () => client.getPoolState(poolAddress),
    RetryConfig.RATE_LIMIT_RETRIES,
    RetryConfig.RATE_LIMIT_DELAY
  );
  console.log(`    Current tick: ${poolState.tick}`);
  console.log(`    Tick spacing: ${poolState.tickSpacing}`);
  console.log(`    Current liquidity: ${formatUnits(poolState.liquidity, 18)}`);
  
  // Small delay to avoid rate limits (reduced from hardcoded value)
  await client.delay(RetryConfig.OPERATION_DELAY);

  // Calculate tick bounds
  let { tickLower, tickUpper } = calculateTickBounds(
    minPrice,
    maxPrice,
    poolState.tickSpacing,
    isToken0Outcome
  );

  // Check if pool is initialized (has liquidity)
  const isUninitialized = poolState.liquidity === 0n;
  if (isUninitialized) {
    console.log(`    Pool is uninitialized, will use multicall to initialize and add liquidity`);
    console.log(`    Initial tick range will be: [${tickLower}, ${tickUpper}]`);
  }

  console.log(`    Tick range: [${tickLower}, ${tickUpper}]`);

  // Calculate minimum amounts with slippage protection
  calculateMinAmounts(
    amount0,
    amount1,
    slippageTolerance
  );

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
  
  // Use appropriate ABI based on chain
  const positionManagerAbi = config.chain.id === 100 
    ? algebraPositionManagerABI 
    : uniswapV3PositionManagerABI;
    
  const positionManager = getContract({
    address: config.contracts.dexPositionManager,
    abi: positionManagerAbi as any,
    client: client.walletClient
  });

  // Check if current price is within our range
  // If not, we need to provide only one token
  let adjustedAmount0 = amount0;
  let adjustedAmount1 = amount1;
  
  if (poolState.tick < tickLower) {
    // Current price is below our range, only provide token0
    console.log(`    Current tick (${poolState.tick}) is below range, providing only token0`);
    adjustedAmount1 = 0n;
  } else if (poolState.tick >= tickUpper) {
    // Current price is above our range, only provide token1
    console.log(`    Current tick (${poolState.tick}) is above range, providing only token1`);
    adjustedAmount0 = 0n;
  }
  
  // Prepare mint params based on chain type
  // For uninitialized pools or single-sided liquidity, use 0 for minimum amounts
  const useZeroMins = isUninitialized || adjustedAmount0 === 0n || adjustedAmount1 === 0n;
  
  const mintParams = config.chain.id === 100 ? {
    // Algebra/Swapr format (tuple)
    token0,
    token1,
    tickLower,
    tickUpper,
    amount0Desired: adjustedAmount0,
    amount1Desired: adjustedAmount1,
    amount0Min: useZeroMins ? 0n : calculateMinAmounts(adjustedAmount0, adjustedAmount1, slippageTolerance).amount0Min,
    amount1Min: useZeroMins ? 0n : calculateMinAmounts(adjustedAmount0, adjustedAmount1, slippageTolerance).amount1Min,
    recipient: client.account.address,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600) // 1 hour from now
  } : {
    // Uniswap V3 format (includes fee)
    token0,
    token1,
    fee: fee || config.defaultFee,
    tickLower,
    tickUpper,
    amount0Desired: adjustedAmount0,
    amount1Desired: adjustedAmount1,
    amount0Min: useZeroMins ? 0n : calculateMinAmounts(adjustedAmount0, adjustedAmount1, slippageTolerance).amount0Min,
    amount1Min: useZeroMins ? 0n : calculateMinAmounts(adjustedAmount0, adjustedAmount1, slippageTolerance).amount1Min,
    recipient: client.account.address,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600) // 1 hour from now
  };

  if (isUninitialized) {
    // For uninitialized pools, use multicall to initialize and mint
    console.log('    Using multicall to initialize pool and add liquidity...');
    
    // Get decimals for both tokens
    const decimals0 = await client.getTokenDecimals(token0);
    const decimals1 = await client.getTokenDecimals(token1);
    
    // Calculate initial price as the arithmetic mean of the price range
    // This provides a neutral starting point within the specified range
    // For prediction markets, this represents the midpoint of probabilities
    const initialPrice = (minPrice + maxPrice) / 2;
    console.log(`    Initializing pool at price ${initialPrice.toFixed(4)} (midpoint of range ${minPrice} - ${maxPrice})`)
    
    const sqrtPriceX96 = encodeSqrtPriceX96(
      initialPrice,
      decimals0,
      decimals1
    );
    
    // Encode createAndInitializePoolIfNecessary call
    const createPoolArgs = config.chain.id === 100
      ? [token0, token1, sqrtPriceX96]  // Algebra doesn't need fee
      : [token0, token1, fee || config.defaultFee, sqrtPriceX96];  // Uniswap V3 needs fee
      
    const createPoolData = encodeFunctionData({
      abi: positionManagerAbi as any,
      functionName: 'createAndInitializePoolIfNecessary',
      args: createPoolArgs
    });
    
    // Encode mint call
    const mintData = encodeFunctionData({
      abi: positionManagerAbi as any,
      functionName: 'mint',
      args: [mintParams]
    });
    
    // Execute multicall
    console.log('    Executing multicall to initialize and mint...');
    const multicallTx = await client.executeWithRetry(
      async () => positionManager.write.multicall([[createPoolData, mintData]], {
        account: client.account,
        chain: config.chain
      }),
      RetryConfig.DEFAULT_RETRIES,
      RetryConfig.DEFAULT_DELAY
    );
    
    await client.waitForTransaction(multicallTx);
    console.log(`    ✓ Pool initialized and liquidity added: ${config.explorerUrl}/tx/${multicallTx}`);
  } else {
    // Normal mint for initialized pools or non-Algebra pools
    // Estimate gas for mint operation
    console.log('    Estimating gas for liquidity addition...');
    try {
      const mintArgs = config.chain.id === 100 ? [mintParams] : [mintParams];
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

    const mintArgs = config.chain.id === 100 ? [mintParams] : [mintParams];
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
}

// Export for use in other modules
export type { LiquidityParams };

// Main entry point when running as a script
