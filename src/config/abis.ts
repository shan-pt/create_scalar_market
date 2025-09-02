// Import ABIs from JSON files
import marketFactoryABIJson from '../abi/MarketFactory.json';
import marketViewABIJson from '../abi/MarketView.json';
import routerABIJson from '../abi/Router.json';
import uniswapV3FactoryABIJson from '../abi/UniswapV3Factory.json';
import uniswapV3PositionManagerABIJson from '../abi/UniswapV3PositionManager.json';

// Export the ABIs with proper typing for viem
export const marketFactoryABI = marketFactoryABIJson;
export const marketViewABI = marketViewABIJson;
export const routerABI = routerABIJson;
export const uniswapV3FactoryABI = uniswapV3FactoryABIJson;
export const uniswapV3PositionManagerABI = uniswapV3PositionManagerABIJson;

// Additional minimal ABIs that we still define inline for simplicity
export const erc20ABI = [
  {
    inputs: [{ name: "owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function"
  }
] as const;

// Import Algebra/Swapr ABIs
import algebraFactoryABIJson from '../abi/AlgebraFactory.json';
import algebraPositionManagerABIJson from '../abi/AlgebraPositionManager.json';

// Export Algebra ABIs with proper typing
export const algebraFactoryABI = algebraFactoryABIJson;
export const algebraPositionManagerABI = algebraPositionManagerABIJson;

// For Algebra pools, we'll use the minimal ABI needed for our operations
export const algebraPoolABI = [
  {
    inputs: [],
    name: "globalState",
    outputs: [
      { name: "price", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "fee", type: "uint16" },
      { name: "timepointIndex", type: "uint16" },
      { name: "communityFeeToken0", type: "uint16" },
      { name: "communityFeeToken1", type: "uint16" },
      { name: "unlocked", type: "bool" }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "tickSpacing",
    outputs: [{ name: "", type: "int24" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "liquidity",
    outputs: [{ name: "", type: "uint128" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "token0",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "token1",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ name: "sqrtPriceX96", type: "uint160" }],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
] as const;

// For conditional tokens
export const conditionalTokensABI = [
  {
    inputs: [
      { name: "collateralToken", type: "address" },
      { name: "parentCollectionId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
      { name: "partition", type: "uint256[]" },
      { name: "amount", type: "uint256" }
    ],
    name: "splitPosition",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { name: "collateralToken", type: "address" },
      { name: "parentCollectionId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
      { name: "indexSets", type: "uint256[]" }
    ],
    name: "getPositionIds",
    outputs: [{ name: "", type: "uint256[]" }],
    stateMutability: "pure",
    type: "function"
  }
] as const;

// Market ABI for direct interactions
export const marketABI = [
  {
    inputs: [],
    name: "conditionId",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "lowerBound",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "upperBound", 
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ name: "index", type: "uint256" }],
    name: "wrappedOutcome",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  }
] as const;

// Uniswap V3 Pool ABI
export const uniswapV3PoolABI = [
  {
    inputs: [],
    name: "slot0",
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "fee",
    outputs: [{ name: "", type: "uint24" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "tickSpacing",
    outputs: [{ name: "", type: "int24" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "token0",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "token1",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "liquidity",
    outputs: [{ name: "", type: "uint128" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ name: "sqrtPriceX96", type: "uint160" }],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
] as const;