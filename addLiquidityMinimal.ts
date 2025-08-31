#!/usr/bin/env node

import { providers, Wallet, Contract, BigNumber } from "ethers";
import { parseEther, getAddress, formatEther } from "ethers/lib/utils";
import * as dotenv from "dotenv";
dotenv.config();

// Constants
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

async function testMinimalSplit() {
  const provider = new providers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);
  
  const marketAddress = "0x21a70e522adb02dfb51ac9970c97f710f1e17034";
  
  console.log("🧪 Testing minimal split amounts...");
  
  const sDAIToken = new Contract(SDAI_ADDRESS, ERC20_ABI, wallet);
  const balance = await sDAIToken.balanceOf(wallet.address);
  console.log(`💰 sDAI balance: ${formatEther(balance)}`);

  const router = new Contract(SEER_GNOSIS_ROUTER, SEER_GNOSIS_ROUTER_ABI, wallet);

  // Test different amounts to find the minimum that works
  const testAmounts = [
    parseEther("0.1"),    // 0.1 sDAI
    parseEther("0.05"),   // 0.05 sDAI  
    parseEther("0.02"),   // 0.02 sDAI
    parseEther("0.01"),   // 0.01 sDAI
  ];

  for (const amount of testAmounts) {
    const amountFormatted = formatEther(amount);
    console.log(`\n🔄 Testing ${amountFormatted} sDAI...`);
    
    try {
      // Check allowance
      const allowance = await sDAIToken.allowance(wallet.address, SEER_GNOSIS_ROUTER);
      if (allowance.lt(amount)) {
        console.log("📝 Approving...");
        const approveTx = await sDAIToken.approve(SEER_GNOSIS_ROUTER, amount);
        await approveTx.wait();
      }

      // Try split
      console.log("🔄 Attempting split...");
      const splitTx = await router.splitPosition(SDAI_ADDRESS, marketAddress, amount, {
        gasLimit: 800_000
      });
      await splitTx.wait();
      
      console.log(`✅ SUCCESS with ${amountFormatted} sDAI!`);
      console.log(`Transaction: ${splitTx.hash}`);
      break;
      
    } catch (error: any) {
      console.log(`❌ FAILED with ${amountFormatted} sDAI`);
      console.log(`Error: ${error.message?.split('\n')[0] || error}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args[0] === '--test') {
    await testMinimalSplit();
    return;
  }

  console.log(`
🚀 Minimal Liquidity Addition Tool

This tool helps you find the minimum amount that works for adding liquidity.

Usage:
  npx ts-node addLiquidityMinimal.ts --test    # Test different amounts to find minimum
  npx ts-node addLiquidityMinimal.ts --help    # Show this help

Recommendations for very small liquidity:
1. Start with at least 0.1 sDAI (gas costs are significant for smaller amounts)
2. Use wider price ranges (e.g., 0.01-0.99) for better liquidity efficiency
3. Consider that Uniswap V3 has minimum liquidity requirements

If you want to add very small amounts (< 0.01 sDAI):
- The gas costs will likely exceed the value of the liquidity
- Consider using a different DEX or waiting for lower gas prices
- Pool creation requires minimum amounts that may be higher than your target
  `);
}

if (require.main === module) {
  main().catch(console.error);
}