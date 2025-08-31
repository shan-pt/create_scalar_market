#!/usr/bin/env node

import { providers, Wallet, Contract, utils, BigNumber } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

// V3 Pool ABI with mint function
const POOL_ABI = [
  "function mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes calldata data) external returns (uint256 amount0, uint256 amount1)",
  "function slot0() view returns (uint160, int24, uint16, uint16, uint16, uint8, bool)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function transfer(address, uint256) returns (bool)",
];

async function addLiquidityDirect() {
  console.log("🎯 Adding liquidity directly to V3 pool...\n");

  try {
    const provider = new providers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);

    const POOL_ADDRESS = "0x043925A80D1061AE17fAcC0437F14BfdcB099c9f";
    const SDAI_ADDRESS = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";
    const DOWN_TOKEN = "0xE987315d1680577da7D027Bd4937976ec7eFd2Da";

    console.log(`Wallet: ${wallet.address}`);
    console.log(`Pool: ${POOL_ADDRESS}`);

    // Create contracts
    const pool = new Contract(POOL_ADDRESS, POOL_ABI, provider);
    const sDAI = new Contract(SDAI_ADDRESS, ERC20_ABI, wallet);
    const down = new Contract(DOWN_TOKEN, ERC20_ABI, wallet);

    // Get pool info
    const slot0 = await pool.slot0();
    const currentTick = slot0[1];
    const token0 = await pool.token0();
    const token1 = await pool.token1();

    console.log(`\n🏊 Pool Info:`);
    console.log(`Token0: ${token0}`);
    console.log(`Token1: ${token1}`);
    console.log(`Current tick: ${currentTick}`);
    console.log(`Current price: ${Math.pow(1.0001, currentTick).toFixed(6)}`);

    // Check balances
    const sDAIBalance = await sDAI.balanceOf(wallet.address);
    const downBalance = await down.balanceOf(wallet.address);

    console.log(`\n💰 Balances:`);
    console.log(`sDAI: ${utils.formatEther(sDAIBalance)}`);
    console.log(`DOWN: ${utils.formatEther(downBalance)}`);

    // Simple tick range around current price
    const tickSpacing = 60; // For 0.3% fee
    const tickRange = 1200; // Smaller range
    const tickLower = Math.floor((currentTick - tickRange) / tickSpacing) * tickSpacing;
    const tickUpper = Math.floor((currentTick + tickRange) / tickSpacing) * tickSpacing;

    console.log(`\n🎯 Liquidity Range:`);
    console.log(`tickLower: ${tickLower} (price: ${Math.pow(1.0001, tickLower).toFixed(6)})`);
    console.log(`tickUpper: ${tickUpper} (price: ${Math.pow(1.0001, tickUpper).toFixed(6)})`);

    // Small liquidity amount
    const liquidityAmount = BigNumber.from("1000000000000000"); // Very small amount

    console.log(`\n📊 Adding liquidity:`);
    console.log(`Liquidity amount: ${liquidityAmount.toString()}`);

    // Approve tokens to pool
    const sDAIAllowance = await sDAI.allowance(wallet.address, POOL_ADDRESS);
    const downAllowance = await down.allowance(wallet.address, POOL_ADDRESS);

    if (sDAIAllowance.lt(utils.parseEther("0.01"))) {
      console.log(`Approving sDAI to pool...`);
      const tx = await sDAI.approve(POOL_ADDRESS, utils.parseEther("1"));
      await tx.wait();
      console.log(`✅ sDAI approved`);
    }

    if (downAllowance.lt(utils.parseEther("0.01"))) {
      console.log(`Approving DOWN to pool...`);
      const tx = await down.approve(POOL_ADDRESS, utils.parseEther("1"));
      await tx.wait();
      console.log(`✅ DOWN approved`);
    }

    // Try to mint liquidity directly
    try {
      console.log(`\n🚀 Attempting direct pool mint...`);
      
      // Create a simple callback data (empty for now)
      const callbackData = "0x";

      const poolWithSigner = pool.connect(wallet);
      const gasEstimate = await poolWithSigner.estimateGas.mint(
        wallet.address,
        tickLower,
        tickUpper,
        liquidityAmount,
        callbackData
      );

      console.log(`✅ Gas estimate: ${gasEstimate.toString()}`);

      const tx = await poolWithSigner.mint(
        wallet.address,
        tickLower,
        tickUpper,
        liquidityAmount,
        callbackData
      );

      console.log(`Transaction hash: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`\n🎉 SUCCESS! Liquidity added directly to pool!`);
      console.log(`Block: ${receipt.blockNumber}`);
      console.log(`Gas used: ${receipt.gasUsed.toString()}`);

    } catch (error: any) {
      console.error(`❌ Direct mint failed: ${error.message}`);
      
      if (error.message.includes("callback")) {
        console.log(`\n💡 The pool requires a callback implementation.`);
        console.log(`This means we need to use a proper router or position manager.`);
      }
    }

  } catch (error) {
    console.error("❌ Failed:", error);
  }
}

addLiquidityDirect();