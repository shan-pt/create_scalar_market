
## Installation and Running Scripts

First, install the dependencies:

```bash
npm install
```
## Installation and Running Scripts

Create Scalar Markets on Gnosis Chain

```bash
npx ts-node createMarkets.ts
```

## Add Liquidity on Gnosis Chain

Add liquidity to all created markets for both DOWN & UP tokens:

```bash
npx ts-node index.ts --all <amount> [lowerBound] [upperBound]
# Example:
npx ts-node index.ts --all 0.05 0.05 0.95
```

OR

Add liquidity to a specific market for both DOWN & UP tokens:

```bash
npm run add-liquidity <marketAddress> <amount> [lowerBound] [upperBound]
eg: npm run add-liquidity 0x123.. 0.05 0.05 0.95
```

## Add Liquidity on Base Chain (sUSDS)
Add liquidity in sUSDS to a specific market on Base Chain using Uniswap V3:
```bash
npx ts-node addLiquidityBaseSUSDS.ts <marketAddress> <amount> [lowerBound] [upperBound]
```