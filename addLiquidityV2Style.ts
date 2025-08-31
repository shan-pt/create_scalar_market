#!/usr/bin/env node

import { providers, Wallet, Contract, utils, BigNumber } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const ROUTER_ABI = [
  "function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256) returns (uint256,uint256,uint256)",
  "function factory() view returns (address)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function symbol() view returns (string)",
];

async function addLiquidityV2Style() {
  console.log("🚀 Adding liquidity using V2-style router...\n");

  try {
    const provider = new providers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);

    const ROUTER_ADDRESS = "0xCd03e2e276F6EEdD424d41314437531F665187b9";
    const SDAI_ADDRESS = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";
    const DOWN_TOKEN = "0xE987315d1680577da7D027Bd4937976ec7eFd2Da";

    console.log(`Wallet: ${wallet.address}`);
    console.log(`Router: ${ROUTER_ADDRESS}`);

    // Create contracts
    const router = new Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet);
    const sDAI = new Contract(SDAI_ADDRESS, ERC20_ABI, wallet);
    const down = new Contract(DOWN_TOKEN, ERC20_ABI, wallet);

    // Check balances
    const sDAIBalance = await sDAI.balanceOf(wallet.address);
    const downBalance = await down.balanceOf(wallet.address);

    console.log(`\n💰 Balances:`);
    console.log(`sDAI: ${utils.formatEther(sDAIBalance)}`);
    console.log(`DOWN: ${utils.formatEther(downBalance)}`);

    // Check allowances
    const sDAIAllowance = await sDAI.allowance(wallet.address, ROUTER_ADDRESS);
    const downAllowance = await down.allowance(wallet.address, ROUTER_ADDRESS);

    console.log(`\n🔐 Allowances:`);
    console.log(`sDAI: ${utils.formatEther(sDAIAllowance)}`);
    console.log(`DOWN: ${utils.formatEther(downAllowance)}`);

    // Amounts to add (small test amounts)
    const sDAIAmount = utils.parseEther("0.005"); // 0.005 sDAI
    const downAmount = utils.parseEther("0.005"); // 0.005 DOWN

    console.log(`\n📊 Adding liquidity:`);
    console.log(`sDAI amount: ${utils.formatEther(sDAIAmount)}`);
    console.log(`DOWN amount: ${utils.formatEther(downAmount)}`);

    // Check if we have enough balance
    if (sDAIBalance.lt(sDAIAmount)) {
      console.log(`❌ Insufficient sDAI balance`);
      return;
    }
    if (downBalance.lt(downAmount)) {
      console.log(`❌ Insufficient DOWN balance`);
      return;
    }

    // Check if we need to approve
    if (sDAIAllowance.lt(sDAIAmount)) {
      console.log(`Approving sDAI...`);
      const approveTx = await sDAI.approve(ROUTER_ADDRESS, utils.parseEther("1000"));
      await approveTx.wait();
      console.log(`✅ sDAI approved`);
    }

    if (downAllowance.lt(downAmount)) {
      console.log(`Approving DOWN...`);
      const approveTx = await down.approve(ROUTER_ADDRESS, utils.parseEther("1000"));
      await approveTx.wait();
      console.log(`✅ DOWN approved`);
    }

    // Add liquidity using V2-style function
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
    const slippage = 5; // 5% slippage tolerance
    const minSDAI = sDAIAmount.mul(100 - slippage).div(100);
    const minDOWN = downAmount.mul(100 - slippage).div(100);

    console.log(`\n🎯 Transaction parameters:`);
    console.log(`tokenA: ${SDAI_ADDRESS}`);
    console.log(`tokenB: ${DOWN_TOKEN}`);
    console.log(`amountADesired: ${utils.formatEther(sDAIAmount)}`);
    console.log(`amountBDesired: ${utils.formatEther(downAmount)}`);
    console.log(`amountAMin: ${utils.formatEther(minSDAI)}`);
    console.log(`amountBMin: ${utils.formatEther(minDOWN)}`);
    console.log(`to: ${wallet.address}`);
    console.log(`deadline: ${deadline}`);

    try {
      // Estimate gas first
      const gasEstimate = await router.estimateGas.addLiquidity(
        SDAI_ADDRESS,
        DOWN_TOKEN,
        sDAIAmount,
        downAmount,
        minSDAI,
        minDOWN,
        wallet.address,
        deadline
      );

      console.log(`\n✅ Gas estimate: ${gasEstimate.toString()}`);

      // Execute the transaction
      console.log(`\n🚀 Executing addLiquidity...`);
      const tx = await router.addLiquidity(
        SDAI_ADDRESS,
        DOWN_TOKEN,
        sDAIAmount,
        downAmount,
        minSDAI,
        minDOWN,
        wallet.address,
        deadline
      );

      console.log(`Transaction hash: ${tx.hash}`);
      console.log(`Waiting for confirmation...`);

      const receipt = await tx.wait();
      console.log(`\n🎉 SUCCESS! Transaction confirmed in block ${receipt.blockNumber}`);
      console.log(`Gas used: ${receipt.gasUsed.toString()}`);

      // Check new balances
      const newSDAIBalance = await sDAI.balanceOf(wallet.address);
      const newDownBalance = await down.balanceOf(wallet.address);

      console.log(`\n💰 New balances:`);
      console.log(`sDAI: ${utils.formatEther(newSDAIBalance)} (was ${utils.formatEther(sDAIBalance)})`);
      console.log(`DOWN: ${utils.formatEther(newDownBalance)} (was ${utils.formatEther(downBalance)})`);

    } catch (error: any) {
      console.error(`❌ Transaction failed: ${error.message}`);
      
      if (error.message.includes("UNPREDICTABLE_GAS_LIMIT")) {
        console.log(`\n💡 This might be because:`);
        console.log(`1. Pool doesn't exist yet (need to create it first)`);
        console.log(`2. Insufficient liquidity for the amounts`);
        console.log(`3. Wrong token addresses or router`);
      }
    }

  } catch (error) {
    console.error("❌ Failed:", error);
  }
}

addLiquidityV2Style();