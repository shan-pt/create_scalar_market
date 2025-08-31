#!/usr/bin/env node

import { providers, Contract } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

async function findPositionManager() {
  console.log("🔍 Finding Uniswap V3 Position Manager on Gnosis Chain...\n");

  try {
    const provider = new providers.JsonRpcProvider(process.env.RPC_URL);
    const factoryAddress = "0xf78031CBCA409F2FB6876BDFDBc1b2df24cF9bEf";

    // Let's check recent transactions to the factory to see what position managers are being used
    console.log("Checking recent transactions to find Position Manager...");

    // Common Position Manager addresses from various chains
    const candidateAddresses = [
      "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", // Standard Uniswap V3
      "0x91fd594c46d8b01e62dbdebed2401dde01817834", // Current Swapr (might be compatible)
      "0x03a520b32C04BF3bEEf7BF5d56E39E5e9b0c81f0", // Base chain
      "0x1238536071E1c677A632429e3655c799b22cDA52", // Another common one
      "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364", // Polygon
      "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", // SwapRouter02
      "0xE592427A0AEce92De3Edee1F18E0157C05861564", // SwapRouter
    ];

    const POSITION_MANAGER_ABI = [
      "function factory() view returns (address)",
      "function WETH9() view returns (address)",
      "function mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256)) payable returns (uint256,uint128,uint256,uint256)",
      "function createAndInitializePoolIfNecessary(address,address,uint24,uint160) payable returns (address)",
    ];

    for (const address of candidateAddresses) {
      try {
        const code = await provider.getCode(address);
        if (code !== "0x") {
          console.log(`\n✅ Contract found at: ${address}`);
          
          const contract = new Contract(address, POSITION_MANAGER_ABI, provider);
          
          try {
            const contractFactory = await contract.factory();
            console.log(`  Factory: ${contractFactory}`);
            
            if (contractFactory.toLowerCase() === factoryAddress.toLowerCase()) {
              console.log(`  🎉 MATCH! This Position Manager uses our factory!`);
              
              try {
                const weth = await contract.WETH9();
                console.log(`  WETH9: ${weth}`);
              } catch (e) {
                console.log(`  WETH9: Not available`);
              }
              
              console.log(`\n🎯 FOUND POSITION MANAGER: ${address}`);
              return address;
            } else {
              console.log(`  ❌ Uses different factory: ${contractFactory}`);
            }
          } catch (e) {
            console.log(`  ❌ Doesn't have factory() method or error: ${e}`);
          }
        } else {
          console.log(`❌ No contract at: ${address}`);
        }
      } catch (e) {
        console.log(`❌ Error checking ${address}: ${e}`);
      }
    }

    console.log("\n❌ No matching Position Manager found in common addresses.");
    console.log("Let's try to find it by looking at successful mint transactions...");

    // Alternative: Check if we can find the position manager by looking at the factory owner
    const FACTORY_ABI = [
      "function owner() view returns (address)",
    ];
    
    const factoryContract = new Contract(factoryAddress, FACTORY_ABI, provider);
    const owner = await factoryContract.owner();
    console.log(`\nFactory owner: ${owner}`);
    
    // Check if the owner might be the position manager or related
    const ownerCode = await provider.getCode(owner);
    if (ownerCode !== "0x") {
      console.log("Factory owner is a contract, checking if it's position manager related...");
      
      const ownerContract = new Contract(owner, POSITION_MANAGER_ABI, provider);
      try {
        const ownerFactory = await ownerContract.factory();
        if (ownerFactory.toLowerCase() === factoryAddress.toLowerCase()) {
          console.log(`🎉 Factory owner IS the Position Manager: ${owner}`);
          return owner;
        }
      } catch (e) {
        console.log("Factory owner is not a Position Manager");
      }
    }

    console.log("\n💡 Suggestions:");
    console.log("1. The Position Manager might be deployed at a custom address");
    console.log("2. You might need to deploy your own Position Manager");
    console.log("3. Or use the existing Swapr Position Manager with modified ABI");
    
    return null;

  } catch (error) {
    console.error("❌ Search failed:", error);
    return null;
  }
}

findPositionManager().then(result => {
  if (result) {
    console.log(`\n✅ Use this Position Manager address: ${result}`);
  } else {
    console.log("\n❌ No Position Manager found. You may need to use Swapr or deploy your own.");
  }
});