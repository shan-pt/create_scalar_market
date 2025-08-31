# Uniswap SDK Migration

This branch (`feature/uniswap-sdk`) contains the migration from Swapr SDK to Uniswap SDK for liquidity management.

## Changes Made

### 1. New File: `addLiquidityUniswap.ts`
- Replaced `@swapr/sdk` imports with `@uniswap/sdk-core` and `@uniswap/v3-sdk`
- Updated contract addresses to use Uniswap V3 contracts:
  - Factory: `0x1F98431c8aD98523631AE4a59f267346ea31F984`
  - Position Manager: `0xC36442b4a4522E871399CD717aBDD847Ab11FE88`
- Updated ABI interfaces to match Uniswap V3 standards
- Changed from Algebra's `globalState()` to Uniswap's `slot0()` for pool state
- Added fee tier parameter (default: 3000 = 0.3%)
- Used Uniswap's `nearestUsableTick()` function for tick calculations

### 2. Updated `index.ts`
- Changed import from `./addLiquidity` to `./addLiquidityUniswap`

### 3. Updated `package.json`
- Moved `@uniswap/v3-sdk` from devDependencies to dependencies
- Added `jsbi` as a dependency (required by Uniswap SDK)
- Kept `@swapr/sdk` for backward compatibility (can be removed later)

## Key Differences Between Swapr and Uniswap Implementation

### Contract Addresses
- **Swapr**: Uses Algebra-based contracts with custom addresses
- **Uniswap**: Uses standard Uniswap V3 contracts

### Pool State Access
- **Swapr**: `globalState()` returns `(uint160 price, int24 tick, ...)`
- **Uniswap**: `slot0()` returns `(uint160 sqrtPriceX96, int24 tick, ...)`

### Fee Tiers
- **Swapr**: Uses dynamic fees via Algebra
- **Uniswap**: Uses fixed fee tiers (500, 3000, 10000)

### Tick Spacing
- **Swapr**: Custom tick spacing (60 in the original code)
- **Uniswap**: Standard tick spacing based on fee tier (60 for 0.3% fee)

### Position Manager
- **Swapr**: Custom position manager with Algebra-specific parameters
- **Uniswap**: Standard Uniswap V3 NonfungiblePositionManager

## Usage

The usage remains exactly the same as the original implementation:

```bash
# Add liquidity to a specific market
npm run add-liquidity <marketAddress> <amount> [lowerBound] [upperBound]

# Add liquidity to all markets
npm run add-liquidity --all [amount] [lowerBound] [upperBound]
```

## Important Notes

1. **Contract Addresses**: The Uniswap V3 contract addresses used are the standard mainnet addresses. You may need to verify these are deployed on Gnosis Chain or use the correct addresses for Gnosis Chain.

2. **Fee Tiers**: The implementation uses a default 0.3% fee tier. You may want to make this configurable based on your needs.

3. **Backward Compatibility**: The original `addLiquidity.ts` file is preserved, so you can easily switch back if needed.

4. **Testing**: Make sure to test thoroughly on a testnet before using on mainnet, especially the contract addresses and fee tiers.

## Verification Needed

Before deploying to production, please verify:
1. Uniswap V3 contract addresses on Gnosis Chain
2. Supported fee tiers on Gnosis Chain
3. Token compatibility with Uniswap V3 pools
4. Gas costs comparison between Swapr and Uniswap implementations