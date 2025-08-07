import { providers, Wallet, Contract, BigNumber } from "ethers";
import { parseEther, getAddress } from "ethers/lib/utils";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { ChainId, Token } from "@swapr/sdk";
import { encodeSqrtRatioX96 as uniEncodeSqrtRatioX96 } from "@uniswap/v3-sdk";
import JSBI from "jsbi";
dotenv.config();

interface LiquidityRange {
  lowerBound: number; // 0 to 1
  upperBound: number; // 0 to 1
}

//// TICKS MANUAL MATH

const LN_1_0001 = Math.log(1.0001);

const priceToTick = (price: number): number => Math.log(price) / LN_1_0001;

//////////

// Swapr constants
const CHAIN_ID = ChainId.GNOSIS; // Gnosis Chain

// Get Gnosis Router address from Swapr SDK instead of hardcoding
const SEER_GNOSIS_ROUTER = getAddress(
  "0xeC9048b59b3467415b1a38F63416407eA0c70fB8"
);
const THEGRAPH_URL =
  "https://gateway.thegraph.com/api/subgraphs/id/B4vyRqJaSHD8dRDb3BFRoAzuBK18c1QQcXq94JbxDxWH";
const THEGRAPH_API_KEY = process.env.GRAPH_API_KEY;

// AlgebraFactory address on Gnosis Chain
const ALGEBRA_FACTORY_ADDRESS = getAddress(
  "0xA0864cCA6E114013AB0e27cbd5B6f4c8947da766"
);

// Swapr V3 Position Manager on Gnosis Chain
const SWAPR_POSITION_MANAGER_ADDRESS = getAddress(
  "0x91fd594c46d8b01e62dbdebed2401dde01817834"
);

// sDAI address on Gnosis Chain
const SDAI_ADDRESS = getAddress("0xaf204776c7245bF4147c2612BF6e5972Ee483701");

// ERC20 ABI for token interactions
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address, uint256) returns (bool)",
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
];

// Swapr V3 Factory ABI (minimal)
const FACTORY_ABI = [
  "function poolByPair(address, address) view returns (address)",
];

// Algebra Pool ABI (minimal) - uses globalState instead of slot0
const POOL_ABI = [
  "function globalState() view returns (uint160 price, int24 tick, uint16 lastFee, uint8 pluginConfig, uint16 communityFee, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function tickSpacing() view returns (int24)",
  "function fee() view returns (uint24)",
  "function initialize(uint160) external",
];

// NonfungiblePositionManager ABI (minimal) - Algebra version
const POSITION_MANAGER_ABI = [
  "function mint((address,address,int24,int24,uint256,uint256,uint256,uint256,address,uint256)) payable returns (uint256,uint128,uint256,uint256)",
  "function createAndInitializePoolIfNecessary(address,address,uint160) payable returns (address)",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
];

