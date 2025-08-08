#!/usr/bin/env node

import * as fs from "fs";
import { addLiquidity } from "./addLiquidity";

interface LiquidityRange {
  lowerBound: number;
  upperBound: number;
}

async function main() {
  const args = process.argv.slice(2);

  // If --all is passed, loop through all market addresses in createdMarkets.json
  if (args[0] === "--all") {
    const amount = args[1] ? parseFloat(args[1]) : 0.005; // default amount
    const lowerBound = args[2] ? parseFloat(args[2]) : 0.05;
    const upperBound = args[3] ? parseFloat(args[3]) : 0.95;
    const range: LiquidityRange = { lowerBound, upperBound };

    const markets = JSON.parse(fs.readFileSync("createdMarkets.json", "utf-8"));
    for (const entry of markets) {
      const marketAddress = entry.marketAddress;
      console.log(`\n🚀 Adding liquidity to market: ${marketAddress}`);
      try {
        await addLiquidity(marketAddress, amount, range);
        console.log("✅ Successfully added liquidity!");
      } catch (error) {
        console.error(`❌ Failed for ${marketAddress}:`, error);
      }
    }
    process.exit(0);
  }

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage: npm run add-liquidity <marketAddress> <amount> [lowerBound] [upperBound]

Arguments:
  marketAddress   The address of the Seer prediction market
  amount         The amount of sDAI to use for liquidity (in human-readable format, e.g., "100" for 100 sDAI)
  lowerBound     Lower bound of price range (0-1, default: 0.05)
  upperBound     Upper bound of price range (0-1, default: 0.95)

Examples:
  npm run add-liquidity 0x1234...5678 100                    # Add 100 sDAI liquidity with default range 0.05-0.95
  npm run add-liquidity 0x1234...5678 50 0.1 0.9            # Add 50 sDAI liquidity with range 0.1-0.9
  npm run add-liquidity 0x1234...5678 25 0.2 0.8            # Add 25 sDAI liquidity with range 0.2-0.8

Environment variables required:
  RPC_URL        The RPC endpoint for Gnosis Chain
  PRIVATE_KEY    Your private key (without 0x prefix)
    `);
    process.exit(0);
  }

  if (args.length < 2) {
    console.error("❌ Error: Missing required arguments");
    console.error("Run 'npm run add-liquidity --help' for usage information");
    process.exit(1);
  }

  const marketAddress = args[0];
  const amount = parseFloat(args[1]);
  const lowerBound = args[2] ? parseFloat(args[2]) : 0.05;
  const upperBound = args[3] ? parseFloat(args[3]) : 0.95;

  // Validate inputs
  if (!marketAddress || !marketAddress.startsWith('0x') || marketAddress.length !== 42) {
    console.error("❌ Error: Invalid market address. Must be a valid Ethereum address (0x...)");
    process.exit(1);
  }

  if (isNaN(amount) || amount <= 0) {
    console.error("❌ Error: Invalid amount. Must be a positive number");
    process.exit(1);
  }

  if (isNaN(lowerBound) || lowerBound < 0 || lowerBound > 1) {
    console.error("❌ Error: Invalid lowerBound. Must be between 0 and 1");
    process.exit(1);
  }

  if (isNaN(upperBound) || upperBound < 0 || upperBound > 1) {
    console.error("❌ Error: Invalid upperBound. Must be between 0 and 1");
    process.exit(1);
  }

  if (lowerBound >= upperBound) {
    console.error("❌ Error: lowerBound must be less than upperBound");
    process.exit(1);
  }

  // Validate environment variables
  if (!process.env.RPC_URL) {
    console.error("❌ Error: RPC_URL environment variable is required");
    console.error("Set it in your .env file or export it: export RPC_URL='https://rpc.gnosis.gateway.fm'");
    process.exit(1);
  }

  if (!process.env.PRIVATE_KEY) {
    console.error("❌ Error: PRIVATE_KEY environment variable is required");
    console.error("Set it in your .env file or export it: export PRIVATE_KEY='your_private_key'");
    process.exit(1);
  }

  const range: LiquidityRange = { lowerBound, upperBound };

  console.log("🚀 Adding liquidity to Seer prediction market...");
  console.log(`📍 Market Address: ${marketAddress}`);
  console.log(`💰 Amount: ${amount} sDAI`);
  console.log(`📊 Price Range: ${lowerBound} - ${upperBound}`);
  console.log("");

  try {
    await addLiquidity(marketAddress, amount, range);
    console.log("✅ Successfully added liquidity to both pools!");
  } catch (error) {
    console.error("❌ Failed to add liquidity:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });
}