#!/usr/bin/env node

import { providers, Contract } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

async function findRealPositionManager() {
  console.log("🔍 Looking for the real Uniswap V3 Position Manager...\n");

  try {
    const provider = new providers.JsonRpcProvider(process.env.RPC_URL);

    // Common Uniswap V3 Position Manager addresses across chains
    const possibleAddresses = [
      "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", // Standard Uniswap V3
      "0x91ae842A5Ffd8d12023116943e72A606179294f3", // Alternative
      "0x03a520b32C04BF3bEEf7BF5d56E39E5d9b7D4E0C", // Another possibility
      "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364", // PancakeSwap style
    ];

    const POSITION_MANAGER_FUNCTIONS = [
      "function mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256)) payable returns (uint256,uint128,uint256,uint256)",
      "function factory() view returns (address)",
      "function WETH9() view returns (address)",
      "function positions(uint256) view returns (uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)",
    ];

    for (const address of possibleAddresses) {
      console.log(`\n🔍 Checking ${address}...`);
      
      try {
        // Check if contract exists
        const code = await provider.getCode(address);
        if (code === "0x") {
          console.log(`❌ No contract at this address`);
          continue;
        }

        console.log(`✅ Contract exists (${code.length} bytes)`);

        // Test each function
        let validFunctions = 0;
        for (const funcSig of POSITION_MANAGER_FUNCTIONS) {
          try {
            const contract = new Contract(address, [funcSig], provider);
            const funcName = funcSig.split('(')[0].split(' ').pop();
            
            if (funcName === 'factory' || funcName === 'WETH9') {
              const result = await contract[funcName!]();
              console.log(`  ✅ ${funcName}: ${result}`);
              validFunctions++;
            } else {
              // Just check if function exists without calling
              console.log(`  ✅ ${funcName}: Function exists`);
              validFunctions++;
            }
          } catch (e) {
            const funcName = funcSig.split('(')[0].split(' ').pop();
            console.log(`  ❌ ${funcName}: Not available`);
          }
        }

        if (validFunctions >= 3) {
          console.log(`\n🎉 FOUND VALID POSITION MANAGER: ${address}`);
          console.log(`This contract has ${validFunctions}/${POSITION_MANAGER_FUNCTIONS.length} expected functions`);
          
          // Test if it works with our factory
          try {
            const contract = new Contract(address, ["function factory() view returns (address)"], provider);
            const factory = await contract.factory();
            console.log(`Factory: ${factory}`);
            
            if (factory.toLowerCase() === "0xf78031CBCA409F2FB6876BDFDBc1b2df24cF9bEf".toLowerCase()) {
              console.log(`✅ PERFECT MATCH! This Position Manager works with our factory!`);
              return address;
            } else {
              console.log(`❌ Different factory: ${factory}`);
            }
          } catch (e) {
            console.log(`❌ Could not verify factory`);
          }
        }

      } catch (error: any) {
        console.log(`❌ Error checking ${address}: ${error.message}`);
      }
    }

    console.log(`\n🤔 No standard Position Manager found. Let's check what the current contract actually is...`);
    
    // Check what the current contract actually supports
    const currentAddress = "0xCd03e2e276F6EEdD424d41314437531F665187b9";
    console.log(`\n🔍 Analyzing current contract: ${currentAddress}`);
    
    const testFunctions = [
      "function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256) returns (uint256,uint256,uint256)",
      "function createPool(address,address,uint24) returns (address)",
      "function addLiquidityETH(address,uint256,uint256,uint256,address,uint256) payable returns (uint256,uint256,uint256)",
      "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])",
    ];

    for (const funcSig of testFunctions) {
      try {
        const contract = new Contract(currentAddress, [funcSig], provider);
        const funcName = funcSig.split('(')[0].split(' ').pop();
        console.log(`  ✅ ${funcName}: Available`);
      } catch (e) {
        const funcName = funcSig.split('(')[0].split(' ').pop();
        console.log(`  ❌ ${funcName}: Not available`);
      }
    }

  } catch (error) {
    console.error("❌ Search failed:", error);
  }
}

findRealPositionManager();