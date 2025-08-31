#!/usr/bin/env node

import { TickMath, nearestUsableTick } from "@uniswap/v3-sdk";

function checkTicks() {
  console.log("🎯 Checking tick calculations...\n");

  try {
    const currentTick = 23539;
    const tickLower = 540;
    const tickUpper = 29940;
    const tickSpacing = 60; // For 0.3% fee tier

    console.log(`Current pool tick: ${currentTick}`);
    console.log(`Your tick range: ${tickLower} to ${tickUpper}`);
    console.log(`Tick spacing: ${tickSpacing}`);

    // Check if ticks are valid
    console.log(`\n✅ Tick Validation:`);
    console.log(`tickLower % tickSpacing = ${tickLower % tickSpacing} (should be 0)`);
    console.log(`tickUpper % tickSpacing = ${tickUpper % tickSpacing} (should be 0)`);
    console.log(`tickLower < tickUpper: ${tickLower < tickUpper}`);
    console.log(`Current tick in range: ${currentTick >= tickLower && currentTick <= tickUpper}`);

    // Calculate prices from ticks
    const priceLower = Math.pow(1.0001, tickLower);
    const priceUpper = Math.pow(1.0001, tickUpper);
    const currentPrice = Math.pow(1.0001, currentTick);

    console.log(`\n💰 Price Analysis:`);
    console.log(`Price at tickLower (${tickLower}): ${priceLower.toFixed(6)}`);
    console.log(`Current price (tick ${currentTick}): ${currentPrice.toFixed(6)}`);
    console.log(`Price at tickUpper (${tickUpper}): ${priceUpper.toFixed(6)}`);

    // Check what this means for liquidity distribution
    const distanceFromLower = currentTick - tickLower;
    const distanceFromUpper = tickUpper - currentTick;
    const totalRange = tickUpper - tickLower;

    console.log(`\n📊 Position Analysis:`);
    console.log(`Distance from lower tick: ${distanceFromLower} ticks`);
    console.log(`Distance from upper tick: ${distanceFromUpper} ticks`);
    console.log(`Total range: ${totalRange} ticks`);
    console.log(`Position in range: ${((currentTick - tickLower) / totalRange * 100).toFixed(1)}%`);

    if (distanceFromUpper < totalRange * 0.1) {
      console.log(`\n⚠️  WARNING: Current price is very close to upper bound!`);
      console.log(`This means almost all liquidity will be in DOWN tokens, not sDAI.`);
      console.log(`This might cause the transaction to revert.`);
    }

    // Suggest better tick range
    const suggestedLower = nearestUsableTick(currentTick - 2000, tickSpacing);
    const suggestedUpper = nearestUsableTick(currentTick + 2000, tickSpacing);

    console.log(`\n💡 Suggested tick range for balanced liquidity:`);
    console.log(`tickLower: ${suggestedLower} (price: ${Math.pow(1.0001, suggestedLower).toFixed(6)})`);
    console.log(`tickUpper: ${suggestedUpper} (price: ${Math.pow(1.0001, suggestedUpper).toFixed(6)})`);
    console.log(`This would center the position around the current price.`);

  } catch (error) {
    console.error("❌ Check failed:", error);
  }
}

checkTicks();