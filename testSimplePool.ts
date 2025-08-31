#!/usr/bin/env node

import { providers, Wallet, Contract, utils, BigNumber } from "ethers";
import { Token } from "@uniswap/sdk-core";
import { encodeSqrtRatioX96 } from "@uniswap/v3-sdk";
import * as dotenv from "dotenv";

dotenv.config();

const FACTORY_ABI = [
  "function createPool(address, address, uint24) returns (address)",
  "function getPool(address, address, uint24) view returns (address)",
];

const POOL_ABI = [
  "function initialize(uint160) external",
  "function slot0() view returns (uint160, int24, uint16, uint16, uint16, uint8, bool)",
];

async function testSimplePool() {
  console.log("🧪 Testing simple pool creation...\n");

  try {
    const provider = new providers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);

    const FACTORY_ADDRESS = "0xf78031CBCA409F2FB6876BDFDBc1b2df24cF9bEf";
    const SDAI_ADDRESS = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";
    const DOWN_TOKEN = "0xe987315d1680577da7d027bd4937976ec7efd2da";

    console.log(`Wallet: ${wallet.address}`);
    console.log(`Factory: ${FACTORY_ADDRESS}`);

    const factory = new Contract(FACTORY_ADDRESS, FACTORY_ABI, wallet);

    // Check if pool exists
    let poolAddress = await factory.getPool(SDAI_ADDRESS, DOWN_TOKEN, 3000);
    console.log(`Current pool address: ${poolAddress}`);

    if (poolAddress === "0x0000000000000000000000000000000000000000") {
      console.log("Pool doesn't exist, creating it...");

      // Try to create pool directly through factory
      try {
        const createPoolTx = await factory.createPool(SDAI_ADDRESS, DOWN_TOKEN, 3000);
        const receipt = await createPoolTx.wait();
        console.log(`✅ Pool creation transaction: ${receipt.transactionHash}`);

        // Get the new pool address
        poolAddress = await factory.getPool(SDAI_ADDRESS, DOWN_TOKEN, 3000);
        console.log(`✅ New pool created at: ${poolAddress}`);

        // Initialize the pool with a price
        const pool = new Contract(poolAddress, POOL_ABI, wallet);
        
        // Calculate initial price (midpoint between 1.05 and 20)
        const midpoint = (1.0526315789473684 + 20) / 2;
        const sqrtPriceX96JSBI = encodeSqrtRatioX96(
          Math.floor(midpoint * 1e6),
          1e6
        );
        const sqrtPriceX96 = BigNumber.from(sqrtPriceX96JSBI.toString());

        console.log(`Initializing pool with price: ${midpoint}`);
        console.log(`sqrtPriceX96: ${sqrtPriceX96.toString()}`);

        const initTx = await pool.initialize(sqrtPriceX96);
        const initReceipt = await initTx.wait();
        console.log(`✅ Pool initialized: ${initReceipt.transactionHash}`);

        // Check pool state
        const slot0 = await pool.slot0();
        console.log(`Pool state - sqrtPriceX96: ${slot0.sqrtPriceX96.toString()}, tick: ${slot0.tick}`);

      } catch (error: any) {
        console.error(`❌ Pool creation failed: ${error.message}`);
        
        if (error.message.includes("PoolAlreadyExists")) {
          console.log("Pool already exists, getting address...");
          poolAddress = await factory.getPool(SDAI_ADDRESS, DOWN_TOKEN, 3000);
          console.log(`Pool address: ${poolAddress}`);
        } else {
          throw error;
        }
      }
    } else {
      console.log(`✅ Pool already exists at: ${poolAddress}`);
      
      // Check pool state
      const pool = new Contract(poolAddress, POOL_ABI, provider);
      try {
        const slot0 = await pool.slot0();
        console.log(`Pool state - sqrtPriceX96: ${slot0.sqrtPriceX96.toString()}, tick: ${slot0.tick}`);
      } catch (e) {
        console.log("Pool might not be initialized yet");
      }
    }

    console.log("\n🎉 Pool creation test completed!");
    console.log(`Pool address: ${poolAddress}`);
    console.log("\nNext: Try adding liquidity to this pool using standard Uniswap V3 methods");

  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

testSimplePool();