import { gnosis, mainnet, arbitrum, base, optimism, polygon } from 'viem/chains';
import type { Chain } from 'viem';

export interface ChainConfig {
  chain: Chain;

  // Contract addresses
  contracts: {
    marketFactory: `0x${string}`;
    marketView: `0x${string}`;
    router: `0x${string}`;
    dexFactory: `0x${string}`;
    dexPositionManager: `0x${string}`;
  };
  defaultFee: number;

  // Explorer
  explorerUrl: string;
}

// Default liquidity parameters
export interface LiquidityDefaults {
  minPrice: number; // e.g., 0.05 for 5%
  maxPrice: number; // e.g., 0.95 for 95%
  slippageTolerance: number; // e.g., 0.01 for 1%
};

// Gnosis Chain configuration
export const gnosisConfig: ChainConfig = {
  chain: gnosis,
  contracts: {
    // Seer contracts on Gnosis
    marketFactory: '0x995dC9c89B6605a1E8cc028B37cb8e568e27626f',
    marketView: '0x8210b688B05E8d0924F040BC632a69e2e90ccA87',
    router: '0xeC9048b59b3467415b1a38F63416407eA0c70fB8',

    // Swapr (Algebra) on Gnosis
    dexFactory: '0xA0864cCA6E114013AB0e27cbd5B6f4c8947da766',
    dexPositionManager: '0x91fd594c46d8b01e62dbdebed2401dde01817834',
  },
  defaultFee: 10000,
  explorerUrl: 'https://gnosisscan.io'
};

export const liquidityDefaults: LiquidityDefaults = {
  minPrice: 0.05,
  maxPrice: 0.95,
  slippageTolerance: 0.01
};

// Base configuration (example)
export const baseConfig: ChainConfig = {
  chain: base,
  contracts: {
    // Seer contracts on Base
    marketFactory: '0x886ef0a78fabbae942f1da1791a8ed02a5af8bc6',
    marketView: '0x179d8F8c811B8C759c33809dbc6c5ceDc62D05DD',
    router: '0x3124e97ebF4c9592A17d40E54623953Ff3c77a73',

    // Uniswap V3 on Base
    dexFactory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
    dexPositionManager: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
  },
  defaultFee: 3000,
  explorerUrl: 'https://basescan.org'
};

// Chain ID to config mapping
export const chainConfigs: Record<number, ChainConfig> = {
  [gnosis.id]: gnosisConfig,
  [base.id]: baseConfig,
  // Add more chains as needed
};

export function getChainConfig(chainId: number): ChainConfig {
  const config = chainConfigs[chainId];
  if (!config) {
    throw new Error(`Chain ${chainId} not supported`);
  }
  return config;
}