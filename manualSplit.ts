#!/usr/bin/env node

import { providers, Wallet, Contract } from "ethers";
import { parseEther, getAddress, formatEther } from "ethers/lib/utils";
import * as dotenv from "dotenv";
dotenv.config();

const SEER_GNOSIS_ROUTER = getAddress("0xeC9048b59b3467415b1a38F63416407eA0c70fB8");
const SDAI_ADDRESS = getAddress("0xaf204776c7245bF4147c2612BF6e5972Ee483701");

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
];

const SEER_GNOSIS_ROUTER_ABI = [
  "function splitPosition(address,address,uint256) external",
];

async function manualSplit() {
  const provider = new providers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);
  
  const marketAddress = "0x21a70e522adb02dfb51ac9970c97f710f1e17034";
  const amount = parseEther("0.5"); // 0.5 sDAI
  
  console.log("🔄 Manual split of 0.5 sDAI...");
  
  const sDAIToken = new Contract(SDAI_ADDRESS, ERC20_ABI, wallet);
  const router = new Contract(SEER_GNOSIS_ROUTER, SEER_GNOSIS_ROUTER_ABI, wallet);

  // Check balance
  const balance = await sDAIToken.balanceOf(wallet.address);
  console.log(`💰 sDAI balance: ${formatEther(balance)}`);

  // Approve
  const allowance = await sDAIToken.allowance(wallet.address, SEER_GNOSIS_ROUTER);
  if (allowance.lt(amount)) {
    console.log("📝 Approving...");
    const approveTx = await sDAIToken.approve(SEER_GNOSIS_ROUTER, amount);
    await approveTx.wait();
  }

  // Split
  console.log("🔄 Splitting...");
  const splitTx = await router.splitPosition(SDAI_ADDRESS, marketAddress, amount, {
    gasLimit: 800_000
  });
  await splitTx.wait();
  
  console.log(`✅ Split successful! Transaction: ${splitTx.hash}`);
  console.log("Now you have conditional tokens that you can trade or provide liquidity with manually.");
}

manualSplit().catch(console.error);