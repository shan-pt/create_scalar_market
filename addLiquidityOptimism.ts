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

// Optimism (OP Mainnet) constants
const CHAIN_ID = 10; // Optimism Chain ID

// Official Uniswap V3 addresses on Optimism
const UNISWAP_V3_FACTORY_ADDRESS = getAddress(
  "0x1F98431c8aD98523631AE4a59f267346ea31F984" // Uniswap V3 Factory on Optimism
);

const UNISWAP_V3_POSITION_MANAGER_ADDRESS = getAddress(
  "0xC36442b4a4522E871399CD717aBDD847Ab11FE88" // Uniswap V3 Position Manager on Optimism
);

// Seer protocol router (you'll need to find the correct address for Optimism)
const SEER_OPTIMISM_ROUTER = getAddress(
  "0xeC9048b59b3467415b1a38F63416407eA0c70fB8" // This might need to be updated for Optimism
);

const THEGRAPH_URL =
  "https://gateway.thegraph.com/api/subgraphs/id/B4vyRqJaSHD8dRDb3BFRoAzuBK18c1QQcXq94JbxDxWH";
const THEGRAPH_API_KEY = process.env.GRAPH_API_KEY;

// USDC address on Optimism (commonly used stablecoin)
const USDC_ADDRESS = getAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"); // USDC on Optimism
// Alternative: DAI on Optimism: 0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1

// ERC20 ABI for token interactions
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address, uint256) returns (bool)",
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

// Uniswap V3 Factory ABI (minimal)
const FACTORY_ABI = [
  "function getPool(address, address, uint24) view returns (address)",
  "function createPool(address, address, uint24) returns (address)",
];

// Uniswap V3 Pool ABI (minimal)
const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function tickSpacing() view returns (int24)",
  "function fee() view returns (uint24)",
  "function initialize(uint160) external",
];

// Uniswap V3 NonfungiblePositionManager ABI (minimal)
const POSITION_MANAGER_ABI = [
  "function mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256)) payable returns (uint256,uint128,uint256,uint256)",
  "function createAndInitializePoolIfNecessary(address,address,uint24,uint160) payable returns (address)",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
];

