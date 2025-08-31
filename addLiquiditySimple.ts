#!/usr/bin/env node

import { providers, Wallet, Contract, BigNumber } from "ethers";
import { parseEther, getAddress, formatEther } from "ethers/lib/utils";
import * as dotenv from "dotenv";
import { Token } from "@uniswap/sdk-core";
import { encodeSqrtRatioX96, nearestUsableTick } from "@uniswap/v3-sdk";
dotenv.config();

interface LiquidityRange {
  lowerBound: number;
  upperBound: number;
}

const LN_1_0001 = Math.log(1.0001);
const priceToTick = (price: number): number => Math.log(price) / LN_1_0001;

// Constants
const CHAIN_ID = 100;
const UNISWAP_V3_FACTORY_ADDRESS = getAddress("0xf78031CBCA409F2FB6876BDFDBc1b2df24cF9bEf");
const UNISWAP_V3_POSITION_MANAGER_ADDRESS = getAddress("0xCd03e2e276F6EEdD424d41314437531F665187b9");
const SEER_GNOSIS_ROUTER = getAddress("0xeC9048b59b3467415b1a38F63416407eA0c70fB8");
const SDAI_ADDRESS = getAddress("0xaf204776c7245bF4147c2612BF6e5972Ee483701");

const THEGRAPH_URL = "https://gateway.thegraph.com/api/subgraphs/id/B4vyRqJaSHD8dRDb3BFRoAzuBK18c1QQcXq94JbxDxWH";
const THEGRAPH_API_KEY = process.env.GRAPH_API_KEY;

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
];

const FACTORY_ABI = [
  "function getPool(address, address, uint24) view returns (address)",
  "function createPool(address, address, uint24) returns (address)",
];

const POOL_ABI = [
  "function initialize(uint160) external",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
];

const POSITION_MANAGER_ABI = [
  "function mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256)) payable returns (uint256,uint128,uint256,uint256)",
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
  return wrappedTokens.slice(0, -1);
}

async function createPoolStepByStep(
  wallet: Wallet,
  tokenA: Token,
  tokenB: Token,
  range: LiquidityRange,
  fee: number = 3000
): Promise<string> {
  const factory = new Contract(UNISWAP_V3_FACTORY_ADDRESS, FACTORY_ABI, wallet);

  // Sort tokens
  const [token0, token1] = tokenA.address.toLowerCase() < tokenB.address.toLowerCase()
    ? [tokenA, tokenB] : [tokenB, tokenA];

  console.log(`Creating pool for ${token0.symbol}/${token1.symbol}...`);

  // Check if pool exists
  let poolAddress = await factory.getPool(token0.address, token1.address, fee);
  
  if (poolAddress === "0x0000000000000000000000000000000000000000") {
    console.log("Pool doesn't exist, creating...");
    
    // Create pool
    const createTx = await factory.createPool(token0.address, token1.address, fee, {
      gasLimit: 1_000_000
    });
    await createTx.wait();
    console.log(`Pool created: ${createTx.hash}`);
    
    // Get the new pool address
    poolAddress = await factory.getPool(token0.address, token1.address, fee);
    console.log(`New pool address: ${poolAddress}`);
    
    // Initialize pool with price
    const PRICE_MIN = token1.address.toLowerCase() === SDAI_ADDRESS.toLowerCase()
      ? range.lowerBound : 1 / range.upperBound;
    const PRICE_MAX = token1.address.toLowerCase() === SDAI_ADDRESS.toLowerCase()
      ? range.upperBound : 1 / range.lowerBound;
    
    const midpoint = (PRICE_MIN + PRICE_MAX) / 2;
    console.log(`Initializing pool with price: ${midpoint}`);
    
    // Use more conservative precision to avoid overflow
    const sqrtPriceX96JSBI = encodeSqrtRatioX96(
      Math.floor(midpoint * 1e4), // Reduced precision
      1e4
    );
    const sqrtPriceX96 = BigNumber.from(sqrtPriceX96JSBI.toString());
    
    const pool = new Contract(poolAddress, POOL_ABI, wallet);
    const initTx = await pool.initialize(sqrtPriceX96, {
      gasLimit: 500_000
    });
    await initTx.wait();
    console.log(`Pool initialized: ${initTx.hash}`);
  } else {
    console.log(`Pool already exists: ${poolAddress}`);
  }
  
  return poolAddress;
}

