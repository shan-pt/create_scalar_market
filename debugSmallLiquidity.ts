import { providers, Wallet, Contract, BigNumber } from "ethers";
import { parseEther, getAddress, formatEther } from "ethers/lib/utils";
import * as dotenv from "dotenv";
import { Token } from "@uniswap/sdk-core";
import { encodeSqrtRatioX96, TickMath, nearestUsableTick } from "@uniswap/v3-sdk";
dotenv.config();

// Constants
const CHAIN_ID = 100;
const UNISWAP_V3_FACTORY_ADDRESS = getAddress("0xf78031CBCA409F2FB6876BDFDBc1b2df24cF9bEf");
const UNISWAP_V3_POSITION_MANAGER_ADDRESS = getAddress("0xCd03e2e276F6EEdD424d41314437531F665187b9");
const SEER_GNOSIS_ROUTER = getAddress("0xeC9048b59b3467415b1a38F63416407eA0c70fB8");
const SDAI_ADDRESS = getAddress("0xaf204776c7245bF4147c2612BF6e5972Ee483701");

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
];

const FACTORY_ABI = [
  "function getPool(address, address, uint24) view returns (address)",
];

const SEER_GNOSIS_ROUTER_ABI = [
  "function splitPosition(address,address,uint256) external",
];

const THEGRAPH_URL = "https://gateway.thegraph.com/api/subgraphs/id/B4vyRqJaSHD8dRDb3BFRoAzuBK18c1QQcXq94JbxDxWH";
const THEGRAPH_API_KEY = process.env.GRAPH_API_KEY;

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

async function debugSmallLiquidity() {
  const provider = new providers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);
  
  const marketAddress = "0x21a70e522adb02dfb51ac9970c97f710f1e17034";
  const amount = 0.01;

  console.log("🔍 Debugging small liquidity addition...");
  console.log(`Market: ${marketAddress}`);
  console.log(`Amount: ${amount} sDAI`);

  try {
    // 1. Check balances
    const sDAIToken = new Contract(SDAI_ADDRESS, ERC20_ABI, wallet);
    const balance = await sDAIToken.balanceOf(wallet.address);
    console.log(`💰 sDAI balance: ${formatEther(balance)}`);

    // 2. Get market tokens
    const tokenAddresses = await getMarketTokens(marketAddress);
    const [downTokenAddress, upTokenAddress] = tokenAddresses;
    console.log(`📊 DOWN: ${downTokenAddress}`);
    console.log(`📊 UP: ${upTokenAddress}`);

    // 3. Check if pools exist
    const factory = new Contract(UNISWAP_V3_FACTORY_ADDRESS, FACTORY_ABI, wallet);
    const downPool = await factory.getPool(downTokenAddress, SDAI_ADDRESS, 3000);
    const upPool = await factory.getPool(upTokenAddress, SDAI_ADDRESS, 3000);
    
    console.log(`🏊 DOWN/sDAI pool: ${downPool}`);
    console.log(`🏊 UP/sDAI pool: ${upPool}`);

    // 4. Test split position with very small amount
    const splitAmount = parseEther("0.005"); // Half of 0.01
    console.log(`🔄 Testing split with ${formatEther(splitAmount)} sDAI...`);

    // Check allowance
    const allowance = await sDAIToken.allowance(wallet.address, SEER_GNOSIS_ROUTER);
    console.log(`✅ Current allowance: ${formatEther(allowance)}`);

    if (allowance.lt(splitAmount)) {
      console.log("📝 Approving sDAI for router...");
      const approveTx = await sDAIToken.approve(SEER_GNOSIS_ROUTER, splitAmount);
      await approveTx.wait();
      console.log("✅ Approved!");
    }

    // Split position
    const router = new Contract(SEER_GNOSIS_ROUTER, SEER_GNOSIS_ROUTER_ABI, wallet);
    console.log("🔄 Splitting position...");
    const splitTx = await router.splitPosition(SDAI_ADDRESS, marketAddress, splitAmount, {
      gasLimit: 500_000
    });
    await splitTx.wait();
    console.log("✅ Split successful!");

    // Check token balances after split
    const downToken = new Contract(downTokenAddress, ERC20_ABI, wallet);
    const upToken = new Contract(upTokenAddress, ERC20_ABI, wallet);
    
    const downBalance = await downToken.balanceOf(wallet.address);
    const upBalance = await upToken.balanceOf(wallet.address);
    
    console.log(`📊 After split:`);
    console.log(`  DOWN: ${formatEther(downBalance)}`);
    console.log(`  UP: ${formatEther(upBalance)}`);

    // 5. Test tick calculations
    const range = { lowerBound: 0.05, upperBound: 0.95 };
    const LN_1_0001 = Math.log(1.0001);
    const priceToTick = (price: number): number => Math.log(price) / LN_1_0001;
    
    const PRICE_MIN = range.lowerBound;
    const PRICE_MAX = range.upperBound;
    
    const rawLower = priceToTick(PRICE_MIN);
    const rawUpper = priceToTick(PRICE_MAX);
    const tickSpacing = 60;
    const lowerTick = nearestUsableTick(Math.floor(rawLower), tickSpacing);
    const upperTick = nearestUsableTick(Math.ceil(rawUpper), tickSpacing);
    
    console.log(`🎯 Tick calculations:`);
    console.log(`  Price range: ${PRICE_MIN} - ${PRICE_MAX}`);
    console.log(`  Raw ticks: ${rawLower} - ${rawUpper}`);
    console.log(`  Usable ticks: ${lowerTick} - ${upperTick}`);

    // 6. Test sqrt price calculation
    const midpoint = (PRICE_MIN + PRICE_MAX) / 2;
    console.log(`📐 Midpoint price: ${midpoint}`);
    
    try {
      const sqrtPriceX96JSBI = encodeSqrtRatioX96(
        Math.floor(midpoint * 1e6),
        1e6
      );
      const sqrtPriceX96 = BigNumber.from(sqrtPriceX96JSBI.toString());
      console.log(`✅ SqrtPriceX96: ${sqrtPriceX96.toString()}`);
    } catch (error) {
      console.error(`❌ SqrtPrice calculation failed:`, error);
    }

    console.log("✅ Debug completed successfully!");

  } catch (error) {
    console.error("❌ Debug failed:", error);
  }
}

debugSmallLiquidity().catch(console.error);