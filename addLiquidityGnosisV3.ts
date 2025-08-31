#!/usr/bin/env node

import { providers, Wallet, Contract, BigNumber } from "ethers";
import { parseEther, getAddress, formatEther } from "ethers/lib/utils";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { Token } from "@uniswap/sdk-core";
import { encodeSqrtRatioX96, TickMath, nearestUsableTick, Pool, Position, NonfungiblePositionManager } from "@uniswap/v3-sdk";
dotenv.config();

interface LiquidityRange {
  lowerBound: number; // 0 to 1
  upperBound: number; // 0 to 1
}

//// TICKS MANUAL MATH
const LN_1_0001 = Math.log(1.0001);
const priceToTick = (price: number): number => Math.log(price) / LN_1_0001;

// Gnosis Chain constants
const CHAIN_ID = 100; // Gnosis Chain ID

// Swapr V3 addresses on Gnosis Chain (uses Algebra protocol)
const SWAPR_V3_FACTORY_ADDRESS = getAddress(
  "0xA0864cCA6E114013AB0e27cbd5B6f4c8947da766" // Algebra Factory on Gnosis Chain
);

const SWAPR_V3_POSITION_MANAGER_ADDRESS = getAddress(
  "0x91fd594c46d8b01e62dbdebed2401dde01817834" // Swapr V3 Position Manager
);

// Seer protocol router on Gnosis Chain
const SEER_GNOSIS_ROUTER = getAddress(
  "0xeC9048b59b3467415b1a38F63416407eA0c70fB8"
);

const THEGRAPH_URL =
  "https://gateway.thegraph.com/api/subgraphs/id/B4vyRqJaSHD8dRDb3BFRoAzuBK18c1QQcXq94JbxDxWH";
const THEGRAPH_API_KEY = process.env.GRAPH_API_KEY;

// sDAI address on Gnosis Chain
const SDAI_ADDRESS = getAddress("0xaf204776c7245bF4147c2612BF6e5972Ee483701");

// ERC20 ABI for token interactions
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address, uint256) returns (bool)",
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

// Swapr V3 Factory ABI (minimal) - uses Algebra protocol
const FACTORY_ABI = [
  "function poolByPair(address, address) view returns (address)",
  "function createPool(address, address) returns (address)",
];

// Algebra Pool ABI (minimal) - uses globalState instead of slot0
const POOL_ABI = [
  "function globalState() view returns (uint160 price, int24 tick, uint16 feeZto, uint16 feeOtz, uint16 timepointIndex, uint8 communityFeeToken0, uint8 communityFeeToken1, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function tickSpacing() view returns (int24)",
  "function initialize(uint160) external",
];

// Swapr V3 NonfungiblePositionManager ABI (minimal) - similar to Uniswap but no fee parameter
const POSITION_MANAGER_ABI = [
  "function mint((address,address,int24,int24,uint256,uint256,uint256,uint256,address,uint256)) payable returns (uint256,uint128,uint256,uint256)",
  "function createAndInitializePoolIfNecessary(address,address,uint160) payable returns (address)",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
];

const SEER_GNOSIS_ROUTER_ABI = [
  "function splitPosition(address,address,uint256) external",
];

