#!/usr/bin/env node

import * as fs from "fs";
import { parseUnits } from 'viem';
import { addLiquidity } from "./addLiquidity";
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  const args = process.argv.slice(2);

  // If --all is passed, loop through all market addresses in createdMarkets.json
  if (args[0] === "--all") {
    const amount = args[1] ? parseFloat(args[1]) : 0.005; // default amount
    const lowerBound = args[2] ? parseFloat(args[2]) : 0.05;
    const upperBound = args[3] ? parseFloat(args[3]) : 0.95;
    const chainId = args[4] ? parseInt(args[4]) : 8453; // default to Base

    const markets = JSON.parse(fs.readFileSync("createdMarkets.json", "utf-8"));
    for (const entry of markets) {
      const marketAddress = entry.marketId as `0x${string}`;
      console.log(`\n🚀 Adding liquidity to market: ${marketAddress}`);
      try {
        await addLiquidity({
          marketAddress,
          collateralAmount: parseUnits(amount.toString(), 18),
          minPrice: lowerBound,
          maxPrice: upperBound,
          chainId
        });
        console.log("✅ Successfully added liquidity!");
      } catch (error) {
        console.error(`❌ Failed for ${marketAddress}:`, error);
      }
    }
    process.exit(0);
  }

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage: npm run add-liquidity <marketAddress> <amount> [lowerBound] [upperBound] [chainId]

Arguments:
  marketAddress   The address of the Seer prediction market
  amount         The amount of collateral to use for liquidity (e.g., "100" for 100 tokens)
  lowerBound     Lower bound of price range (0-1, default: 0.05)
  upperBound     Upper bound of price range (0-1, default: 0.95)
  chainId        Chain ID (default: 8453 for Base, 100 for Gnosis, 42161 for Arbitrum)

Examples:
  npm run add-liquidity 0x1234...5678 100                    # Add 100 USDC liquidity on Base
  npm run add-liquidity 0x1234...5678 50 0.1 0.9            # Custom range on Base
  npm run add-liquidity 0x1234...5678 25 0.2 0.8 100        # Add liquidity on Gnosis

Special commands:
  npm run add-liquidity --all [amount] [lowerBound] [upperBound] [chainId]
    Add liquidity to all markets in createdMarkets.json

Environment variables required:
  PRIVATE_KEY    Your private key (with 0x prefix)
    `);
    process.exit(0);
  }

  if (args.length < 2) {
    console.error("❌ Error: Missing required arguments");
    console.error("Run 'npm run add-liquidity --help' for usage information");
    process.exit(1);
  }

  const marketAddress = args[0] as `0x${string}`;
  const amount = parseFloat(args[1]);
  const lowerBound = args[2] ? parseFloat(args[2]) : 0.05;
  const upperBound = args[3] ? parseFloat(args[3]) : 0.95;
  const chainId = args[4] ? parseInt(args[4]) : 8453; // default to Base

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
  if (!process.env.PRIVATE_KEY) {
    console.error("❌ Error: PRIVATE_KEY environment variable is required");
    console.error("Set it in your .env file: PRIVATE_KEY='0x...'");
    process.exit(1);
  }

  console.log("🚀 Adding liquidity to Seer prediction market...");
  console.log(`📍 Market Address: ${marketAddress}`);
  console.log(`💰 Amount: ${amount} tokens`);
  console.log(`📊 Price Range: ${lowerBound} - ${upperBound}`);
  console.log(`🔗 Chain ID: ${chainId}`);
  console.log("");

  try {
    await addLiquidity({
      marketAddress,
      collateralAmount: parseUnits(amount.toString(), 18),
      minPrice: lowerBound,
      maxPrice: upperBound,
      chainId
    });
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