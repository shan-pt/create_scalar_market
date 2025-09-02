
## Installation and Running Scripts

First, install the dependencies:

```bash
yarn install
```

Create Scalar Markets on Gnosis Chain

```bash
yarn create-markets
```

Add liquidity to all created markets for both DOWN & UP tokens:

```bash
yarn add-liquidity --all <amount> [lowerBound] [upperBound]
eg: yarn add-liquidity --all  0.05 0.05 0.95
```

OR

Add liquidity to a specific market for both DOWN & UP tokens:

```bash
npm run add-liquidity <marketAddress> <amount> [lowerBound] [upperBound]
eg: npm run add-liquidity 0x123.. 0.05 0.05 0.95
```
