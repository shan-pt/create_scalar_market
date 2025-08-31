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

// Uniswap V3 constants for Gnosis Chain
const CHAIN_ID = 100; // Gnosis Chain ID

// Uniswap V3 addresses on Gnosis Chain (verified)
const UNISWAP_V3_FACTORY_ADDRESS = getAddress(
  "0xf78031CBCA409F2FB6876BDFDBc1b2df24cF9bEf" // Uniswap V3 Factory on Gnosis Chain
);

const UNISWAP_V3_POSITION_MANAGER_ADDRESS = getAddress(
  "0xCd03e2e276F6EEdD424d41314437531F665187b9" // Uniswap V3 Position Manager on Gnosis Chain
);

// Keep the same router for splitting positions
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

export async function addLiquidityWorking(
  marketAddress: string,
  amount: number,
  range: LiquidityRange
): Promise<void> {
  if (
    range.lowerBound < 0 ||
    range.lowerBound > 1 ||
    range.upperBound < 0 ||
    range.upperBound > 1 ||
    range.lowerBound >= range.upperBound
  ) {
    throw new Error(
      "Range bounds must be between 0 and 1, with lowerBound < upperBound"
    );
  }

  // Enforce minimum amount
  if (amount < 0.1) {
    throw new Error(
      "Minimum amount is 0.1 sDAI. Smaller amounts fail due to Seer protocol limitations."
    );
  }

  const provider = new providers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);

  try {
    // Check wallet balance first
    const sDAIToken = new Contract(SDAI_ADDRESS, ERC20_ABI, wallet);
    const balance = await sDAIToken.balanceOf(wallet.address);
    const balanceFormatted = parseFloat(formatEther(balance));
    
    console.log(`💰 Current sDAI balance: ${balanceFormatted.toFixed(6)} sDAI`);
    
    if (balanceFormatted < amount) {
      throw new Error(`Insufficient sDAI balance. Have: ${balanceFormatted.toFixed(6)}, Need: ${amount}`);
    }

    // 1. Get DOWN and UP token addresses from TheGraph
    const tokenAddresses = await getMarketTokens(marketAddress);
    if (tokenAddresses.length !== 2) {
      throw new Error(
        `Expected 2 tokens for scalar market, got ${tokenAddresses.length}`
      );
    }

    const [downTokenAddress, upTokenAddress] = tokenAddresses;
    console.log(`DOWN token: ${downTokenAddress}, UP token: ${upTokenAddress}`);

    // 2. Use sDAI contract address constant
    console.log(`sDAI address: ${SDAI_ADDRESS}`);

    // 3. Calculate amounts - use half for split, quarter for each pool's sDAI
    const splitAmount = parseEther((amount / 2).toFixed(18));
    const sDAIAmountPerPool = parseEther((amount / 4).toFixed(18));

    console.log(`📊 Calculated amounts:
      - Split amount: ${formatEther(splitAmount)} sDAI
      - sDAI per pool: ${formatEther(sDAIAmountPerPool)} sDAI`);

    // 4. Approve sDAI for the router and split position
    const currentAllowance = await sDAIToken.allowance(
      wallet.address,
      SEER_GNOSIS_ROUTER
    );

    if (currentAllowance.lt(splitAmount)) {
      console.log("Approving sDAI for router...");
      const approveTx = await sDAIToken.approve(
        SEER_GNOSIS_ROUTER,
        splitAmount,
        { gasLimit: 100_000 }
      );
      await approveTx.wait();
    }

    // Split sDAI position using splitPosition
    const router = new Contract(
      SEER_GNOSIS_ROUTER,
      SEER_GNOSIS_ROUTER_ABI,
      wallet
    );
    const tx = await router.splitPosition(
      SDAI_ADDRESS,
      marketAddress,
      splitAmount,
      { gasLimit: 1_000_000 }
    );
    await tx.wait();
    console.log(
      `Split ${formatEther(splitAmount)} sDAI into conditional tokens using splitPosition`
    );

    // 5. Get token balances after split
    const downToken = new Contract(downTokenAddress, ERC20_ABI, wallet);
    const upToken = new Contract(upTokenAddress, ERC20_ABI, wallet);

    const downBalance = await downToken.balanceOf(wallet.address);
    const upBalance = await upToken.balanceOf(wallet.address);
    const sDAIBalance = await sDAIToken.balanceOf(wallet.address);

    console.log(
      `Token balances after split - DOWN: ${formatEther(downBalance)}, UP: ${formatEther(upBalance)}, sDAI: ${formatEther(sDAIBalance)}`
    );

    // 6. Create Token instances for Uniswap SDK
    if (!downTokenAddress || !upTokenAddress) {
      throw new Error(
        `Invalid token addresses: DOWN=${downTokenAddress}, UP=${upTokenAddress}`
      );
    }

    const downTokenSdk = new Token(
      CHAIN_ID,
      downTokenAddress,
      18,
      "DOWN",
      "DOWN"
    );
    const upTokenSdk = new Token(CHAIN_ID, upTokenAddress, 18, "UP", "UP");
    const sDAITokenSdk = new Token(CHAIN_ID, SDAI_ADDRESS, 18, "sDAI", "sDAI");

    console.log("Created Token instances for Uniswap SDK");

    // 7. Add liquidity to both pools
    console.log("🔄 Adding liquidity to DOWN/sDAI pool...");
    await addLiquidityToPool(
      wallet,
      downTokenSdk,
      sDAITokenSdk,
      downBalance, // Use all DOWN tokens from split
      sDAIAmountPerPool, // Use calculated sDAI amount
      range
    );

    console.log("🔄 Adding liquidity to UP/sDAI pool...");
    await addLiquidityToPool(
      wallet,
      upTokenSdk,
      sDAITokenSdk,
      upBalance, // Use all UP tokens from split
      sDAIAmountPerPool, // Use calculated sDAI amount
      range
    );

    console.log(
      "✅ Successfully added liquidity to both DOWN/sDAI and UP/sDAI pools using Uniswap V3"
    );
  } catch (error: any) {
    console.error("❌ Error adding liquidity:", error);
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage: npx ts-node addLiquidityWorking.ts <marketAddress> <amount> [lowerBound] [upperBound]

This script works with amounts >= 0.1 sDAI (minimum that works with Seer protocol)

Arguments:
  marketAddress   The address of the Seer prediction market
  amount         The amount of sDAI to use for liquidity (minimum: 0.1)
  lowerBound     Lower bound of price range (0-1, default: 0.05)
  upperBound     Upper bound of price range (0-1, default: 0.95)

Examples:
  npx ts-node addLiquidityWorking.ts 0x21a70e522adb02dfb51ac9970c97f710f1e17034 0.1
  npx ts-node addLiquidityWorking.ts 0x21a70e522adb02dfb51ac9970c97f710f1e17034 0.5 0.1 0.9
  npx ts-node addLiquidityWorking.ts 0x21a70e522adb02dfb51ac9970c97f710f1e17034 1.0 0.2 0.8

Environment variables required:
  RPC_URL        The RPC endpoint for Gnosis Chain
  PRIVATE_KEY    Your private key (without 0x prefix)
  GRAPH_API_KEY  Your Graph API key
    `);
    process.exit(0);
  }

  if (args.length < 2) {
    console.error("❌ Error: Missing required arguments");
    console.error("Run 'npx ts-node addLiquidityWorking.ts --help' for usage information");
    process.exit(1);
  }

  const marketAddress = args[0];
  const amount = parseFloat(args[1]);
  const lowerBound = args[2] ? parseFloat(args[2]) : 0.05;
  const upperBound = args[3] ? parseFloat(args[3]) : 0.95;

  // Validate inputs
  if (!marketAddress || !marketAddress.startsWith('0x') || marketAddress.length !== 42) {
    console.error("❌ Error: Invalid market address. Must be a valid Ethereum address (0x...)");
    process.exit(1);
  }

  if (isNaN(amount) || amount < 0.1) {
    console.error("❌ Error: Invalid amount. Must be at least 0.1 sDAI");
    process.exit(1);
  }

  if (isNaN(lowerBound) || lowerBound < 0 || lowerBound > 1) {
    console.error("❌ Error: Invalid lowerBound. Must be between 0 and 1");
    process.exit(1);
  }

  if (isNaN(upperBound) || upperBound < 0 || upperBound > 1) {
    console.error("❌ Error: Invalid upperBound. Must be between 0 and 1");
    process.exit(1);
  }

  if (lowerBound >= upperBound) {
    console.error("❌ Error: lowerBound must be less than upperBound");
    process.exit(1);
  }

  // Validate environment variables
  if (!process.env.RPC_URL) {
    console.error("❌ Error: RPC_URL environment variable is required");
    process.exit(1);
  }

  if (!process.env.PRIVATE_KEY) {
    console.error("❌ Error: PRIVATE_KEY environment variable is required");
    process.exit(1);
  }

  if (!process.env.GRAPH_API_KEY) {
    console.error("❌ Error: GRAPH_API_KEY environment variable is required");
    process.exit(1);
  }

  const range: LiquidityRange = { lowerBound, upperBound };

  console.log("🚀 Adding liquidity to Seer prediction market...");
  console.log(`📍 Market Address: ${marketAddress}`);
  console.log(`💰 Amount: ${amount} sDAI`);
  console.log(`📊 Price Range: ${lowerBound} - ${upperBound}`);
  console.log("");

  try {
    await addLiquidityWorking(marketAddress, amount, range);
    console.log("✅ Successfully added liquidity to both pools!");
  } catch (error: any) {
    console.error("❌ Failed to add liquidity:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error: any) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });
}