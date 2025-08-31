#!/usr/bin/env node

import { providers, Contract } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

// Pool ABI to get factory address
const POOL_ABI = [
  "function factory() view returns (address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
];

// Factory ABI to get position manager (if available)
const FACTORY_ABI = [
  "function owner() view returns (address)",
  "function getPool(address, address, uint24) view returns (address)",
];

async function discoverUniswapAddresses() {
  console.log("🔍 Discovering Uniswap V3 contract addresses on Gnosis Chain...\n");

  try {
    const provider = new providers.JsonRpcProvider(process.env.RPC_URL);

    // Use one of the known Uniswap V3 pools from the DEX tracker
    const knownPoolAddress = "0x2bc64398ae456cdecc31bae5109b3441d54caa45"; // PTTO/WXDAI pool
    
    console.log(`Examining pool: ${knownPoolAddress}`);
    
    const poolContract = new Contract(knownPoolAddress, POOL_ABI, provider);
    
    // Get factory address
    const factoryAddress = await poolContract.factory();
    console.log(`✅ Factory address: ${factoryAddress}`);
    
    // Get pool details
    const token0 = await poolContract.token0();
    const token1 = await poolContract.token1();
    const fee = await poolContract.fee();
    
    console.log(`Pool details:`);
    console.log(`  Token0: ${token0}`);
    console.log(`  Token1: ${token1}`);
    console.log(`  Fee: ${fee}`);
    
    // Check if factory has standard Uniswap V3 methods
    const factoryContract = new Contract(factoryAddress, FACTORY_ABI, provider);
    
    try {
      const owner = await factoryContract.owner();
      console.log(`Factory owner: ${owner}`);
    } catch (e) {
      console.log("Factory doesn't have owner() method");
    }
    
    // Test if we can get the same pool back
    try {
      const retrievedPool = await factoryContract.getPool(token0, token1, fee);
      console.log(`✅ Retrieved pool matches: ${retrievedPool.toLowerCase() === knownPoolAddress.toLowerCase()}`);
    } catch (e) {
      console.log("❌ Factory doesn't have getPool() method");
    }

    // Common Uniswap V3 Position Manager addresses to test
    const commonPositionManagers = [
      "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", // Standard Uniswap V3
      "0x91fd594c46d8b01e62dbdebed2401dde01817834", // Your current Swapr address
      "0x03a520b32C04BF3bEEf7BF5d56E39E5e9b0c81f0", // Another common address
    ];

    console.log("\n🔍 Testing Position Manager addresses:");
    for (const pmAddress of commonPositionManagers) {
      try {
        const code = await provider.getCode(pmAddress);
        if (code !== "0x") {
          console.log(`✅ Position Manager candidate found: ${pmAddress}`);
          
          // Test if it has the mint function
          const PM_ABI = ["function mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256)) payable returns (uint256,uint128,uint256,uint256)"];
          const pmContract = new Contract(pmAddress, PM_ABI, provider);
          
          try {
            // Just check if the function exists (this will fail but tell us if the function signature is correct)
            await pmContract.callStatic.mint([
              "0x0000000000000000000000000000000000000000",
              "0x0000000000000000000000000000000000000000",
              3000,
              0,
              0,
              0,
              0,
              0,
              0,
              "0x0000000000000000000000000000000000000000",
              0
            ]);
          } catch (error: any) {
            if (error.message.includes("function") && !error.message.includes("does not exist")) {
              console.log(`  ✅ Has mint() function with correct signature`);
            } else {
              console.log(`  ❌ Doesn't have correct mint() function`);
            }
          }
        } else {
          console.log(`❌ No contract at: ${pmAddress}`);
        }
      } catch (e) {
        console.log(`❌ Error checking: ${pmAddress}`);
      }
    }

    console.log("\n📋 Summary:");
    console.log(`Factory Address: ${factoryAddress}`);
    console.log("Position Manager: Check the results above");
    console.log("\nNext steps:");
    console.log("1. Use the factory address in your Uniswap implementation");
    console.log("2. Use the working Position Manager address");
    console.log("3. Test with a small amount first");

  } catch (error) {
    console.error("❌ Discovery failed:", error);
  }
}

discoverUniswapAddresses();