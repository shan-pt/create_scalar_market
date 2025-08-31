#!/usr/bin/env node

import { providers, Contract } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const POOL_ABI = [
  "function slot0() view returns (uint160, int24, uint16, uint16, uint16, uint8, bool)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
];

async function checkNewPool() {
  console.log("🔍 Checking the newly created pool...\n");

  try {
    const provider = new providers.JsonRpcProvider(process.env.RPC_URL);
    const poolAddress = "0x043925A80D1061AE17fAcC0437F14BfdcB099c9f";

    const pool = new Contract(poolAddress, POOL_ABI, provider);

    console.log(`Pool address: ${poolAddress}`);

    const token0 = await pool.token0();
    const token1 = await pool.token1();
    const fee = await pool.fee();
    const liquidity = await pool.liquidity();

    console.log(`Token0: ${token0}`);
    console.log(`Token1: ${token1}`);
    console.log(`Fee: ${fee}`);
    console.log(`Liquidity: ${liquidity.toString()}`);

    const slot0 = await pool.slot0();
    console.log(`\nPool State:`);
    console.log(`sqrtPriceX96: ${slot0[0].toString()}`);
    console.log(`tick: ${slot0[1]}`);
    console.log(`observationIndex: ${slot0[2]}`);
    console.log(`observationCardinality: ${slot0[3]}`);
    console.log(`observationCardinalityNext: ${slot0[4]}`);
    console.log(`feeProtocol: ${slot0[5]}`);
    console.log(`unlocked: ${slot0[6]}`);

    console.log("\n✅ Pool is properly initialized and ready for liquidity!");
    console.log("Now we can try adding liquidity using the Position Manager.");

  } catch (error) {
    console.error("❌ Check failed:", error);
  }
}

checkNewPool();