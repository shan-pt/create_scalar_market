#!/usr/bin/env node

import { providers, Contract } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

async function checkPositionManager() {
  console.log("🔍 Checking Position Manager Interface...\n");

  try {
    const provider = new providers.JsonRpcProvider(process.env.RPC_URL);
    const POSITION_MANAGER_ADDRESS = "0xCd03e2e276F6EEdD424d41314437531F665187b9";

    // Try different function signatures to see what's available
    const testFunctions = [
      "function factory() view returns (address)",
      "function createAndInitializePoolIfNecessary(address,address,uint24,uint160) payable returns (address)",
      "function mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256)) payable returns (uint256,uint128,uint256,uint256)",
      "function WETH9() view returns (address)",
      "function owner() view returns (address)",
      "function positions(uint256) view returns (uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)",
    ];

    for (const funcSig of testFunctions) {
      try {
        const contract = new Contract(POSITION_MANAGER_ADDRESS, [funcSig], provider);
        const funcName = funcSig.split('(')[0].split(' ').pop();
        
        if (funcName === 'factory' || funcName === 'WETH9' || funcName === 'owner') {
          const result = await contract[funcName!]();
          console.log(`✅ ${funcName}: ${result}`);
        } else {
          console.log(`✅ ${funcName}: Function exists (not called)`);
        }
      } catch (e) {
        const funcName = funcSig.split('(')[0].split(' ').pop();
        console.log(`❌ ${funcName}: Not available`);
      }
    }

    // Check if it's actually a different type of contract
    console.log("\n🔍 Checking contract bytecode...");
    const code = await provider.getCode(POSITION_MANAGER_ADDRESS);
    console.log(`Contract size: ${code.length} characters`);
    
    // Check if it might be a proxy
    const PROXY_FUNCTIONS = [
      "function implementation() view returns (address)",
      "function admin() view returns (address)",
    ];

    for (const funcSig of PROXY_FUNCTIONS) {
      try {
        const contract = new Contract(POSITION_MANAGER_ADDRESS, [funcSig], provider);
        const funcName = funcSig.split('(')[0].split(' ').pop();
        const result = await contract[funcName!]();
        console.log(`🔄 Proxy ${funcName}: ${result}`);
      } catch (e) {
        // Ignore proxy function errors
      }
    }

    // Let's also check what the factory owner actually is
    const FACTORY_ADDRESS = "0xf78031CBCA409F2FB6876BDFDBc1b2df24cF9bEf";
    const FACTORY_ABI = ["function owner() view returns (address)"];
    const factory = new Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
    const factoryOwner = await factory.owner();
    
    console.log(`\n🏭 Factory owner: ${factoryOwner}`);
    console.log(`Position Manager: ${POSITION_MANAGER_ADDRESS}`);
    console.log(`Same address: ${factoryOwner.toLowerCase() === POSITION_MANAGER_ADDRESS.toLowerCase()}`);

    if (factoryOwner.toLowerCase() === POSITION_MANAGER_ADDRESS.toLowerCase()) {
      console.log("\n💡 The Position Manager IS the factory owner!");
      console.log("This might be a custom implementation, not standard Uniswap V3.");
      console.log("We might need to use the factory directly or find the real position manager.");
    }

  } catch (error) {
    console.error("❌ Check failed:", error);
  }
}

checkPositionManager();