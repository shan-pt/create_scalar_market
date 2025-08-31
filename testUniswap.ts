#!/usr/bin/env node

import { providers, Wallet } from "ethers";
import * as dotenv from "dotenv";
import { Token } from "@uniswap/sdk-core";

dotenv.config();

async function testUniswapSetup() {
  console.log("🧪 Testing Uniswap SDK Setup...\n");

  try {
    // 1. Test RPC connection
    console.log("1. Testing RPC connection...");
    const provider = new providers.JsonRpcProvider(process.env.RPC_URL);
    const network = await provider.getNetwork();
    console.log(`✅ Connected to network: ${network.name} (chainId: ${network.chainId})\n`);

    // 2. Test wallet connection
    console.log("2. Testing wallet connection...");
    const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);
    const balance = await wallet.getBalance();
    console.log(`✅ Wallet address: ${wallet.address}`);
    console.log(`✅ Wallet balance: ${balance.toString()} wei\n`);

    // 3. Test Uniswap SDK Token creation
    console.log("3. Testing Uniswap SDK Token creation...");
    const sDAI_ADDRESS = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";
    const testToken = new Token(100, sDAI_ADDRESS, 18, "sDAI", "sDAI");
    console.log(`✅ Created Token: ${testToken.symbol} at ${testToken.address}\n`);

    // 4. Test contract addresses (check if they exist)
    console.log("4. Testing contract addresses...");
    const UNISWAP_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
    const UNISWAP_V3_POSITION_MANAGER = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
    
    const factoryCode = await provider.getCode(UNISWAP_V3_FACTORY);
    const positionManagerCode = await provider.getCode(UNISWAP_V3_POSITION_MANAGER);
    
    if (factoryCode === "0x") {
      console.log("⚠️  WARNING: Uniswap V3 Factory not found at this address on Gnosis Chain");
      console.log("   You may need to use different contract addresses for Gnosis Chain");
    } else {
      console.log(`✅ Uniswap V3 Factory found at: ${UNISWAP_V3_FACTORY}`);
    }
    
    if (positionManagerCode === "0x") {
      console.log("⚠️  WARNING: Uniswap V3 Position Manager not found at this address on Gnosis Chain");
      console.log("   You may need to use different contract addresses for Gnosis Chain");
    } else {
      console.log(`✅ Uniswap V3 Position Manager found at: ${UNISWAP_V3_POSITION_MANAGER}`);
    }

    console.log("\n🎉 Basic setup test completed!");
    console.log("\n📝 Next steps:");
    console.log("   1. If contract warnings appeared, research correct Uniswap V3 addresses for Gnosis Chain");
    console.log("   2. Test with a small amount first");
    console.log("   3. Use: npm run add-liquidity <marketAddress> <amount> [lowerBound] [upperBound]");

  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

testUniswapSetup();