async function getMarketTokens(marketAddress: string): Promise<string[]> {
  const query = `
    {
      markets(where: {id: "${marketAddress.toLowerCase()}"}) {
        wrappedTokens
        outcomes
      }
    }
  `;

  const response = await fetch(THEGRAPH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${THEGRAPH_API_KEY}`,
    },
    body: JSON.stringify({ query }),
  });

  const data = await response.json();

  if (!data.data?.markets?.[0]) {
    throw new Error(`Market not found: ${marketAddress}`);
  }

  const { wrappedTokens } = data.data.markets[0];
  // Remove the last token (invalid token)
  return wrappedTokens.slice(0, -1);
}

async function createPoolWithMulticall(
  wallet: Wallet,
  tokenA: Token,
  tokenB: Token,
  amountA: BigNumber,
  amountB: BigNumber,
  range: LiquidityRange,
  fee: number = 3000 // 0.3% fee tier
): Promise<string> {
  const positionManager = new Contract(
    SWAPR_V3_POSITION_MANAGER_ADDRESS,
    POSITION_MANAGER_ABI,
    wallet
  );

  // Sort tokens lexicographically
  const [token0, token1] =
    tokenA.address.toLowerCase() < tokenB.address.toLowerCase()
      ? [tokenA, tokenB]
      : [tokenB, tokenA];

  const PRICE_MIN =
    token1.address.toLowerCase() === SDAI_ADDRESS.toLowerCase()
      ? range.lowerBound
      : 1 / range.upperBound;
  const PRICE_MAX =
    token1.address.toLowerCase() === SDAI_ADDRESS.toLowerCase()
      ? range.upperBound
      : 1 / range.lowerBound;

  // Calculate initial price as midpoint
  const midpoint = (PRICE_MIN + PRICE_MAX) / 2;

  // Use smaller precision to avoid overflow and convert JSBI to BigNumber
  const sqrtPriceX96JSBI = encodeSqrtRatioX96(
    Math.floor(midpoint * 1e6), // Use smaller precision
    1e6
  );
  const sqrtPriceX96 = BigNumber.from(sqrtPriceX96JSBI.toString());

  console.log(
    `Initial pool price: midpoint=${midpoint}, PRICE_MIN=${PRICE_MIN}, PRICE_MAX=${PRICE_MAX}`
  );

  // Encode createAndInitializePoolIfNecessary call (no fee parameter for Swapr/Algebra)
  const createPoolData = positionManager.interface.encodeFunctionData(
    "createAndInitializePoolIfNecessary",
    [token0.address, token1.address, sqrtPriceX96]
  );

  // Calculate ticks for the range with proper token ordering
  const rawLower = priceToTick(PRICE_MIN);
  const rawUpper = priceToTick(PRICE_MAX);
  const tickSpacing = 60; // Standard for 0.3% fee tier
  const lowerTick = nearestUsableTick(Math.floor(rawLower), tickSpacing);
  const upperTick = nearestUsableTick(Math.ceil(rawUpper), tickSpacing);

  console.log(`Token order: ${token0.symbol} < ${token1.symbol}`);
  console.log(
    `Price range: ${PRICE_MIN}-${PRICE_MAX}, Ticks: [${lowerTick}, ${upperTick}]`
  );

  const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now

  // Determine amounts based on token order
  const [amount0Desired, amount1Desired] =
    tokenA.address.toLowerCase() < tokenB.address.toLowerCase()
      ? [amountA, amountB]
      : [amountB, amountA];

  // Set minimum amounts to 0 for small liquidity
  const amount0Min = BigNumber.from(0);
  const amount1Min = BigNumber.from(0);

  // Encode mint call (no fee parameter for Swapr/Algebra)
  const mintParams = {
    token0: token0.address,
    token1: token1.address,
    tickLower: lowerTick,
    tickUpper: upperTick,
    amount0Desired: amount0Desired,
    amount1Desired: amount1Desired,
    amount0Min: amount0Min,
    amount1Min: amount1Min,
    recipient: wallet.address,
    deadline: deadline,
  };

  const mintData = positionManager.interface.encodeFunctionData("mint", [
    [
      mintParams.token0,
      mintParams.token1,
      mintParams.tickLower,
      mintParams.tickUpper,
      mintParams.amount0Desired,
      mintParams.amount1Desired,
      mintParams.amount0Min,
      mintParams.amount1Min,
      mintParams.recipient,
      mintParams.deadline,
    ],
  ]);

  console.log(`Creating pool with amounts: ${formatEther(amount0Desired)} ${token0.symbol}, ${formatEther(amount1Desired)} ${token1.symbol}`);

  // Execute multicall with both functions
  const multicallTx = await positionManager.multicall([
    createPoolData,
    mintData,
  ], {
    gasLimit: 3_000_000 // Higher gas limit
  });
  const receipt = await multicallTx.wait();

  console.log(
    `Pool created and liquidity added via multicall. Transaction: ${receipt.transactionHash}`
  );

  // Get the pool address from factory (Swapr uses poolByPair instead of getPool)
  const factory = new Contract(SWAPR_V3_FACTORY_ADDRESS, FACTORY_ABI, wallet);
  return await factory.poolByPair(token0.address, token1.address);
}

async function addLiquidityToPool(
  wallet: Wallet,
  tokenA: Token,
  tokenB: Token,
  amount0: BigNumber,
  amount1: BigNumber,
  range: LiquidityRange,
  fee: number = 3000 // 0.3% fee tier
): Promise<void> {
  // Sort tokens for consistent ordering (lexicographic)
  const [token0, token1] =
    tokenA.address.toLowerCase() < tokenB.address.toLowerCase()
      ? [tokenA, tokenB]
      : [tokenB, tokenA];

  const PRICE_MIN =
    token1.address.toLowerCase() === SDAI_ADDRESS.toLowerCase()
      ? range.lowerBound
      : 1 / range.upperBound;
  const PRICE_MAX =
    token1.address.toLowerCase() === SDAI_ADDRESS.toLowerCase()
      ? range.upperBound
      : 1 / range.lowerBound;

  const [amountA, amountB] =
    tokenA.address.toLowerCase() < tokenB.address.toLowerCase()
      ? [amount0, amount1]
      : [amount1, amount0];

  console.log(`Adding liquidity to ${token0.symbol}/${token1.symbol} pool`);
  console.log(`Amounts: ${formatEther(amountA)} ${tokenA.symbol}, ${formatEther(amountB)} ${tokenB.symbol}`);

  // Get or create pool (Swapr uses poolByPair instead of getPool)
  const factory = new Contract(SWAPR_V3_FACTORY_ADDRESS, FACTORY_ABI, wallet);
  let poolAddress = await factory.poolByPair(token0.address, token1.address);

  if (poolAddress === "0x0000000000000000000000000000000000000000") {
    console.log("Pool doesn't exist, will create it with multicall...");

    // Approve tokens for position manager before multicall
    const tokenAContract = new Contract(tokenA.address, ERC20_ABI, wallet);
    const tokenBContract = new Contract(tokenB.address, ERC20_ABI, wallet);

    const approveTxA = await tokenAContract.approve(
      SWAPR_V3_POSITION_MANAGER_ADDRESS,
      amountA,
      { gasLimit: 100_000 }
    );
    await approveTxA.wait();

    const approveTxB = await tokenBContract.approve(
      SWAPR_V3_POSITION_MANAGER_ADDRESS,
      amountB,
      { gasLimit: 100_000 }
    );
    await approveTxB.wait();

    poolAddress = await createPoolWithMulticall(
      wallet,
      tokenA,
      tokenB,
      amountA,
      amountB,
      range,
      fee
    );
    console.log(`Created new pool and added liquidity at: ${poolAddress}`);
  } else {
    console.log(`Pool already exists at: ${poolAddress}, adding liquidity...`);

    // Get pool contract and info (Algebra uses globalState instead of slot0)
    const poolContract = new Contract(poolAddress, POOL_ABI, wallet);
    const globalState = await poolContract.globalState();
    const currentTick = globalState.tick;
    const tickSpacing = 60; // Standard tick spacing

    console.log(
      `Pool globalState - price: ${globalState.price}, tick: ${currentTick}, unlocked: ${globalState.unlocked}`
    );

    // Calculate ticks for the range with proper token ordering
    const rawLower = priceToTick(PRICE_MIN);
    const rawUpper = priceToTick(PRICE_MAX);
    const lowerTick = nearestUsableTick(Math.floor(rawLower), tickSpacing);
    const upperTick = nearestUsableTick(Math.ceil(rawUpper), tickSpacing);

    console.log(`Token order: ${token0.symbol} < ${token1.symbol}`);
    console.log(
      `Price range: ${PRICE_MIN}-${PRICE_MAX}, Ticks: [${lowerTick}, ${upperTick}]`
    );

    console.log(
      `Current tick: ${currentTick}, Range: [${lowerTick}, ${upperTick}]`
    );

    // Approve tokens for position manager
    const tokenAContract = new Contract(tokenA.address, ERC20_ABI, wallet);
    const tokenBContract = new Contract(tokenB.address, ERC20_ABI, wallet);

    const approveTxA = await tokenAContract.approve(
      SWAPR_V3_POSITION_MANAGER_ADDRESS,
      amountA,
      { gasLimit: 100_000 }
    );
    await approveTxA.wait();

    const approveTxB = await tokenBContract.approve(
      SWAPR_V3_POSITION_MANAGER_ADDRESS,
      amountB,
      { gasLimit: 100_000 }
    );
    await approveTxB.wait();

    console.log("Approved tokens for position manager");

    // Mint the position
    const positionManager = new Contract(
      SWAPR_V3_POSITION_MANAGER_ADDRESS,
      POSITION_MANAGER_ABI,
      wallet
    );
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now

    // Set minimum amounts to 0 for small liquidity
    const amount0Min = BigNumber.from(0);
    const amount1Min = BigNumber.from(0);

    const mintParams = [
      token0.address,
      token1.address,
      lowerTick,
      upperTick,
      amountA,
      amountB,
      amount0Min,
      amount1Min,
      wallet.address,
      deadline,
    ];

    console.log(`Minting position with params:`, {
      token0: token0.symbol,
      token1: token1.symbol,
      lowerTick,
      upperTick,
      amountA: formatEther(amountA),
      amountB: formatEther(amountB),
      amount0Min: formatEther(amount0Min),
      amount1Min: formatEther(amount1Min)
    });

    const mintTx = await positionManager.mint(mintParams, {
      gasLimit: 2_000_000 // Higher gas limit
    });
    const receipt = await mintTx.wait();

    console.log(
      `Liquidity position created. Transaction: ${receipt.transactionHash}`
    );
  }
}

export async function addLiquidityGnosisV3(
  marketAddress: string,
  amount: number,
  lowerBound: number,
  upperBound: number
): Promise<void> {
  console.log("🚀 Adding liquidity to Seer prediction market on Gnosis Chain with Swapr V3...");
  console.log(`📍 Market Address: ${marketAddress}`);
  console.log(`💰 Amount: ${amount} sDAI`);
  console.log(`📊 Price Range: ${lowerBound} - ${upperBound}`);

  // Setup wallet and provider for Gnosis Chain
  const provider = new providers.JsonRpcProvider("https://rpc.gnosischain.com");
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY not found in environment variables");
  }
  const wallet = new Wallet(privateKey, provider);

  // Check sDAI balance
  const sDAIContract = new Contract(SDAI_ADDRESS, ERC20_ABI, wallet);
  const sDAIBalance = await sDAIContract.balanceOf(wallet.address);
  console.log(`💰 Current sDAI balance: ${formatEther(sDAIBalance)} sDAI`);

  const amountWei = parseEther(amount.toString());
  if (sDAIBalance.lt(amountWei)) {
    throw new Error(`Insufficient sDAI balance. Need ${amount} sDAI, have ${formatEther(sDAIBalance)} sDAI`);
  }

  // Warning for very small amounts
  if (amount < 0.01) {
    console.log(`⚠️  WARNING: Testing with very small amount (${amount} sDAI)`);
    console.log(`⚠️  Gas costs may exceed the test amount`);
    console.log(`⚠️  Some pools may have minimum liquidity requirements`);
  }

  // Check minimum amount for Uniswap V3
  if (amountWei.lt(parseEther("0.001"))) {
    throw new Error(`Amount too small for Uniswap V3. Minimum recommended: 0.001 sDAI, provided: ${amount} sDAI`);
  }

  // Get market tokens
  const tokens = await getMarketTokens(marketAddress);
  if (tokens.length !== 2) {
    throw new Error(`Expected 2 tokens, got ${tokens.length}`);
  }

  const [downToken, upToken] = tokens;
  console.log(`DOWN token: ${downToken}, UP token: ${upToken}`);
  console.log(`sDAI address: ${SDAI_ADDRESS}`);

  // Split the amount: half for splitting, half for each pool
  const splitAmount = amountWei.div(2); // Half for splitting into conditional tokens
  const sDAIPerPool = amountWei.div(4); // Quarter for each pool

  console.log(`📊 Calculated amounts:`);
  console.log(`      - Split amount: ${formatEther(splitAmount)} sDAI`);
  console.log(`      - sDAI per pool: ${formatEther(sDAIPerPool)} sDAI`);

  // Approve sDAI for router
  console.log("Approving sDAI for router...");
  const approveTx = await sDAIContract.approve(SEER_GNOSIS_ROUTER, splitAmount, {
    gasLimit: 100_000
  });
  await approveTx.wait();

  // Split position to get conditional tokens
  console.log(`Split ${formatEther(splitAmount)} sDAI into conditional tokens using splitPosition`);
  console.log(`Parameters: collateralToken=${SDAI_ADDRESS}, market=${marketAddress}, amount=${formatEther(splitAmount)}`);
  const seerRouter = new Contract(SEER_GNOSIS_ROUTER, SEER_GNOSIS_ROUTER_ABI, wallet);
  
  // Correct parameter order: splitPosition(collateralToken, market, amount)
  // Higher gas limit needed for token wrapping/creation
  const splitTx = await seerRouter.splitPosition(SDAI_ADDRESS, marketAddress, splitAmount, {
    gasLimit: 1_000_000
  });
  await splitTx.wait();

  // Check token balances after split
  const downTokenContract = new Contract(downToken, ERC20_ABI, wallet);
  const upTokenContract = new Contract(upToken, ERC20_ABI, wallet);
  const downBalance = await downTokenContract.balanceOf(wallet.address);
  const upBalance = await upTokenContract.balanceOf(wallet.address);
  const newSDAIBalance = await sDAIContract.balanceOf(wallet.address);

  console.log(`Token balances after split - DOWN: ${formatEther(downBalance)}, UP: ${formatEther(upBalance)}, sDAI: ${formatEther(newSDAIBalance)}`);

  // Create Token instances for Uniswap SDK
  const downTokenInstance = new Token(CHAIN_ID, downToken, 18, "DOWN", "Down Token");
  const upTokenInstance = new Token(CHAIN_ID, upToken, 18, "UP", "Up Token");
  const sDAITokenInstance = new Token(CHAIN_ID, SDAI_ADDRESS, 18, "sDAI", "Savings DAI");

  console.log("Created Token instances for Uniswap SDK");

  const range: LiquidityRange = { lowerBound, upperBound };

  // Check if Uniswap V3 Factory exists on Gnosis Chain
  console.log(`\n🔍 Checking if Uniswap V3 Factory exists at ${UNISWAP_V3_FACTORY_ADDRESS}...`);
  try {
    const factory = new Contract(UNISWAP_V3_FACTORY_ADDRESS, FACTORY_ABI, wallet);
    const code = await wallet.provider.getCode(UNISWAP_V3_FACTORY_ADDRESS);
    console.log(`Factory contract code length: ${code.length}`);
    
    if (code === "0x") {
      throw new Error("Uniswap V3 Factory not deployed on Gnosis Chain");
    }
    
    // Try to call a simple function to verify it works
    console.log("Testing factory contract...");
    const testPool = await factory.getPool(SDAI_ADDRESS, downToken, 3000);
    console.log(`Test pool query result: ${testPool}`);
    
  } catch (error) {
    console.log(`❌ Uniswap V3 Factory verification failed: ${error.message}`);
    console.log(`\n💡 SOLUTION OPTIONS:`);
    console.log(`1. Use Swapr V3 (Algebra-based) - your original working approach`);
    console.log(`2. Use Uniswap V2 style AMM`);
    console.log(`3. Deploy on a different chain (Optimism, Base, etc.)`);
    console.log(`\nSince you requested to keep using Uniswap V3, but it's not available on Gnosis Chain,`);
    console.log(`I recommend testing on Optimism where both Seer and Uniswap V3 are officially deployed.`);
    return;
  }

  // Add liquidity to both pools
  console.log(`\n🔄 Adding liquidity to DOWN/sDAI pool...`);
  await addLiquidityToPool(wallet, downTokenInstance, sDAITokenInstance, downBalance, sDAIPerPool, range);

  console.log(`\n🔄 Adding liquidity to UP/sDAI pool...`);
  await addLiquidityToPool(wallet, upTokenInstance, sDAITokenInstance, upBalance, sDAIPerPool, range);

  console.log(`\n✅ Successfully added liquidity to both pools on Gnosis Chain using Uniswap V3!`);
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.log("Usage: npx ts-node addLiquidityGnosisV3.ts <marketAddress> <amount> <lowerBound> <upperBound>");
    console.log("Example: npx ts-node addLiquidityGnosisV3.ts 0x123... 0.1 0.3 0.7");
    process.exit(1);
  }

  const [marketAddress, amountStr, lowerBoundStr, upperBoundStr] = args;
  const amount = parseFloat(amountStr);
  const lowerBound = parseFloat(lowerBoundStr);
  const upperBound = parseFloat(upperBoundStr);

  addLiquidityGnosisV3(marketAddress, amount, lowerBound, upperBound)
    .then(() => {
      console.log("✅ Liquidity addition completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Error adding liquidity:", error);
      process.exit(1);
    });
}