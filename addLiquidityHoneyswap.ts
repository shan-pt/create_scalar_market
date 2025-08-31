#!/usr/bin/env node

import { providers, Wallet, Contract, BigNumber } from "ethers";
import { parseEther, getAddress, formatEther } from "ethers/lib/utils";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();

// Honeyswap (Uniswap V2 fork) addresses on Gnosis Chain
const CHAIN_ID = 100; // Gnosis Chain ID
const HONEYSWAP_ROUTER_ADDRESS = getAddress("0x1C232F01118CB8B424793ae03F870aa7D0ac7f77");
const HONEYSWAP_FACTORY_ADDRESS = getAddress("0xA818b4F111Ccac7AA31D0BCc0806d64F2E0737D7");

// Keep the same router for splitting positions
const SEER_GNOSIS_ROUTER = getAddress("0xeC9048b59b3467415b1a38F63416407eA0c70fB8");

const THEGRAPH_URL = "https://gateway.thegraph.com/api/subgraphs/id/B4vyRqJaSHD8dRDb3BFRoAzuBK18c1QQcXq94JbxDxWH";
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

// Honeyswap Router ABI (Uniswap V2 style)
const HONEYSWAP_ROUTER_ABI = [
  "function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256) external returns (uint256,uint256,uint256)",
  "function getAmountsOut(uint256,address[]) view returns (uint256[])",
  "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) external returns (uint256[])",
];

// Honeyswap Factory ABI
const HONEYSWAP_FACTORY_ABI = [
  "function getPair(address,address) view returns (address)",
  "function createPair(address,address) returns (address)",
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

async function addLiquidityToHoneyswap(
  wallet: Wallet,
  tokenA: string,
  tokenB: string,
  amountA: BigNumber,
  amountB: BigNumber
): Promise<void> {
  const router = new Contract(HONEYSWAP_ROUTER_ADDRESS, HONEYSWAP_ROUTER_ABI, wallet);
  const factory = new Contract(HONEYSWAP_FACTORY_ADDRESS, HONEYSWAP_FACTORY_ABI, wallet);
  
  console.log(`🔄 Adding liquidity to Honeyswap pool...`);
  console.log(`Tokens: ${tokenA} / ${tokenB}`);
  console.log(`Amounts: ${formatEther(amountA)} / ${formatEther(amountB)}`);

  // Check if pair exists
  const pairAddress = await factory.getPair(tokenA, tokenB);
  if (pairAddress === "0x0000000000000000000000000000000000000000") {
    console.log("Pair doesn't exist, it will be created automatically");
  } else {
    console.log(`Pair exists at: ${pairAddress}`);
  }

  // Approve tokens for router
  const tokenAContract = new Contract(tokenA, ERC20_ABI, wallet);
  const tokenBContract = new Contract(tokenB, ERC20_ABI, wallet);

  console.log("Approving tokens for Honeyswap router...");
  
  const approveTxA = await tokenAContract.approve(HONEYSWAP_ROUTER_ADDRESS, amountA, {
    gasLimit: 100_000
  });
  await approveTxA.wait();

  const approveTxB = await tokenBContract.approve(HONEYSWAP_ROUTER_ADDRESS, amountB, {
    gasLimit: 100_000
  });
  await approveTxB.wait();

  console.log("Tokens approved, adding liquidity...");

  // Add liquidity (with 5% slippage tolerance)
  const amountAMin = amountA.mul(95).div(100); // 5% slippage
  const amountBMin = amountB.mul(95).div(100); // 5% slippage
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now

  const addLiquidityTx = await router.addLiquidity(
    tokenA,
    tokenB,
    amountA,
    amountB,
    amountAMin,
    amountBMin,
    wallet.address,
    deadline,
    {
      gasLimit: 500_000
    }
  );

  const receipt = await addLiquidityTx.wait();
  console.log(`✅ Liquidity added successfully! Transaction: ${receipt.transactionHash}`);
}

export async function addLiquidityHoneyswap(
  marketAddress: string,
  amount: number,
  lowerBound: number,
  upperBound: number
): Promise<void> {
  console.log("🚀 Adding liquidity to Seer prediction market using Honeyswap...");
  console.log(`📍 Market Address: ${marketAddress}`);
  console.log(`💰 Amount: ${amount} sDAI`);
  console.log(`📊 Note: Honeyswap uses constant product pools (no price ranges like Uniswap V3)`);

  // Setup wallet and provider
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
  const seerRouter = new Contract(SEER_GNOSIS_ROUTER, SEER_GNOSIS_ROUTER_ABI, wallet);
  const splitTx = await seerRouter.splitPosition(marketAddress, SDAI_ADDRESS, splitAmount, {
    gasLimit: 300_000
  });
  await splitTx.wait();

  // Check token balances after split
  const downTokenContract = new Contract(downToken, ERC20_ABI, wallet);
  const upTokenContract = new Contract(upToken, ERC20_ABI, wallet);
  const downBalance = await downTokenContract.balanceOf(wallet.address);
  const upBalance = await upTokenContract.balanceOf(wallet.address);
  const newSDAIBalance = await sDAIContract.balanceOf(wallet.address);

  console.log(`Token balances after split - DOWN: ${formatEther(downBalance)}, UP: ${formatEther(upBalance)}, sDAI: ${formatEther(newSDAIBalance)}`);

  // Add liquidity to both pools
  console.log(`\n🔄 Adding liquidity to DOWN/sDAI pool...`);
  await addLiquidityToHoneyswap(wallet, downToken, SDAI_ADDRESS, downBalance, sDAIPerPool);

  console.log(`\n🔄 Adding liquidity to UP/sDAI pool...`);
  await addLiquidityToHoneyswap(wallet, upToken, SDAI_ADDRESS, upBalance, sDAIPerPool);

  console.log(`\n✅ Successfully added liquidity to both pools using Honeyswap!`);
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.log("Usage: npx ts-node addLiquidityHoneyswap.ts <marketAddress> <amount> <lowerBound> <upperBound>");
    console.log("Note: lowerBound and upperBound are ignored for Honeyswap (constant product pools)");
    process.exit(1);
  }

  const [marketAddress, amountStr, lowerBoundStr, upperBoundStr] = args;
  const amount = parseFloat(amountStr);
  const lowerBound = parseFloat(lowerBoundStr);
  const upperBound = parseFloat(upperBoundStr);

  addLiquidityHoneyswap(marketAddress, amount, lowerBound, upperBound)
    .then(() => {
      console.log("✅ Liquidity addition completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Error adding liquidity:", error);
      process.exit(1);
    });
}