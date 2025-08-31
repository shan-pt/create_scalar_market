#!/usr/bin/env node

import { providers, Wallet, Contract, utils, BigNumber } from "ethers";
import { Token, CurrencyAmount, Percent } from "@uniswap/sdk-core";
import { Pool, Position, nearestUsableTick, TickMath, encodeSqrtRatioX96 } from "@uniswap/v3-sdk";
import * as dotenv from "dotenv";

dotenv.config();

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const POOL_ABI = [
  "function slot0() view returns (uint160, int24, uint16, uint16, uint16, uint8, bool)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
];

const FACTORY_ABI = [
  "function getPool(address, address, uint24) view returns (address)",
];

const POSITION_MANAGER_ABI = [
  "function factory() view returns (address)",
  "function createAndInitializePoolIfNecessary(address, address, uint24, uint160) payable returns (address)",
  "function mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256)) payable returns (uint256,uint128,uint256,uint256)",
];

async function debugUniswap() {
  console.log("🔍 Debugging Uniswap V3 Transaction...\n");

  try {
    const provider = new providers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);

    // Addresses
    const FACTORY_ADDRESS = "0xf78031CBCA409F2FB6876BDFDBc1b2df24cF9bEf";
    const POSITION_MANAGER_ADDRESS = "0xCd03e2e276F6EEdD424d41314437531F665187b9";
    const SDAI_ADDRESS = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";
    const DOWN_TOKEN = "0xe987315d1680577da7d027bd4937976ec7efd2da";
    const UP_TOKEN = "0xfcb3b2e933c976d6da30708f5099696befabbeff";

    console.log(`Wallet: ${wallet.address}`);
    console.log(`Factory: ${FACTORY_ADDRESS}`);
    console.log(`Position Manager: ${POSITION_MANAGER_ADDRESS}`);

    // Check balances
    const sDAIContract = new Contract(SDAI_ADDRESS, ERC20_ABI, provider);
    const downContract = new Contract(DOWN_TOKEN, ERC20_ABI, provider);
    const upContract = new Contract(UP_TOKEN, ERC20_ABI, provider);

    const sDAIBalance = await sDAIContract.balanceOf(wallet.address);
    const downBalance = await downContract.balanceOf(wallet.address);
    const upBalance = await upContract.balanceOf(wallet.address);

    console.log(`\n💰 Balances:`);
    console.log(`sDAI: ${utils.formatEther(sDAIBalance)}`);
    console.log(`DOWN: ${utils.formatEther(downBalance)}`);
    console.log(`UP: ${utils.formatEther(upBalance)}`);

    // Check allowances
    const sDAIAllowance = await sDAIContract.allowance(wallet.address, POSITION_MANAGER_ADDRESS);
    const downAllowance = await downContract.allowance(wallet.address, POSITION_MANAGER_ADDRESS);

    console.log(`\n🔐 Allowances to Position Manager:`);
    console.log(`sDAI: ${utils.formatEther(sDAIAllowance)}`);
    console.log(`DOWN: ${utils.formatEther(downAllowance)}`);

    // Check if pool exists
    const factory = new Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
    const poolAddress = await factory.getPool(SDAI_ADDRESS, DOWN_TOKEN, 3000); // 0.3% fee

    console.log(`\n🏊 Pool Status:`);
    console.log(`Pool address: ${poolAddress}`);
    console.log(`Pool exists: ${poolAddress !== "0x0000000000000000000000000000000000000000"}`);

    if (poolAddress !== "0x0000000000000000000000000000000000000000") {
      const pool = new Contract(poolAddress, POOL_ABI, provider);
      const slot0 = await pool.slot0();
      const liquidity = await pool.liquidity();
      
      console.log(`Current price (sqrtPriceX96): ${slot0.sqrtPriceX96.toString()}`);
      console.log(`Current tick: ${slot0.tick}`);
      console.log(`Current liquidity: ${liquidity.toString()}`);
    }

    // Test Position Manager functions
    const positionManager = new Contract(POSITION_MANAGER_ADDRESS, POSITION_MANAGER_ABI, provider);
    
    console.log(`\n🧪 Testing Position Manager:`);
    
    // Test 1: Check if we can call factory()
    try {
      const pmFactory = await positionManager.factory();
      console.log(`✅ Factory call works: ${pmFactory}`);
    } catch (e) {
      console.log(`❌ Factory call failed: ${e}`);
    }

    // Test 2: Try to create pool (dry run)
    const midpoint = (1.0526315789473684 + 20) / 2;
    // Use simple numbers for encodeSqrtRatioX96 and convert JSBI to BigNumber
    const sqrtPriceX96JSBI = encodeSqrtRatioX96(
      Math.floor(midpoint * 1e6), // Use smaller precision to avoid overflow
      1e6
    );
    const sqrtPriceX96 = BigNumber.from(sqrtPriceX96JSBI.toString());

    console.log(`\n🎯 Pool Creation Parameters:`);
    console.log(`Token0: ${SDAI_ADDRESS}`);
    console.log(`Token1: ${DOWN_TOKEN}`);
    console.log(`Fee: 3000`);
    console.log(`Initial Price (sqrtPriceX96): ${sqrtPriceX96.toString()}`);

    try {
      // Try to estimate gas for pool creation
      const createPoolTx = await positionManager.populateTransaction.createAndInitializePoolIfNecessary(
        SDAI_ADDRESS,
        DOWN_TOKEN,
        3000,
        sqrtPriceX96
      );
      
      console.log(`✅ Pool creation transaction populated`);
      console.log(`Data length: ${createPoolTx.data?.length}`);
      
      // Try gas estimation
      const gasEstimate = await provider.estimateGas({
        ...createPoolTx,
        from: wallet.address
      });
      
      console.log(`✅ Gas estimate for pool creation: ${gasEstimate.toString()}`);
      
    } catch (e: any) {
      console.log(`❌ Pool creation failed: ${e.message}`);
      console.log(`Error code: ${e.code}`);
      console.log(`Error reason: ${e.reason}`);
    }

    // Test 3: Check token order
    const token0Lower = SDAI_ADDRESS.toLowerCase() < DOWN_TOKEN.toLowerCase();
    console.log(`\n📊 Token Order:`);
    console.log(`sDAI < DOWN: ${token0Lower}`);
    console.log(`Token0: ${token0Lower ? SDAI_ADDRESS : DOWN_TOKEN}`);
    console.log(`Token1: ${token0Lower ? DOWN_TOKEN : SDAI_ADDRESS}`);

    // Test 4: Check if we have enough balance for the operation
    const requiredAmount = utils.parseEther("0.5"); // Half of 1 sDAI
    console.log(`\n💸 Required vs Available:`);
    console.log(`Required sDAI: ${utils.formatEther(requiredAmount)}`);
    console.log(`Available sDAI: ${utils.formatEther(sDAIBalance)}`);
    console.log(`Sufficient sDAI: ${sDAIBalance.gte(requiredAmount)}`);
    console.log(`Required DOWN: ${utils.formatEther(requiredAmount)}`);
    console.log(`Available DOWN: ${utils.formatEther(downBalance)}`);
    console.log(`Sufficient DOWN: ${downBalance.gte(requiredAmount)}`);

  } catch (error) {
    console.error("❌ Debug failed:", error);
  }
}

debugUniswap();