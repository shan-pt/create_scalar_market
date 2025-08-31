#!/usr/bin/env node

import { providers, Wallet, Contract, utils } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

async function estimateCosts() {
  console.log("💰 Estimating transaction costs...\n");

  try {
    const provider = new providers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);

    // Get current gas price
    const gasPrice = await provider.getGasPrice();
    const gasPriceGwei = utils.formatUnits(gasPrice, "gwei");
    
    console.log(`Current gas price: ${gasPriceGwei} Gwei`);

    // Estimate gas for different operations
    const estimates = {
      "Token Approval": 50000,
      "Pool Creation": 200000,
      "Pool Initialization": 100000,
      "Add Liquidity (mint)": 150000,
      "Split Position": 80000,
    };

    let totalGas = 0;
    console.log("\n📊 Gas Estimates:");
    
    for (const [operation, gasEstimate] of Object.entries(estimates)) {
      const costWei = gasPrice.mul(gasEstimate);
      const costEth = utils.formatEther(costWei);
      console.log(`${operation}: ${gasEstimate.toLocaleString()} gas = ${costEth} xDAI`);
      totalGas += gasEstimate;
    }

    const totalCostWei = gasPrice.mul(totalGas);
    const totalCostEth = utils.formatEther(totalCostWei);
    
    console.log(`\n💸 TOTAL ESTIMATED COST: ${totalCostEth} xDAI (${totalGas.toLocaleString()} gas)`);

    // Check wallet balance
    const balance = await provider.getBalance(wallet.address);
    const balanceEth = utils.formatEther(balance);
    
    console.log(`\n💳 Your xDAI balance: ${balanceEth} xDAI`);
    console.log(`Sufficient for transaction: ${balance.gt(totalCostWei) ? '✅ YES' : '❌ NO'}`);

    // Check sDAI balance
    const SDAI_ABI = ["function balanceOf(address) view returns (uint256)"];
    const sDAI = new Contract("0xaf204776c7245bF4147c2612BF6e5972Ee483701", SDAI_ABI, provider);
    const sDAIBalance = await sDAI.balanceOf(wallet.address);
    const sDAIBalanceFormatted = utils.formatEther(sDAIBalance);
    
    console.log(`💰 Your sDAI balance: ${sDAIBalanceFormatted} sDAI`);

    console.log(`\n⚠️  RECOMMENDATIONS:`);
    console.log(`1. 🧪 Test with 0.01 sDAI first (costs ~${totalCostEth} xDAI in gas)`);
    console.log(`2. 🔍 Verify everything works before using larger amounts`);
    console.log(`3. 💡 Pool already exists, so no creation cost needed`);
    console.log(`4. 🎯 Actual cost will be lower since pool exists`);

    // Suggest safe test command
    console.log(`\n🧪 SAFE TEST COMMAND:`);
    console.log(`npm run add-liquidity 0x190127125dda0fcbbafd479b816e5404273e4af7 0.01 0.05 0.95`);
    console.log(`(This uses only 0.01 sDAI = ~$0.01 USD)`);

  } catch (error) {
    console.error("❌ Cost estimation failed:", error);
  }
}

estimateCosts();