const SEER_GNOSIS_ROUTER_ABI = [
  "function splitPosition(address,address,uint256) external",
];
async function getMarketTokens(marketAddress: string): Promise<string[]> {
  const query = `
    {
      markets(where: {id: "${marketAddress.toLowerCase()}"}) {
        wrappedTokens
        outcomes
      }
    }
  `;

  const response = await fetch(THEGRAPH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${THEGRAPH_API_KEY}`,
    },
    body: JSON.stringify({ query }),
  });

  const data = await response.json();

  if (!data.data?.markets?.[0]) {
    throw new Error(`Market not found: ${marketAddress}`);
  }

  const { wrappedTokens } = data.data.markets[0];
  // Remove the last token (invalid token)
  return wrappedTokens.slice(0, -1);
}

async function createPoolWithMulticall(
  wallet: Wallet,
  tokenA: Token,
  tokenB: Token,
  amountA: any,
  amountB: any,
  range: LiquidityRange
): Promise<string> {
  const positionManager = new Contract(
    SWAPR_POSITION_MANAGER_ADDRESS,
    POSITION_MANAGER_ABI,
    wallet
  );

  // Sort tokens lexicographically
  const [token0, token1] =
    tokenA.address.toLowerCase() < tokenB.address.toLowerCase()
      ? [tokenA, tokenB]
      : [tokenB, tokenA];

  const PRICE_MIN =
    token1.address.toLowerCase() === SDAI_ADDRESS.toLowerCase()
      ? 0.05
      : 1 / 0.95;
  const PRICE_MAX =
    token1.address.toLowerCase() === SDAI_ADDRESS.toLowerCase()
      ? 0.95
      : 1 / 0.05;

  // Calculate initial price as midpoint
  const midpoint = (PRICE_MIN + PRICE_MAX) / 2;

  const sqrtPriceX96 = uniEncodeSqrtRatioX96(
    JSBI.BigInt(Math.floor(midpoint * 1e18)), // num
    JSBI.BigInt(1e18) // den
  );

  console.log(
    `Initial pool price: midpoint=${midpoint}, PRICE_MIN=${PRICE_MIN}, PRICE_MAX=${PRICE_MAX}`
  );

  // Encode createAndInitializePoolIfNecessary call
  const createPoolData = positionManager.interface.encodeFunctionData(
    "createAndInitializePoolIfNecessary",
    [token0.address, token1.address, BigNumber.from(sqrtPriceX96.toString())]
  );

  // Calculate ticks for the range with proper token ordering
  {
    const rawLower = priceToTick(PRICE_MIN);
    const rawUpper = priceToTick(PRICE_MAX);
    const tickSpacing = 60; // hardcoded for createPoolWithMulticall
    var lowerTick = Math.floor(rawLower / tickSpacing) * tickSpacing;
    var upperTick = Math.ceil(rawUpper / tickSpacing) * tickSpacing;

    console.log(`Token order: ${token0.symbol} < ${token1.symbol}`);
    console.log(
      `Price range: ${PRICE_MIN}-${PRICE_MAX}, Ticks: [${lowerTick}, ${upperTick}]`
    );
  }

  const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now

  // Encode mint call
  const mintParams = {
    token0: token0.address,
    token1: token1.address,
    tickLower: lowerTick,
    tickUpper: upperTick,
    amount0Desired: amountA,
    amount1Desired: amountB,
    amount0Min: 0,
    amount1Min: 0,
    recipient: wallet.address,
    deadline: deadline,
  };

  const mintData = positionManager.interface.encodeFunctionData("mint", [
    [
      mintParams.token0,
      mintParams.token1,
      mintParams.tickLower,
      mintParams.tickUpper,
      mintParams.amount0Desired,
      mintParams.amount1Desired,
      mintParams.amount0Min,
      mintParams.amount1Min,
      mintParams.recipient,
      mintParams.deadline,
    ],
  ]);

  // Execute multicall with both functions
  const multicallTx = await positionManager.multicall([
    createPoolData,
    mintData,
  ]);
  const receipt = await multicallTx.wait();

  console.log(
    `Pool created and liquidity added via multicall. Transaction: ${receipt.transactionHash}`
  );

  // Get the pool address from factory
  const factory = new Contract(ALGEBRA_FACTORY_ADDRESS, FACTORY_ABI, wallet);
  return await factory.poolByPair(token0.address, token1.address);
}

async function addLiquidityToPool(
  wallet: Wallet,
  tokenA: Token,
  tokenB: Token,
  amount0: any,
  amount1: any,
  range: LiquidityRange
): Promise<void> {
  // Sort tokens for consistent ordering (lexicographic)
  const [token0, token1] =
    tokenA.address.toLowerCase() < tokenB.address.toLowerCase()
      ? [tokenA, tokenB]
      : [tokenB, tokenA];

  const PRICE_MIN =
    token1.address.toLowerCase() === SDAI_ADDRESS.toLowerCase()
      ? 0.05
      : 1 / 0.95; // token1 / token0
  const PRICE_MAX =
    token1.address.toLowerCase() === SDAI_ADDRESS.toLowerCase()
      ? 0.95
      : 1 / 0.05;

  const [amountA, amountB] =
    tokenA.address.toLowerCase() < tokenB.address.toLowerCase()
      ? [amount0, amount1]
      : [amount1, amount0];

  console.log(`Adding liquidity to ${token0.symbol}/${token1.symbol} pool`);

  // Get or create pool
  const factory = new Contract(ALGEBRA_FACTORY_ADDRESS, FACTORY_ABI, wallet);
  let poolAddress = await factory.poolByPair(token0.address, token1.address);

  if (poolAddress === "0x0000000000000000000000000000000000000000") {
    console.log("Pool doesn't exist, will create it with multicall...");

    // Approve tokens for position manager before multicall
    const tokenAContract = new Contract(tokenA.address, ERC20_ABI, wallet);
    const tokenBContract = new Contract(tokenB.address, ERC20_ABI, wallet);

    const approveTxA = await tokenAContract.approve(
      SWAPR_POSITION_MANAGER_ADDRESS,
      amountA
    );
    await approveTxA.wait();

    const approveTxB = await tokenBContract.approve(
      SWAPR_POSITION_MANAGER_ADDRESS,
      amountB
    );
    await approveTxB.wait();

    poolAddress = await createPoolWithMulticall(
      wallet,
      tokenA,
      tokenB,
      amountA,
      amountB,
      range
    );
    console.log(`Created new pool and added liquidity at: ${poolAddress}`);
  } else {
    console.log(`Pool already exists at: ${poolAddress}, adding liquidity...`);

    // TODO if Pool exists, there must be slippage checking!
    // Since this script is meant for Gnosis Chain, PoC etc
    // we don't care about MEV.

    // Get pool contract and info
    const poolContract = new Contract(poolAddress, POOL_ABI, wallet);
    const globalState = await poolContract.globalState();
    const currentTick = globalState.tick;
    const tickSpacing = await poolContract.tickSpacing();

    console.log(
      `Pool globalState - price: ${globalState.price}, tick: ${currentTick}, unlocked: ${globalState.unlocked}`
    );

    // Calculate ticks for the range with proper token ordering
    let lowerTick: number, upperTick: number;
    {
      const rawLower = priceToTick(PRICE_MIN);
      const rawUpper = priceToTick(PRICE_MAX);
      lowerTick = Math.floor(rawLower / tickSpacing) * tickSpacing;
      upperTick = Math.ceil(rawUpper / tickSpacing) * tickSpacing;

      console.log(`Token order: ${token0.symbol} < ${token1.symbol}`);
      console.log(
        `Price range: ${PRICE_MIN}-${PRICE_MAX}, Ticks: [${lowerTick}, ${upperTick}]`
      );
    }

    console.log(
      `Current tick: ${currentTick}, Range: [${lowerTick}, ${upperTick}]`
    );

    // Approve tokens for position manager
    const tokenAContract = new Contract(tokenA.address, ERC20_ABI, wallet);
    const tokenBContract = new Contract(tokenB.address, ERC20_ABI, wallet);

    const approveTxA = await tokenAContract.approve(
      SWAPR_POSITION_MANAGER_ADDRESS,
      amountA
    );
    await approveTxA.wait();

    const approveTxB = await tokenBContract.approve(
      SWAPR_POSITION_MANAGER_ADDRESS,
      amountB
    );
    await approveTxB.wait();

    console.log("Approved tokens for position manager");

    // Mint the position
    const positionManager = new Contract(
      SWAPR_POSITION_MANAGER_ADDRESS,
      POSITION_MANAGER_ABI,
      wallet
    );
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now

    const mintParams = [
      token0.address,
      token1.address,
      lowerTick,
      upperTick,
      amountA,
      amountB,
      0, // amount0Min
      0, // amount1Min
      wallet.address,
      deadline,
    ];

    console.log(`Minting position with params:`, mintParams);
    const mintTx = await positionManager.mint(mintParams);
    const receipt = await mintTx.wait();

    console.log(
      `Liquidity position created. Transaction: ${receipt.transactionHash}`
    );
  }
}

export async function addLiquidity(
  marketAddress: string,
  amount: number,
  range: LiquidityRange
): Promise<void> {
  if (
    range.lowerBound < 0 ||
    range.lowerBound > 1 ||
    range.upperBound < 0 ||
    range.upperBound > 1 ||
    range.lowerBound >= range.upperBound
  ) {
    throw new Error(
      "Range bounds must be between 0 and 1, with lowerBound < upperBound"
    );
  }

  const provider = new providers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);

  try {
    // 1. Get DOWN and UP token addresses from TheGraph
    const tokenAddresses = await getMarketTokens(marketAddress);
    if (tokenAddresses.length !== 2) {
      throw new Error(
        `Expected 2 tokens for scalar market, got ${tokenAddresses.length}`
      );
    }

    const [downTokenAddress, upTokenAddress] = tokenAddresses;
    console.log(`DOWN token: ${downTokenAddress}, UP token: ${upTokenAddress}`);

    // 2. Use sDAI contract address constant
    console.log(`sDAI address: ${SDAI_ADDRESS}`);

    // 3. Approve sDAI for the router and split position
    const sDAIToken = new Contract(SDAI_ADDRESS, ERC20_ABI, wallet);
    const splitAmount = parseEther((amount / 2).toFixed(18));

    // Check current allowance
    const currentAllowance = await sDAIToken.allowance(
      wallet.address,
      SEER_GNOSIS_ROUTER
    );

    if (currentAllowance.lt(splitAmount)) {
      console.log("Approving sDAI for router...");
      const approveTx = await sDAIToken.approve(
        SEER_GNOSIS_ROUTER,
        splitAmount
      );
      await approveTx.wait();
    }

    // Split sDAI position using splitPosition
    const router = new Contract(
      SEER_GNOSIS_ROUTER,
      SEER_GNOSIS_ROUTER_ABI,
      wallet
    );
    const tx = await router.splitPosition(
      SDAI_ADDRESS,
      marketAddress,
      splitAmount,
      { gasLimit: 1_000_000 }
    );
    await tx.wait();
    console.log(
      `Split ${amount / 2} sDAI into conditional tokens using splitPosition`
    );

    // 4. Get token balances after split
    const downToken = new Contract(downTokenAddress, ERC20_ABI, wallet);
    const upToken = new Contract(upTokenAddress, ERC20_ABI, wallet);

    const downBalance = await downToken.balanceOf(wallet.address);
    const upBalance = await upToken.balanceOf(wallet.address);
    const sDAIBalance = await sDAIToken.balanceOf(wallet.address);

    console.log(
      `Token balances - DOWN: ${downBalance}, UP: ${upBalance}, sDAI: ${sDAIBalance}`
    );

    // 5. Create Token instances for Swapr SDK
    if (!downTokenAddress || !upTokenAddress) {
      throw new Error(
        `Invalid token addresses: DOWN=${downTokenAddress}, UP=${upTokenAddress}`
      );
    }

    const downTokenSdk = new Token(
      CHAIN_ID,
      downTokenAddress,
      18,
      "DOWN",
      "DOWN"
    );
    const upTokenSdk = new Token(CHAIN_ID, upTokenAddress, 18, "UP", "UP");
    const sDAITokenSdk = new Token(CHAIN_ID, SDAI_ADDRESS, 18, "sDAI", "sDAI");

    console.log("Created Token instances for Swapr SDK");

    // 6. Add liquidity to both pools
    await addLiquidityToPool(
      wallet,
      downTokenSdk,
      sDAITokenSdk,
      parseEther((amount / 2).toFixed(18)), // Use 1/2 of original amount for DOWN pool (all DOWN tokens)
      parseEther((amount / 4).toFixed(18)), // Use 1/4 of original amount for sDAI
      range
    );

    await addLiquidityToPool(
      wallet,
      upTokenSdk,
      sDAITokenSdk,
      parseEther((amount / 2).toFixed(18)), // Use 1/2 of original amount for UP pool (all UP tokens)
      parseEther((amount / 4).toFixed(18)), // Use 1/4 of original amount for sDAI
      range
    );

    console.log(
      "Successfully added liquidity to both DOWN/sDAI and UP/sDAI pools"
    );
  } catch (error) {
    console.error("Error adding liquidity:", error);
    throw error;
  }
}
