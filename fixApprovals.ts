#!/usr/bin/env node

import { providers, Wallet, Contract, utils } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function symbol() view returns (string)",
];

async function fixApprovals() {
  console.log("🔧 Fixing token approvals...\n");

  try {
    const provider = new providers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);

    const POSITION_MANAGER_ADDRESS = "0xCd03e2e276F6EEdD424d41314437531F665187b9";
    const SDAI_ADDRESS = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";
    const DOWN_TOKEN = "0xe987315d1680577da7d027bd4937976ec7efd2da";

    const sDAIContract = new Contract(SDAI_ADDRESS, ERC20_ABI, wallet);
    const downContract = new Contract(DOWN_TOKEN, ERC20_ABI, wallet);

    // Check current allowances
    const sDAIAllowance = await sDAIContract.allowance(wallet.address, POSITION_MANAGER_ADDRESS);
    const downAllowance = await downContract.allowance(wallet.address, POSITION_MANAGER_ADDRESS);

    console.log(`Current allowances:`);
    console.log(`sDAI: ${utils.formatEther(sDAIAllowance)}`);
    console.log(`DOWN: ${utils.formatEther(downAllowance)}`);

    // Approve maximum amounts
    const maxAmount = utils.parseEther("1000000"); // Large amount

    console.log(`\nApproving maximum amounts...`);

    if (sDAIAllowance.lt(utils.parseEther("1"))) {
      console.log(`Approving sDAI...`);
      const sDAIApproveTx = await sDAIContract.approve(POSITION_MANAGER_ADDRESS, maxAmount);
      await sDAIApproveTx.wait();
      console.log(`✅ sDAI approved`);
    } else {
      console.log(`✅ sDAI already has sufficient allowance`);
    }

    if (downAllowance.lt(utils.parseEther("1"))) {
      console.log(`Approving DOWN token...`);
      const downApproveTx = await downContract.approve(POSITION_MANAGER_ADDRESS, maxAmount);
      await downApproveTx.wait();
      console.log(`✅ DOWN token approved`);
    } else {
      console.log(`✅ DOWN token already has sufficient allowance`);
    }

    // Verify new allowances
    const newSDAIAllowance = await sDAIContract.allowance(wallet.address, POSITION_MANAGER_ADDRESS);
    const newDownAllowance = await downContract.allowance(wallet.address, POSITION_MANAGER_ADDRESS);

    console.log(`\n✅ New allowances:`);
    console.log(`sDAI: ${utils.formatEther(newSDAIAllowance)}`);
    console.log(`DOWN: ${utils.formatEther(newDownAllowance)}`);

    console.log(`\n🎉 Approvals fixed! You can now try adding liquidity again.`);

  } catch (error) {
    console.error("❌ Fix failed:", error);
  }
}

fixApprovals();