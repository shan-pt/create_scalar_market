import { encodeSqrtRatioX96, TickMath, Position, Pool, FeeAmount } from '@uniswap/v3-sdk';
import { Token } from '@uniswap/sdk-core';
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

/**
 * Calculate the exact amounts of token0 and token1 needed for adding liquidity
 * to a Uniswap V3 pool given the current tick and desired price range.
 * Uses the official Uniswap V3 SDK for accurate calculations.
 * 
 * @param currentTick Current tick of the pool
 * @param tickLower Lower tick of the desired range
 * @param tickUpper Upper tick of the desired range
 * @param totalValue Total value to provide as liquidity (in collateral terms)
 * @param isToken0Outcome Whether token0 is the outcome token
 * @param tickSpacing Tick spacing of the pool
 * @param chainId Chain ID for creating token instances
 * @returns Required amounts of token0 and token1
 */
export function calculateTokenAmountsForLiquidity(
  currentTick: number,
  tickLower: number,
  tickUpper: number,
  totalValue: bigint,
  isToken0Outcome: boolean,
  tickSpacing: number = 60,
  chainId: number = 8453
): { amount0: bigint; amount1: bigint; collateralNeeded: bigint; outcomeNeeded: bigint } {
  // Create dummy tokens for the calculation (addresses don't matter for math)
  const token0 = new Token(chainId, '0x0000000000000000000000000000000000000001', 18, 'T0', 'Token0');
  const token1 = new Token(chainId, '0x0000000000000000000000000000000000000002', 18, 'T1', 'Token1');
  
  // Create a dummy pool with the current tick
  const sqrtPriceX96 = TickMath.getSqrtRatioAtTick(currentTick);
  const liquidity = JSBI.BigInt(0); // Start with 0 liquidity
  const pool = new Pool(
    token0,
    token1,
    FeeAmount.MEDIUM, // 3000 (0.3%)
    sqrtPriceX96,
    liquidity,
    currentTick
  );
  
  let amount0: bigint;
  let amount1: bigint;
  
  if (currentTick < tickLower) {
    // Price is below range - only need token0
    // When below range, we provide only token0
    amount0 = totalValue;
    amount1 = 0n;
  } else if (currentTick >= tickUpper) {
    // Price is above range - only need token1
    // When above range, we provide only token1
    amount0 = 0n;
    amount1 = totalValue;
  } else {
    // Price is within range - need both tokens
    // We have a fixed budget of `totalValue` for the collateral token.
    // The Uniswap V3 SDK's Position.fromAmount0 or Position.fromAmount1 can
    // calculate the optimal amounts of both tokens to provide, given a budget
    // for one of them. The SDK respects the pool's current price to determine the ratio.
    
    let position: Position;
    
    if (isToken0Outcome) {
      // Token1 is collateral. Our budget is `totalValue` for token1.
      position = Position.fromAmount1({
        pool,
        tickLower,
        tickUpper,
        amount1: totalValue.toString()
      });
    } else {
      // Token0 is collateral. Our budget is `totalValue` for token0.
      position = Position.fromAmount0({
        pool,
        tickLower,
        tickUpper,
        amount0: totalValue.toString(),
        useFullPrecision: true
      });
    }
    
    // position.mintAmounts gives the actual amounts of token0 and token1 to be provided.
    // These amounts are calculated to be in the correct ratio for the current pool price,
    // and the amount of the budgeted token will be less than or equal to `totalValue`.
    const mintAmounts = position.mintAmounts;
    amount0 = BigInt(mintAmounts.amount0.toString());
    amount1 = BigInt(mintAmounts.amount1.toString());
  }
  
  // Calculate actual collateral and outcome needed
  const collateralNeeded = isToken0Outcome ? amount1 : amount0;
  const outcomeNeeded = isToken0Outcome ? amount0 : amount1;
  
  return { amount0, amount1, collateralNeeded, outcomeNeeded };
}

/**
 * Calculate total collateral needed for providing liquidity to multiple pools
 * @param poolRequirements Array of requirements for each pool
 * @param chainId Chain ID for token creation
 * @returns Total collateral needed
 */
export function calculateTotalCollateralNeeded(
  poolRequirements: Array<{
    exists: boolean;
    currentTick?: number;
    tickLower: number;
    tickUpper: number;
    desiredLiquidity: bigint;
    isToken0Outcome: boolean;
    tickSpacing?: number;
  }>,
  chainId: number = 8453
): bigint {
  let totalCollateral = 0n;
  
  for (const req of poolRequirements) {
    if (!req.exists) {
      // New pool - we'll initialize at midpoint, so need 50/50 split
      // This means we need half the desired liquidity in collateral
      totalCollateral += req.desiredLiquidity / 2n;
    } else if (req.currentTick !== undefined) {
      // Existing pool - calculate based on current price
      const { collateralNeeded } = calculateTokenAmountsForLiquidity(
        req.currentTick,
        req.tickLower,
        req.tickUpper,
        req.desiredLiquidity,
        req.isToken0Outcome,
        req.tickSpacing || 60,
        chainId
      );
      totalCollateral += collateralNeeded;
    }
  }
  
  return totalCollateral;
}