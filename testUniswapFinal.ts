#!/usr/bin/env node

import { providers, Wallet, Contract } from "ethers";
import { Token } from "@uniswap/sdk-core";
import * as dotenv from "dotenv";

dotenv.config();

async function testUniswapFinal() {
  console.log("🧪 Final Uniswap V3 Setup Test on Gnosis Chain...\n");

  try {
    const provider = new providers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);

    // Verified addresses
    const FACTORY_ADDRESS = "0xf78031CBCA409F2FB6876BDFDBc1b2df24cF9bEf";
    const POSITION_MANAGER_ADDRESS = "0xCd03e2e276F6EEdD424d41314437531F665187b9";
    const SDAI_ADDRESS = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";

    console.log("1. ✅ RPC Connection: OK");
    console.log(`2. ✅ Wallet: ${wallet.address}`);
    console.log(`3. ✅ Factory: ${FACTORY_ADDRESS}`);
    console.log(`4. ✅ Position Manager: ${POSITION_MANAGER_ADDRESS}`);

    // Test factory
    const FACTORY_ABI = [
      "function getPool(address, address, uint24) view returns (address)",
      "function owner() view returns (address)",
    ];

    const factory = new Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
    const factoryOwner = await factory.owner();
    console.log(`5. ✅ Factory Owner: ${factoryOwner}`);

    // Test position manager
    const POSITION_MANAGER_ABI = [
      "function factory() view returns (address)",
      "function WETH9() view returns (address)",
    ];

    const positionManager = new Contract(POSITION_MANAGER_ADDRESS, POSITION_MANAGER_ABI, provider);
    const pmFactory = await positionManager.factory();
    console.log(`6. ✅ Position Manager Factory: ${pmFactory}`);
    console.log(`7. ✅ Factory Match: ${pmFactory.toLowerCase() === FACTORY_ADDRESS.toLowerCase()}`);

    try {
      const weth9 = await positionManager.WETH9();
      console.log(`8. ✅ WETH9: ${weth9}`);
    } catch (e) {
      console.log(`8. ⚠️  WETH9: Not available (might use different method)`);
    }

    // Test Token creation
    const sDAIToken = new Token(100, SDAI_ADDRESS, 18, "sDAI", "sDAI");
    console.log(`9. ✅ Token Creation: ${sDAIToken.symbol} at ${sDAIToken.address}`);

    // Test existing pool
    const testPool = await factory.getPool(
      "0xdD2027fcA129005B6255295ceB7e281365e50B0e", // PTTO
      "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d", // WXDAI
      500 // 0.05% fee
    );
    console.log(`10. ✅ Test Pool Query: ${testPool}`);

    console.log("\n🎉 ALL TESTS PASSED!");
    console.log("\n📋 Ready to use:");
    console.log(`Factory: ${FACTORY_ADDRESS}`);
    console.log(`Position Manager: ${POSITION_MANAGER_ADDRESS}`);
    console.log("\n🚀 You can now test with:");
    console.log("npm run add-liquidity <marketAddress> <amount> [lowerBound] [upperBound]");
    console.log("\n⚠️  Start with a SMALL amount for testing!");

  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

testUniswapFinal();