async function addLiquidityToExistingPool(
  wallet: Wallet,
  tokenA: Token,
  tokenB: Token,
  amountA: BigNumber,
  amountB: BigNumber,
  range: LiquidityRange,
  fee: number = 3000
): Promise<void> {
  // Sort tokens
  const [token0, token1] = tokenA.address.toLowerCase() < tokenB.address.toLowerCase()
    ? [tokenA, tokenB] : [tokenB, tokenA];
  
  const [amount0, amount1] = tokenA.address.toLowerCase() < tokenB.address.toLowerCase()
    ? [amountA, amountB] : [amountB, amountA];

  console.log(`Adding liquidity: ${formatEther(amount0)} ${token0.symbol}, ${formatEther(amount1)} ${token1.symbol}`);

  // Calculate price range
  const PRICE_MIN = token1.address.toLowerCase() === SDAI_ADDRESS.toLowerCase()
    ? range.lowerBound : 1 / range.upperBound;
  const PRICE_MAX = token1.address.toLowerCase() === SDAI_ADDRESS.toLowerCase()
    ? range.upperBound : 1 / range.lowerBound;

  // Calculate ticks
  const rawLower = priceToTick(PRICE_MIN);
  const rawUpper = priceToTick(PRICE_MAX);
  const tickSpacing = 60;
  const lowerTick = nearestUsableTick(Math.floor(rawLower), tickSpacing);
  const upperTick = nearestUsableTick(Math.ceil(rawUpper), tickSpacing);

  console.log(`Price range: ${PRICE_MIN}-${PRICE_MAX}, Ticks: [${lowerTick}, ${upperTick}]`);

  // Approve tokens
  const tokenAContract = new Contract(tokenA.address, ERC20_ABI, wallet);
  const tokenBContract = new Contract(tokenB.address, ERC20_ABI, wallet);

  console.log("Approving tokens...");
  const approveTxA = await tokenAContract.approve(UNISWAP_V3_POSITION_MANAGER_ADDRESS, amountA);
  await approveTxA.wait();
  
  const approveTxB = await tokenBContract.approve(UNISWAP_V3_POSITION_MANAGER_ADDRESS, amountB);
  await approveTxB.wait();

  // Mint position
  const positionManager = new Contract(UNISWAP_V3_POSITION_MANAGER_ADDRESS, POSITION_MANAGER_ABI, wallet);
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

  const mintParams = [
    token0.address,
    token1.address,
    fee,
    lowerTick,
    upperTick,
    amount0,
    amount1,
    BigNumber.from(0), // amount0Min
    BigNumber.from(0), // amount1Min
    wallet.address,
    deadline,
  ];

  console.log("Minting position...");
  const mintTx = await positionManager.mint(mintParams, {
    gasLimit: 2_000_000
  });
  await mintTx.wait();
  
  console.log(`✅ Liquidity added: ${mintTx.hash}`);
}

