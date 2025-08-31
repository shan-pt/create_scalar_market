#!/usr/bin/env node

import { addLiquiditySmallAmount } from "./addLiquiditySmallAmount";

interface LiquidityRange {
  lowerBound: number;
  upperBound: number;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage: npx ts-node testSmallLiquidity.ts <marketAddress> <amount> [lowerBound] [upperBound]

This script is optimized for very small liquidity amounts (0.001 - 0.1 sDAI)

Arguments:
  marketAddress   The address of the Seer prediction market
  amount         The amount of sDAI to use for liquidity (e.g., "0.01" for 0.01 sDAI)
  lowerBound     Lower bound of price range (0-1, default: 0.05)
  upperBound     Upper bound of price range (0-1, default: 0.95)

Examples:
  npx ts-node testSmallLiquidity.ts 0x21a70e522adb02dfb51ac9970c97f710f1e17034 0.01
  npx ts-node testSmallLiquidity.ts 0x21a70e522adb02dfb51ac9970c97f710f1e17034 0.001 0.1 0.9
  npx ts-node testSmallLiquidity.ts 0x21a70e522adb02dfb51ac9970c97f710f1e17034 0.005 0.2 0.8

Environment variables required:
  RPC_URL        The RPC endpoint for Gnosis Chain
  PRIVATE_KEY    Your private key (without 0x prefix)
  GRAPH_API_KEY  Your Graph API key
    `);
    process.exit(0);
  }

  if (args.length < 2) {
    console.error("❌ Error: Missing required arguments");
    console.error("Run 'npx ts-node testSmallLiquidity.ts --help' for usage information");
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

  if (amount < 0.0001) {
    console.error("❌ Error: Amount too small. Minimum recommended: 0.0001 sDAI");
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

  if (!process.env.GRAPH_API_KEY) {
    console.error("❌ Error: GRAPH_API_KEY environment variable is required");
    console.error("Set it in your .env file");
    process.exit(1);
  }

  const range: LiquidityRange = { lowerBound, upperBound };

  console.log("🚀 Adding small amount liquidity to Seer prediction market...");
  console.log(`📍 Market Address: ${marketAddress}`);
  console.log(`💰 Amount: ${amount} sDAI`);
  console.log(`📊 Price Range: ${lowerBound} - ${upperBound}`);
  
  if (amount < 0.01) {
    console.log("⚠️  Warning: Very small amount detected. Gas costs may be significant relative to liquidity value.");
  }
  
  console.log("");

  try {
    await addLiquiditySmallAmount(marketAddress, amount, range);
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