const SEER_OPTIMISM_ROUTER_ABI = [
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
    UNISWAP_V3_POSITION_MANAGER_ADDRESS,
    POSITION_MANAGER_ABI,
    wallet
  );

  // Sort tokens lexicographically
  const [token0, token1] =
    tokenA.address.toLowerCase() < tokenB.address.toLowerCase()
      ? [tokenA, tokenB]
      : [tokenB, tokenA];

  const PRICE_MIN =
    token1.address.toLowerCase() === USDC_ADDRESS.toLowerCase()
      ? range.lowerBound
      : 1 / range.upperBound;
  const PRICE_MAX =
    token1.address.toLowerCase() === USDC_ADDRESS.toLowerCase()
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

  // Encode createAndInitializePoolIfNecessary call
  const createPoolData = positionManager.interface.encodeFunctionData(
    "createAndInitializePoolIfNecessary",
    [token0.address, token1.address, fee, sqrtPriceX96]
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

  // Encode mint call
  const mintParams = {
    token0: token0.address,
    token1: token1.address,
    fee: fee,
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
      mintParams.fee,
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

  // Get the pool address from factory
  const factory = new Contract(UNISWAP_V3_FACTORY_ADDRESS, FACTORY_ABI, wallet);
  return await factory.getPool(token0.address, token1.address, fee);
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
    token1.address.toLowerCase() === USDC_ADDRESS.toLowerCase()
      ? range.lowerBound
      : 1 / range.upperBound;
  const PRICE_MAX =
    token1.address.toLowerCase() === USDC_ADDRESS.toLowerCase()
      ? range.upperBound
      : 1 / range.lowerBound;

  const [amountA, amountB] =
    tokenA.address.toLowerCase() < tokenB.address.toLowerCase()
      ? [amount0, amount1]
      : [amount1, amount0];

  console.log(`Adding liquidity to ${token0.symbol}/${token1.symbol} pool`);
  console.log(`Amounts: ${formatEther(amountA)} ${tokenA.symbol}, ${formatEther(amountB)} ${tokenB.symbol}`);

  // Get or create pool
  const factory = new Contract(UNISWAP_V3_FACTORY_ADDRESS, FACTORY_ABI, wallet);
  let poolAddress = await factory.getPool(token0.address, token1.address, fee);

  if (poolAddress === "0x0000000000000000000000000000000000000000") {
    console.log("Pool doesn't exist, will create it with multicall...");

    // Approve tokens for position manager before multicall
    const tokenAContract = new Contract(tokenA.address, ERC20_ABI, wallet);
    const tokenBContract = new Contract(tokenB.address, ERC20_ABI, wallet);

    const approveTxA = await tokenAContract.approve(
      UNISWAP_V3_POSITION_MANAGER_ADDRESS,
      amountA,
      { gasLimit: 100_000 }
    );
    await approveTxA.wait();

    const approveTxB = await tokenBContract.approve(
      UNISWAP_V3_POSITION_MANAGER_ADDRESS,
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

    // Get pool contract and info
    const poolContract = new Contract(poolAddress, POOL_ABI, wallet);
    const slot0 = await poolContract.slot0();
    const currentTick = slot0.tick;
    const tickSpacing = 60; // Standard for 0.3% fee tier

    console.log(
      `Pool slot0 - sqrtPriceX96: ${slot0.sqrtPriceX96}, tick: ${currentTick}, unlocked: ${slot0.unlocked}`
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
      UNISWAP_V3_POSITION_MANAGER_ADDRESS,
      amountA,
      { gasLimit: 100_000 }
    );
    await approveTxA.wait();

    const approveTxB = await tokenBContract.approve(
      UNISWAP_V3_POSITION_MANAGER_ADDRESS,
      amountB,
      { gasLimit: 100_000 }
    );
    await approveTxB.wait();

    console.log("Approved tokens for position manager");

    // Mint the position
    const positionManager = new Contract(
      UNISWAP_V3_POSITION_MANAGER_ADDRESS,
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
      fee,
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
      fee,
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

export async function addLiquidityOptimism(
  marketAddress: string,
  amount: number,
  lowerBound: number,
  upperBound: number
): Promise<void> {
  console.log("🚀 Adding liquidity to Seer prediction market on Optimism...");
  console.log(`📍 Market Address: ${marketAddress}`);
  console.log(`💰 Amount: ${amount} USDC`);
  console.log(`📊 Price Range: ${lowerBound} - ${upperBound}`);

  // Setup wallet and provider for Optimism
  const provider = new providers.JsonRpcProvider("https://mainnet.optimism.io");
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY not found in environment variables");
  }
  const wallet = new Wallet(privateKey, provider);

  // Check USDC balance
  const usdcContract = new Contract(USDC_ADDRESS, ERC20_ABI, wallet);
  const usdcBalance = await usdcContract.balanceOf(wallet.address);
  const usdcDecimals = await usdcContract.decimals();
  
  // Convert amount to USDC units (6 decimals)
  const amountWei = BigNumber.from(Math.floor(amount * Math.pow(10, usdcDecimals)));
  
  // Helper function to format USDC amounts
  const formatUSDC = (amount: BigNumber) => (amount.toNumber() / Math.pow(10, usdcDecimals)).toFixed(6);
  
  console.log(`💰 Current USDC balance: ${formatUSDC(usdcBalance)} USDC`);
  console.log(`💰 Requested amount: ${formatUSDC(amountWei)} USDC`);

  if (usdcBalance.lt(amountWei)) {
    throw new Error(`Insufficient USDC balance. Need ${formatUSDC(amountWei)} USDC, have ${formatUSDC(usdcBalance)} USDC`);
  }

  // Warning for very small amounts
  if (amount < 0.01) {
    console.log(`⚠️  WARNING: Testing with very small amount (${amount} USDC)`);
    console.log(`⚠️  Gas costs may exceed the test amount`);
    console.log(`⚠️  Some pools may have minimum liquidity requirements`);
  }

  // Check minimum amount for Uniswap V3
  if (amountWei.lt(1000)) { // Less than 0.001 USDC
    throw new Error(`Amount too small for Uniswap V3. Minimum recommended: 0.001 USDC, provided: ${formatUSDC(amountWei)} USDC`);
  }

  // Get market tokens
  const tokens = await getMarketTokens(marketAddress);
  if (tokens.length !== 2) {
    throw new Error(`Expected 2 tokens, got ${tokens.length}`);
  }

  const [downToken, upToken] = tokens;
  console.log(`DOWN token: ${downToken}, UP token: ${upToken}`);
  console.log(`USDC address: ${USDC_ADDRESS}`);

  // Split the amount: half for splitting, half for each pool
  const splitAmount = amountWei.div(2); // Half for splitting into conditional tokens
  const usdcPerPool = amountWei.div(4); // Quarter for each pool

  console.log(`📊 Calculated amounts:`);
  console.log(`      - Split amount: ${formatUSDC(splitAmount)} USDC`);
  console.log(`      - USDC per pool: ${formatUSDC(usdcPerPool)} USDC`);

  // Approve USDC for router
  console.log("Approving USDC for router...");
  const approveTx = await usdcContract.approve(SEER_OPTIMISM_ROUTER, splitAmount, {
    gasLimit: 100_000
  });
  await approveTx.wait();

  // Split position to get conditional tokens
  console.log(`Split ${formatUSDC(splitAmount)} USDC into conditional tokens using splitPosition`);
  const seerRouter = new Contract(SEER_OPTIMISM_ROUTER, SEER_OPTIMISM_ROUTER_ABI, wallet);
  const splitTx = await seerRouter.splitPosition(marketAddress, USDC_ADDRESS, splitAmount, {
    gasLimit: 300_000
  });
  await splitTx.wait();

  // Check token balances after split
  const downTokenContract = new Contract(downToken, ERC20_ABI, wallet);
  const upTokenContract = new Contract(upToken, ERC20_ABI, wallet);
  const downBalance = await downTokenContract.balanceOf(wallet.address);
  const upBalance = await upTokenContract.balanceOf(wallet.address);
  const newUSDCBalance = await usdcContract.balanceOf(wallet.address);

  console.log(`Token balances after split - DOWN: ${formatEther(downBalance)}, UP: ${formatEther(upBalance)}, USDC: ${formatUSDC(newUSDCBalance)}`);

  // Create Token instances for Uniswap SDK
  const downTokenInstance = new Token(CHAIN_ID, downToken, 18, "DOWN", "Down Token");
  const upTokenInstance = new Token(CHAIN_ID, upToken, 18, "UP", "Up Token");
  const usdcTokenInstance = new Token(CHAIN_ID, USDC_ADDRESS, usdcDecimals, "USDC", "USD Coin");

  console.log("Created Token instances for Uniswap SDK");

  const range: LiquidityRange = { lowerBound, upperBound };

  // Add liquidity to both pools
  console.log(`\n🔄 Adding liquidity to DOWN/USDC pool...`);
  await addLiquidityToPool(wallet, downTokenInstance, usdcTokenInstance, downBalance, usdcPerPool, range);

  console.log(`\n🔄 Adding liquidity to UP/USDC pool...`);
  await addLiquidityToPool(wallet, upTokenInstance, usdcTokenInstance, upBalance, usdcPerPool, range);

  console.log(`\n✅ Successfully added liquidity to both pools on Optimism!`);
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.log("Usage: npx ts-node addLiquidityOptimism.ts <marketAddress> <amount> <lowerBound> <upperBound>");
    console.log("Example: npx ts-node addLiquidityOptimism.ts 0x123... 100 0.3 0.7");
    process.exit(1);
  }

  const [marketAddress, amountStr, lowerBoundStr, upperBoundStr] = args;
  const amount = parseFloat(amountStr);
  const lowerBound = parseFloat(lowerBoundStr);
  const upperBound = parseFloat(upperBoundStr);

  addLiquidityOptimism(marketAddress, amount, lowerBound, upperBound)
    .then(() => {
      console.log("✅ Liquidity addition completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Error adding liquidity:", error);
      process.exit(1);
    });
}