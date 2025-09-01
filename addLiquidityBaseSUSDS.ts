#!/usr/bin/env node

import { providers, Wallet, Contract, BigNumber } from "ethers";
import { parseEther, getAddress, formatEther } from "ethers/lib/utils";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { Token } from "@uniswap/sdk-core";
import { nearestUsableTick } from "@uniswap/v3-sdk";
dotenv.config();

interface LiquidityRange {
  lowerBound: number; // 0 to 1
  upperBound: number; // 0 to 1
}

//// TICKS MANUAL MATH
const LN_1_0001 = Math.log(1.0001);
const priceToTick = (price: number): number => Math.log(price) / LN_1_0001;

// Base constants
const CHAIN_ID = 8453; // Base Chain ID

// Official Uniswap V3 addresses on Base
const UNISWAP_V3_FACTORY_ADDRESS = getAddress(
  "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" // Uniswap V3 Factory on Base
);

const UNISWAP_V3_POSITION_MANAGER_ADDRESS = getAddress(
  "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1" // Uniswap V3 Position Manager on Base
);

// Seer protocol router for Base
const SEER_BASE_ROUTER = getAddress(
  "0x3124e97ebF4c9592A17d40E54623953Ff3c77a73" 
);

const THEGRAPH_URL =
  "https://gateway.thegraph.com/api/subgraphs/id/ApaZsL18VaU8dbzNAsdxHTdMR3sV7bwqXF3wKjVrwu5Z";
const THEGRAPH_API_KEY = process.env.GRAPH_API_KEY;

// sUSDS address on Base (Savings USDS)
const SUSDS_ADDRESS = getAddress("0x5875eEE11Cf8398102FdAd704C9E96607675467a"); // sUSDS on Base

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
];

// Uniswap V3 Pool ABI (minimal)
const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function tickSpacing() view returns (int24)",
  "function fee() view returns (uint24)",
];

// Uniswap V3 NonfungiblePositionManager ABI (minimal)
const POSITION_MANAGER_ABI = [
  "function mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256)) payable returns (uint256,uint128,uint256,uint256)",
];

