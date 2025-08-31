#!/usr/bin/env node

import { utils, Contract } from "ethers";

const POSITION_MANAGER_ABI = [
  "function mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256)) payable returns (uint256,uint128,uint256,uint256)",
];

function decodeTransaction() {
  console.log("🔍 Decoding the failed transaction...\n");

  const txData = "0x88316456000000000000000000000000af204776c7245bf4147c2612bf6e5972ee483701000000000000000000000000e987315d1680577da7d027bd4937976ec7efd2da0000000000000000000000000000000000000000000000000000000000000bb8000000000000000000000000000000000000000000000000000000000000021c00000000000000000000000000000000000000000000000000000000000074f40000000000000000000000000000000000000000000000000008e1bc9bf040000000000000000000000000000000000000000000000000000011c37937e0800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e961c6fc6425e148d8474bd2cecf52a2199b13080000000000000000000000000000000000000000000000000000000068b24e70";

  try {
    const iface = new utils.Interface(POSITION_MANAGER_ABI);
    const decoded = iface.parseTransaction({ data: txData });

    console.log(`Function: ${decoded.name}`);
    console.log(`\nParameters:`);
    
    const params = decoded.args[0]; // mint takes a struct as first parameter
    
    console.log(`token0: ${params[0]}`);
    console.log(`token1: ${params[1]}`);
    console.log(`fee: ${params[2]}`);
    console.log(`tickLower: ${params[3]}`);
    console.log(`tickUpper: ${params[4]}`);
    console.log(`amount0Desired: ${utils.formatEther(params[5])} (${params[5].toString()})`);
    console.log(`amount1Desired: ${utils.formatEther(params[6])} (${params[6].toString()})`);
    console.log(`amount0Min: ${params[7]}`);
    console.log(`amount1Min: ${params[8]}`);
    console.log(`recipient: ${params[9]}`);
    console.log(`deadline: ${params[10]} (${new Date(params[10] * 1000).toISOString()})`);

    console.log(`\n🔍 Analysis:`);
    console.log(`- Function: mint (add liquidity)`);
    console.log(`- Token0 (sDAI): ${params[0]}`);
    console.log(`- Token1 (DOWN): ${params[1]}`);
    console.log(`- Fee tier: ${params[2]} (0.3%)`);
    console.log(`- Tick range: ${params[3]} to ${params[4]}`);
    console.log(`- Amount0 desired: ${utils.formatEther(params[5])} sDAI`);
    console.log(`- Amount1 desired: ${utils.formatEther(params[6])} DOWN`);
    console.log(`- Minimum amounts: 0 (no slippage protection)`);
    console.log(`- Recipient: ${params[9]}`);
    console.log(`- Deadline: ${new Date(params[10] * 1000).toLocaleString()}`);

    console.log(`\n💡 Possible Issues:`);
    console.log(`1. Tick range might be invalid for current price`);
    console.log(`2. Token amounts might be incorrect`);
    console.log(`3. Position Manager might not be compatible`);
    console.log(`4. Insufficient token approvals or balances`);

  } catch (error) {
    console.error("❌ Decode failed:", error);
  }
}

decodeTransaction();