export async function addLiquiditySimple(
  marketAddress: string,
  amount: number,
  range: LiquidityRange
): Promise<void> {
  if (amount < 0.1) {
    throw new Error("Minimum amount is 0.1 sDAI");
  }

  const provider = new providers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);

  try {
    console.log("🚀 Starting simple liquidity addition...");
    
    // 1. Get market tokens
    const tokenAddresses = await getMarketTokens(marketAddress);
    const [downTokenAddress, upTokenAddress] = tokenAddresses;
    console.log(`DOWN: ${downTokenAddress}, UP: ${upTokenAddress}`);

    // 2. Split position
    const splitAmount = parseEther((amount / 2).toFixed(18));
    const sDAIAmountPerPool = parseEther((amount / 4).toFixed(18));

    const sDAIToken = new Contract(SDAI_ADDRESS, ERC20_ABI, wallet);
    const router = new Contract(SEER_GNOSIS_ROUTER, SEER_GNOSIS_ROUTER_ABI, wallet);

    // Approve and split
    const allowance = await sDAIToken.allowance(wallet.address, SEER_GNOSIS_ROUTER);
    if (allowance.lt(splitAmount)) {
      console.log("Approving sDAI...");
      const approveTx = await sDAIToken.approve(SEER_GNOSIS_ROUTER, splitAmount);
      await approveTx.wait();
    }

    console.log(`Splitting ${formatEther(splitAmount)} sDAI...`);
    const splitTx = await router.splitPosition(SDAI_ADDRESS, marketAddress, splitAmount, {
      gasLimit: 1_000_000
    });
    await splitTx.wait();
    console.log("✅ Split completed");

    // 3. Get token balances
    const downToken = new Contract(downTokenAddress, ERC20_ABI, wallet);
    const upToken = new Contract(upTokenAddress, ERC20_ABI, wallet);
    const downBalance = await downToken.balanceOf(wallet.address);
    const upBalance = await upToken.balanceOf(wallet.address);

    console.log(`Token balances - DOWN: ${formatEther(downBalance)}, UP: ${formatEther(upBalance)}`);

    // 4. Create Token instances
    const downTokenSdk = new Token(CHAIN_ID, downTokenAddress, 18, "DOWN", "DOWN");
    const upTokenSdk = new Token(CHAIN_ID, upTokenAddress, 18, "UP", "UP");
    const sDAITokenSdk = new Token(CHAIN_ID, SDAI_ADDRESS, 18, "sDAI", "sDAI");

    // 5. Create pools step by step
    console.log("🔄 Creating DOWN/sDAI pool...");
    await createPoolStepByStep(wallet, downTokenSdk, sDAITokenSdk, range);
    
    console.log("🔄 Creating UP/sDAI pool...");
    await createPoolStepByStep(wallet, upTokenSdk, sDAITokenSdk, range);

    // 6. Add liquidity to pools
    console.log("🔄 Adding liquidity to DOWN/sDAI pool...");
    await addLiquidityToExistingPool(
      wallet, downTokenSdk, sDAITokenSdk, 
      downBalance, sDAIAmountPerPool, range
    );

    console.log("🔄 Adding liquidity to UP/sDAI pool...");
    await addLiquidityToExistingPool(
      wallet, upTokenSdk, sDAITokenSdk, 
      upBalance, sDAIAmountPerPool, range
    );

    console.log("✅ Successfully added liquidity to both pools!");

  } catch (error: any) {
    console.error("❌ Error:", error);
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`
Usage: npx ts-node addLiquiditySimple.ts <marketAddress> <amount> [lowerBound] [upperBound]

This version creates pools step-by-step instead of using multicall.

Arguments:
  marketAddress   The address of the Seer prediction market
  amount         The amount of sDAI to use (minimum: 0.1)
  lowerBound     Lower bound of price range (0-1, default: 0.05)
  upperBound     Upper bound of price range (0-1, default: 0.95)

Example:
  npx ts-node addLiquiditySimple.ts 0x21a70e522adb02dfb51ac9970c97f710f1e17034 0.5 0.3 0.7
    `);
    process.exit(0);
  }

  const marketAddress = args[0];
  const amount = parseFloat(args[1]);
  const lowerBound = args[2] ? parseFloat(args[2]) : 0.05;
  const upperBound = args[3] ? parseFloat(args[3]) : 0.95;

  const range: LiquidityRange = { lowerBound, upperBound };

  console.log("🚀 Simple liquidity addition");
  console.log(`📍 Market: ${marketAddress}`);
  console.log(`💰 Amount: ${amount} sDAI`);
  console.log(`📊 Range: ${lowerBound} - ${upperBound}`);

  try {
    await addLiquiditySimple(marketAddress, amount, range);
  } catch (error: any) {
    console.error("❌ Failed:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}