const SEER_BASE_ROUTER_ABI = [
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

async function addLiquidityToExistingPool(
  wallet: Wallet,
  tokenA: Token,
  tokenB: Token,
  amountA: BigNumber,
  amountB: BigNumber,
  range: LiquidityRange,
  fee: number = 3000 // 0.3% fee tier
): Promise<void> {
  // Sort tokens for consistent ordering (lexicographic)
  const [token0, token1] =
    tokenA.address.toLowerCase() < tokenB.address.toLowerCase()
      ? [tokenA, tokenB]
      : [tokenB, tokenA];

  const PRICE_MIN =
    token1.address.toLowerCase() === SUSDS_ADDRESS.toLowerCase()
      ? range.lowerBound
      : 1 / range.upperBound;
  const PRICE_MAX =
    token1.address.toLowerCase() === SUSDS_ADDRESS.toLowerCase()
      ? range.upperBound
      : 1 / range.lowerBound;

  // Determine amounts based on token order
  const [amount0Desired, amount1Desired] =
    tokenA.address.toLowerCase() < tokenB.address.toLowerCase()
      ? [amountA, amountB]
      : [amountB, amountA];

  console.log(`Adding liquidity to ${token0.symbol}/${token1.symbol} pool`);
  console.log(`Amounts: ${formatEther(amount0Desired)} ${token0.symbol}, ${formatEther(amount1Desired)} ${token1.symbol}`);

  // Check if pool exists
  const factory = new Contract(UNISWAP_V3_FACTORY_ADDRESS, FACTORY_ABI, wallet);
  const poolAddress = await factory.getPool(token0.address, token1.address, fee);

  if (poolAddress === "0x0000000000000000000000000000000000000000") {
    throw new Error(`Pool doesn't exist for ${token0.symbol}/${token1.symbol} with ${fee/10000}% fee. Please create the pool first or use a different fee tier.`);
  }

  console.log(`Pool exists at: ${poolAddress}, adding liquidity...`);

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
    amount0Desired,
    { gasLimit: 100_000 }
  );
  await approveTxA.wait();

  const approveTxB = await tokenBContract.approve(
    UNISWAP_V3_POSITION_MANAGER_ADDRESS,
    amount1Desired,
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
    amount0Desired,
    amount1Desired,
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
    amount0Desired: formatEther(amount0Desired),
    amount1Desired: formatEther(amount1Desired),
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

export async function addLiquidityBaseSUSDS(
  marketAddress: string,
  amount: number,
  lowerBound: number,
  upperBound: number
): Promise<void> {
  console.log("🚀 Adding liquidity to Seer prediction market on Base with sUSDS...");
  console.log(`📍 Market Address: ${marketAddress}`);
  console.log(`💰 Amount: ${amount} sUSDS`);
  console.log(`📊 Price Range: ${lowerBound} - ${upperBound}`);

  // Setup wallet and provider for Base
  const provider = new providers.JsonRpcProvider(process.env.BASE_URL || "https://mainnet.base.org");
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY not found in environment variables");
  }
  const wallet = new Wallet(privateKey, provider);

  // Check sUSDS balance
  const susdsContract = new Contract(SUSDS_ADDRESS, ERC20_ABI, wallet);
  const susdsBalance = await susdsContract.balanceOf(wallet.address);
  const susdsDecimals = await susdsContract.decimals();
  const amountWei = parseEther(amount.toString());
  
  console.log(`💰 Current sUSDS balance: ${formatEther(susdsBalance)} sUSDS`);
  console.log(`💰 sUSDS decimals: ${susdsDecimals}`);

  if (susdsBalance.lt(amountWei)) {
    throw new Error(`Insufficient sUSDS balance. Need ${amount} sUSDS, have ${formatEther(susdsBalance)} sUSDS`);
  }

  // Get market tokens
  const tokens = await getMarketTokens(marketAddress);
  if (tokens.length !== 2) {
    throw new Error(`Expected 3 tokens, got ${tokens.length}`);
  }

  const [downToken, upToken] = tokens;
  console.log(`DOWN token: ${downToken}, UP token: ${upToken}`);
  console.log(`sUSDS address: ${SUSDS_ADDRESS}`);

  // Use the full amount for minting (splitPosition) - this gives us equal amounts of UP and DOWN tokens
  const mintAmount = amountWei;

  console.log(`📊 Minting ${formatEther(mintAmount)} sUSDS worth of UP/DOWN tokens`);

  // Approve sUSDS for router
  console.log("Approving sUSDS for router...");
  const approveTx = await susdsContract.approve(SEER_BASE_ROUTER, mintAmount, {
    gasLimit: 100_000
  });
  // log txn hash
  console.log(`Approved sUSDS for router. Transaction: ${approveTx.hash}`);
  await approveTx.wait();

  // Mint UP/DOWN tokens by splitting position (this is the "mint" function you mentioned)
  console.log(`🪙 Minting ${formatEther(mintAmount)} sUSDS into UP/DOWN tokens using splitPosition`);
  const seerRouter = new Contract(SEER_BASE_ROUTER, SEER_BASE_ROUTER_ABI, wallet);
  const splitTx = await seerRouter.splitPosition(marketAddress, SUSDS_ADDRESS, mintAmount, {
    gasLimit: 300_000
  });
  await splitTx.wait();

  // Check token balances after minting
  const downTokenContract = new Contract(downToken, ERC20_ABI, wallet);
  const upTokenContract = new Contract(upToken, ERC20_ABI, wallet);
  const downBalance = await downTokenContract.balanceOf(wallet.address);
  const upBalance = await upTokenContract.balanceOf(wallet.address);
  const remainingSUSDS = await susdsContract.balanceOf(wallet.address);

  console.log(`Token balances after minting:`);
  console.log(`  - DOWN: ${formatEther(downBalance)}`);
  console.log(`  - UP: ${formatEther(upBalance)}`);
  console.log(`  - Remaining sUSDS: ${formatEther(remainingSUSDS)}`);

  // Calculate liquidity amounts - use a portion of the minted tokens based on the range
  // The range determines how much of our minted tokens we want to provide as liquidity
  const rangeSize = upperBound - lowerBound;
  const liquidityRatio = Math.min(rangeSize, 0.8); // Cap at 80% to avoid using all tokens
  
  const downLiquidityAmount = downBalance.mul(Math.floor(liquidityRatio * 100)).div(100);
  const upLiquidityAmount = upBalance.mul(Math.floor(liquidityRatio * 100)).div(100);
  
  // We need some sUSDS for liquidity too - use remaining sUSDS or a small portion
  const susdsForLiquidity = remainingSUSDS.gt(0) ? remainingSUSDS : parseEther((amount * 0.1).toString());

  console.log(`📊 Liquidity amounts (${(liquidityRatio * 100).toFixed(1)}% of minted tokens):`);
  console.log(`  - DOWN for liquidity: ${formatEther(downLiquidityAmount)}`);
  console.log(`  - UP for liquidity: ${formatEther(upLiquidityAmount)}`);
  console.log(`  - sUSDS for liquidity: ${formatEther(susdsForLiquidity)}`);

  // Create Token instances for Uniswap SDK
  const downTokenInstance = new Token(CHAIN_ID, downToken, 18, "DOWN", "Down Token");
  const upTokenInstance = new Token(CHAIN_ID, upToken, 18, "UP", "Up Token");
  const susdsTokenInstance = new Token(CHAIN_ID, SUSDS_ADDRESS, susdsDecimals, "sUSDS", "Savings USDS");

  console.log("Created Token instances for Uniswap SDK");

  const range: LiquidityRange = { lowerBound, upperBound };

  try {
    // Add liquidity to existing pools only (no pool creation)
    console.log(`\n🔄 Adding liquidity to DOWN/sUSDS pool...`);
    await addLiquidityToExistingPool(wallet, downTokenInstance, susdsTokenInstance, downLiquidityAmount, susdsForLiquidity.div(2), range);

    console.log(`\n🔄 Adding liquidity to UP/sUSDS pool...`);
    await addLiquidityToExistingPool(wallet, upTokenInstance, susdsTokenInstance, upLiquidityAmount, susdsForLiquidity.div(2), range);

    console.log(`\n✅ Successfully added liquidity to both existing pools on Base with sUSDS!`);
  } catch (error: any) {
    console.error(`❌ Error adding liquidity: ${error.message}`);
    console.log(`\n💡 Note: This script only adds liquidity to existing pools. If pools don't exist, you'll need to create them first or use a different tool.`);
    throw error;
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.log(`
🚀 Seer Liquidity Addition Tool (Base + sUSDS) - Gas Optimized Version

This tool:
1. Mints UP/DOWN tokens using Seer's splitPosition (no pool creation costs!)
2. Adds liquidity to existing Uniswap V3 pools only
3. Uses a portion of minted tokens based on your specified range

Usage: npx ts-node addLiquidityBaseSUSDS.ts <marketAddress> <amount> <lowerBound> <upperBound>

Parameters:
  marketAddress  - Seer market contract address
  amount        - Amount of sUSDS to mint into UP/DOWN tokens
  lowerBound    - Lower price bound (0-1, e.g., 0.3 = 30%)
  upperBound    - Upper price bound (0-1, e.g., 0.7 = 70%)

Example: npx ts-node addLiquidityBaseSUSDS.ts 0xA5B02a72E230399301d7f8ecb3e4BAf9c6C2B752 0.01 0.3 0.7

Note: This script requires existing UP/sUSDS and DOWN/sUSDS pools. 
      If pools don't exist, create them first using a different tool.
`);
    process.exit(1);
  }

  const [marketAddress, amountStr, lowerBoundStr, upperBoundStr] = args;
  const amount = parseFloat(amountStr);
  const lowerBound = parseFloat(lowerBoundStr);
  const upperBound = parseFloat(upperBoundStr);

  if (amount <= 0 || lowerBound < 0 || upperBound > 1 || lowerBound >= upperBound) {
    console.error("❌ Invalid parameters:");
    console.error("  - amount must be > 0");
    console.error("  - lowerBound must be >= 0");
    console.error("  - upperBound must be <= 1");
    console.error("  - lowerBound must be < upperBound");
    process.exit(1);
  }

  addLiquidityBaseSUSDS(marketAddress, amount, lowerBound, upperBound)
    .then(() => {
      console.log("✅ Liquidity addition completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Error adding liquidity:", error);
      process.exit(1);
    });
}