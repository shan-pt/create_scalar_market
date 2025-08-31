#!/usr/bin/env node

import { providers, Wallet, Contract, utils, BigNumber } from "ethers";
import { Token, CurrencyAmount } from "@uniswap/sdk-core";
import { Pool, Position, nearestUsableTick, TickMath } from "@uniswap/v3-sdk";
import * as dotenv from "dotenv";

dotenv.config();

const POSITION_MANAGER_ABI = [
  "function mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256)) payable returns (uint256,uint128,uint256,uint256)",
];

const POOL_ABI = [
  "function slot0() view returns (uint160, int24, uint16, uint16, uint16, uint8, bool)",
  "function liquidity() view returns (uint128)",
];

async function testBetterRange() {
  console.log("🧪 Testing with better tick range...\n");

  try {
    const provider = new providers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);

    const POSITION_MANAGER_ADDRESS = "0xCd03e2e276F6EEdD424d41314437531F665187b9";
    const POOL_ADDRESS = "0x043925A80D1061AE17fAcC0437F14BfdcB099c9f";
    const SDAI_ADDRESS = "0xaf204776c7245bF4147c2612bf6e5972Ee483701";
    const DOWN_TOKEN = "0xe987315d1680577da7d027bd4937976ec7efd2da";

    // Get current pool state
    const pool = new Contract(POOL_ADDRESS, POOL_ABI, provider);
    const slot0 = await pool.slot0();
    const currentTick = slot0.tick;
    const liquidity = await pool.liquidity();

    console.log(`Current tick: ${currentTick}`);
    console.log(`Current liquidity: ${liquidity.toString()}`);

    // Create better tick range centered around current price
    const tickSpacing = 60;
    const tickRange = 4000; // Smaller, more balanced range
    const tickLower = nearestUsableTick(currentTick - tickRange, tickSpacing);
    const tickUpper = nearestUsableTick(currentTick + tickRange, tickSpacing);

    console.log(`\n🎯 Better tick range:`);
    console.log(`tickLower: ${tickLower} (price: ${Math.pow(1.0001, tickLower).toFixed(6)})`);
    console.log(`tickUpper: ${tickUpper} (price: ${Math.pow(1.0001, tickUpper).toFixed(6)})`);
    console.log(`Current position: ${((currentTick - tickLower) / (tickUpper - tickLower) * 100).toFixed(1)}% through range`);

    // Create tokens
    const sDAI = new Token(100, SDAI_ADDRESS, 18, "sDAI", "Savings DAI");
    const down = new Token(100, DOWN_TOKEN, 18, "DOWN", "DOWN");

    // Create pool instance
    const poolInstance = new Pool(
      sDAI,
      down,
      3000,
      slot0.sqrtPriceX96.toString(),
      liquidity.toString(),
      currentTick
    );

    // Calculate position with small amounts
    const amount0 = utils.parseEther("0.005"); // 0.005 sDAI
    const amount1 = utils.parseEther("0.005"); // 0.005 DOWN

    const position = Position.fromAmounts({
      pool: poolInstance,
      tickLower,
      tickUpper,
      amount0: amount0.toString(),
      amount1: amount1.toString(),
      useFullPrecision: false,
    });

    console.log(`\n💰 Position details:`);
    console.log(`Amount0 (sDAI): ${utils.formatEther(position.amount0.quotient.toString())}`);
    console.log(`Amount1 (DOWN): ${utils.formatEther(position.amount1.quotient.toString())}`);

    // Create mint parameters
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
    const mintParams = {
      token0: sDAI.address,
      token1: down.address,
      fee: 3000,
      tickLower,
      tickUpper,
      amount0Desired: BigNumber.from(position.amount0.quotient.toString()),
      amount1Desired: BigNumber.from(position.amount1.quotient.toString()),
      amount0Min: 0,
      amount1Min: 0,
      recipient: wallet.address,
      deadline,
    };

    console.log(`\n📋 Mint parameters:`);
    console.log(`tickLower: ${mintParams.tickLower}`);
    console.log(`tickUpper: ${mintParams.tickUpper}`);
    console.log(`amount0Desired: ${utils.formatEther(mintParams.amount0Desired)} sDAI`);
    console.log(`amount1Desired: ${utils.formatEther(mintParams.amount1Desired)} DOWN`);

    // Try to estimate gas
    const positionManager = new Contract(POSITION_MANAGER_ADDRESS, POSITION_MANAGER_ABI, provider);
    
    try {
      const gasEstimate = await positionManager.estimateGas.mint([
        mintParams.token0,
        mintParams.token1,
        mintParams.fee,
        mintParams.tickLower,
        mintParams.tickUpper,
        mintParams.amount0Desired,
        mintParams.amount1Desired,
        mintParams.amount0Min,
        mintParams.amount1Min,
        mintParams.recipient,
        mintParams.deadline,
      ]);

      console.log(`\n✅ Gas estimate successful: ${gasEstimate.toString()}`);
      console.log(`This range should work! You can try it with:`);
      console.log(`- Better balanced liquidity`);
      console.log(`- Centered around current price`);
      console.log(`- Should not revert`);

    } catch (error: any) {
      console.log(`\n❌ Still failing with better range: ${error.message}`);
      console.log(`The issue might be with the Position Manager contract itself.`);
    }

  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

testBetterRange();