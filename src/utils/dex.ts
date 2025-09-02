import { encodeSqrtRatioX96, TickMath } from '@uniswap/v3-sdk';
import JSBI from 'jsbi';
import type { ChainConfig } from '../config/chains';

const Q96 = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(96));
const LN_1_0001 = Math.log(1.0001);

export function priceToTick(price: number): number {
  return Math.floor(Math.log(price) / LN_1_0001);
}

export function tickToPrice(tick: number): number {
  return Math.pow(1.0001, tick);
}

/**
 * Calculate sqrt price for pool initialization
 * @param price Price of token1 in terms of token0
 * @param decimals0 Decimals of token0
 * @param decimals1 Decimals of token1
 */
export function encodeSqrtPriceX96(
  price: number,
  decimals0: number,
  decimals1: number
): bigint {
  // Use Uniswap SDK for accurate calculation
  const adjustedPrice = price * Math.pow(10, decimals0 - decimals1);
  const sqrtPrice = Math.sqrt(adjustedPrice);
  const sqrtPriceX96 = JSBI.multiply(
    JSBI.BigInt(Math.floor(sqrtPrice * 1e18)),
    Q96
  );
  return BigInt(JSBI.divide(sqrtPriceX96, JSBI.BigInt(1e18)).toString());
}

/**
 * Calculate tick bounds for prediction market liquidity
 * @param minPrice Minimum price (e.g., 0.05)
 * @param maxPrice Maximum price (e.g., 0.95)
 * @param tickSpacing Tick spacing of the pool
 * @param isToken0Outcome Whether token0 is the outcome token
 */
export function calculateTickBounds(
  minPrice: number,
  maxPrice: number,
  tickSpacing: number,
  isToken0Outcome: boolean
): { tickLower: number; tickUpper: number } {
  let tickLower: number;
  let tickUpper: number;

  if (isToken0Outcome) {
    // token0 is outcome, token1 is collateral
    // Price = collateral/outcome
    // Valid range: [minPrice, maxPrice] collateral per outcome
    tickLower = Math.floor(priceToTick(minPrice) / tickSpacing) * tickSpacing;
    tickUpper = Math.ceil(priceToTick(maxPrice) / tickSpacing) * tickSpacing;
  } else {
    // token0 is collateral, token1 is outcome
    // Price = outcome/collateral
    // Valid range: [1/maxPrice, 1/minPrice] outcome per collateral
    tickLower = Math.floor(priceToTick(1 / maxPrice) / tickSpacing) * tickSpacing;
    tickUpper = Math.ceil(priceToTick(1 / minPrice) / tickSpacing) * tickSpacing;
  }

  // Ensure ticks are within valid range
  const MIN_TICK = TickMath.MIN_TICK;
  const MAX_TICK = TickMath.MAX_TICK;
  
  tickLower = Math.max(tickLower, MIN_TICK);
  tickUpper = Math.min(tickUpper, MAX_TICK);

  return { tickLower, tickUpper };
}

/**
 * Get the correct tick spacing for a fee tier
 */
export function getTickSpacing(fee: number, config: ChainConfig): number {
  // For Gnosis (Algebra/Swapr), tick spacing is always 60
  if (config.chain.id === 100) {
    return 60;
  }
  
  // For Uniswap V3 on other chains, use standard tick spacings
  const uniswapV3TickSpacings: Record<number, number> = {
    500: 10,    // 0.05% fee
    3000: 60,   // 0.3% fee
    10000: 200  // 1% fee
  };
  
  const tickSpacing = uniswapV3TickSpacings[fee];
  if (!tickSpacing) {
    throw new Error(`No tick spacing configured for fee ${fee}`);
  }
  return tickSpacing;
}

/**
 * Calculate minimum amounts for slippage protection
 * @param amount0Desired Desired amount of token0
 * @param amount1Desired Desired amount of token1
 * @param slippageTolerance Slippage tolerance (e.g., 0.01 for 1%)
 */
export function calculateMinAmounts(
  amount0Desired: bigint,
  amount1Desired: bigint,
  slippageTolerance: number
): { amount0Min: bigint; amount1Min: bigint } {
  const factor = BigInt(Math.floor((1 - slippageTolerance) * 10000));
  const amount0Min = (amount0Desired * factor) / 10000n;
  const amount1Min = (amount1Desired * factor) / 10000n;
  
  return { amount0Min, amount1Min };
}

/**
 * Sort tokens to get the correct order for pool
 */
export function sortTokens(
  tokenA: `0x${string}`,
  tokenB: `0x${string}`
): [`0x${string}`, `0x${string}`] {
  return tokenA.toLowerCase() < tokenB.toLowerCase() 
    ? [tokenA, tokenB] 
    : [tokenB, tokenA];
}