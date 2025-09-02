import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Hash,
  type TransactionReceipt,
  getContract
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { ChainConfig } from '../config/chains';
import { RetryConfig } from '../config/retry';
import {
  marketViewABI,
  erc20ABI,
  routerABI,
  algebraFactoryABI,
  algebraPoolABI,
  uniswapV3FactoryABI,
  uniswapV3PoolABI
} from '../config/abis';

export interface MarketInfo {
  id: `0x${string}`;
  conditionId: `0x${string}`;
  collateralToken: `0x${string}`;
  wrappedTokens: `0x${string}`[];
  outcomeTokens: `0x${string}`;
  lowerBound: bigint;
  upperBound: bigint;
}

export class ContractClient {
  public publicClient: PublicClient;
  public walletClient: WalletClient;
  public account: ReturnType<typeof privateKeyToAccount>;

  constructor(
    public config: ChainConfig,
    privateKey: `0x${string}`,
    rpcUrl?: string
  ) {
    this.account = privateKeyToAccount(privateKey);

    // Use batch transport for better performance and to avoid rate limits
    this.publicClient = createPublicClient({
      chain: config.chain,
      transport: http(rpcUrl || undefined, {
        batch: {
          wait: 100, // Wait 100ms to batch requests
          batchSize: 10 // Max 10 requests per batch
        },
        retryCount: 3,
        retryDelay: 1000 // 1 second delay between retries
      })
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain: config.chain,
      transport: http(rpcUrl || undefined, {
        retryCount: 3,
        retryDelay: 1000
      })
    });
  }

  /**
   * Get market information from the MarketView contract
   */
  async getMarketInfo(marketAddress: `0x${string}`): Promise<MarketInfo> {
    // Get MarketView contract instance
    const marketView = getContract({
      address: this.config.contracts.marketView,
      abi: marketViewABI,
      client: this.publicClient
    });

    // Fetch market data from MarketView
    const result = await marketView.read.getMarket([
      this.config.contracts.marketFactory,
      marketAddress
    ]) as {
      id: `0x${string}`;
      conditionId: `0x${string}`;
      collateralToken: `0x${string}`;
      wrappedTokens: `0x${string}`[];
      lowerBound: bigint;
      upperBound: bigint;
      marketName: string;
      outcomes: string[];
      outcomesSupply: bigint;
      parentCollectionId: `0x${string}`;
      questionId: `0x${string}`;
      payoutReported: boolean;
      payoutNumerators: bigint[];
    };

    return {
      id: result.id,
      conditionId: result.conditionId,
      collateralToken: result.collateralToken,
      wrappedTokens: result.wrappedTokens,
      outcomeTokens: '0x' as `0x${string}`, // Not directly provided by MarketView, will need to compute
      lowerBound: result.lowerBound,
      upperBound: result.upperBound
    };
  }

  /**
   * Get pool address (works for both Algebra and Uniswap V3)
   */
  async getPool(
    token0: `0x${string}`,
    token1: `0x${string}`,
    fee?: number
  ): Promise<`0x${string}` | null> {
    if (this.config.chain.id === 100) {
      const factory = getContract({
        address: this.config.contracts.dexFactory,
        abi: algebraFactoryABI,
        client: this.publicClient
      });

      const pool = await factory.read.poolByPair([token0, token1]);
      return pool === '0x0000000000000000000000000000000000000000' ? null : pool as `0x${string}`;
    } else {
      const factory = getContract({
        address: this.config.contracts.dexFactory,
        abi: uniswapV3FactoryABI,
        client: this.publicClient
      });
      const poolFee = fee || this.config.defaultFee;
      const pool = await factory.read.getPool([token0, token1, poolFee]);
      return pool === '0x0000000000000000000000000000000000000000' ? null : pool as `0x${string}`;
    }
  }

  /**
   * Get pool state (works for both Algebra and Uniswap V3)
   */
  async getPoolState(poolAddress: `0x${string}`): Promise<{
    sqrtPriceX96: bigint;
    tick: number;
    liquidity: bigint;
    tickSpacing: number;
    fee: number;
  }> {
    if (this.config.chain.id === 100) {
      // Use multicall for batch reads on Algebra
      const results = await this.publicClient.multicall({
        contracts: [
          {
            address: poolAddress,
            abi: algebraPoolABI,
            functionName: 'globalState'
          },
          {
            address: poolAddress,
            abi: algebraPoolABI,
            functionName: 'tickSpacing'
          },
          {
            address: poolAddress,
            abi: algebraPoolABI,
            functionName: 'liquidity'
          }
        ]
      });

      const globalState = results[0].result as any;
      const tickSpacing = results[1].result as number;
      const liquidity = results[2].result as bigint;

      return {
        sqrtPriceX96: globalState[0],
        tick: globalState[1],
        liquidity,
        tickSpacing,
        fee: globalState[2]
      };
    } else {
      // Use multicall for batch reads on Uniswap V3
      const results = await this.publicClient.multicall({
        contracts: [
          {
            address: poolAddress,
            abi: uniswapV3PoolABI,
            functionName: 'slot0'
          },
          {
            address: poolAddress,
            abi: uniswapV3PoolABI,
            functionName: 'tickSpacing'
          },
          {
            address: poolAddress,
            abi: uniswapV3PoolABI,
            functionName: 'liquidity'
          },
          {
            address: poolAddress,
            abi: uniswapV3PoolABI,
            functionName: 'fee'
          }
        ]
      });

      const slot0 = results[0].result as any;
      const tickSpacing = results[1].result as number;
      const liquidity = results[2].result as bigint;
      const fee = results[3].result as number;

      return {
        sqrtPriceX96: slot0[0],
        tick: slot0[1],
        liquidity,
        tickSpacing,
        fee
      };
    }
  }

  /**
   * Create pool (works for both Algebra and Uniswap V3)
   */
  async createPool(
    token0: `0x${string}`,
    token1: `0x${string}`,
    sqrtPriceX96: bigint,
    fee?: number
  ): Promise<Hash> {
    if (this.config.chain.id === 100) {
      const factory = getContract({
        address: this.config.contracts.dexFactory,
        abi: algebraFactoryABI,
        client: this.walletClient
      });

      return await factory.write.createPool([token0, token1, sqrtPriceX96], {
        account: this.account,
        chain: this.config.chain
      });
    } else {
      // For Uniswap V3, first create pool then initialize
      const factory = getContract({
        address: this.config.contracts.dexFactory,
        abi: uniswapV3FactoryABI,
        client: this.walletClient
      });

      const poolFee = fee || this.config.defaultFee;
      const txHash = await factory.write.createPool([token0, token1, poolFee], {
        account: this.account,
        chain: this.config.chain
      });

      // Wait for pool creation
      await this.waitForTransaction(txHash);

      // Get the created pool address with retries
      let poolAddress: `0x${string}` | null = null;
      for (let i = 0; i < 5; i++) {
        poolAddress = await this.getPool(token0, token1, poolFee);
        if (poolAddress) break;
        console.log(`  Pool not found, retrying... (${i + 1}/5)`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2s delay
      }
      if (!poolAddress) throw new Error('Pool creation failed after multiple retries');

      // Initialize the pool
      const pool = getContract({
        address: poolAddress,
        abi: uniswapV3PoolABI,
        client: this.walletClient
      });

      return await pool.write.initialize([sqrtPriceX96], {
        account: this.account,
        chain: this.config.chain
      });
    }
  }

  /**
   * Approve token spending
   */
  async approveToken(
    tokenAddress: `0x${string}`,
    spender: `0x${string}`,
    amount: bigint
  ): Promise<Hash> {
    const token = getContract({
      address: tokenAddress,
      abi: erc20ABI,
      client: this.walletClient
    });

    return await token.write.approve([spender, amount], {
      account: this.account,
      chain: this.config.chain
    });
  }

  /**
   * Get token balance
   */
  async getTokenBalance(
    tokenAddress: `0x${string}`,
    owner: `0x${string}`
  ): Promise<bigint> {
    const token = getContract({
      address: tokenAddress,
      abi: erc20ABI,
      client: this.publicClient
    });

    return await token.read.balanceOf([owner]);
  }

  /**
   * Get token decimals
   */
  async getTokenDecimals(
    tokenAddress: `0x${string}`
  ): Promise<number> {
    const token = getContract({
      address: tokenAddress,
      abi: erc20ABI,
      client: this.publicClient
    });

    return await token.read.decimals();
  }

  /**
   * Split position using Router
   */
  async splitPosition(
    marketAddress: `0x${string}`,
    amount: bigint,
    collateralToken: `0x${string}`
  ): Promise<Hash> {
    const token = getContract({
      address: collateralToken,
      abi: erc20ABI,
      client: this.publicClient
    });

    // Check existing allowance for Router (only Router needs approval)
    const routerAllowance = await token.read.allowance([
      this.account.address,
      this.config.contracts.router
    ]);

    console.log(`  Current Router allowance: ${routerAllowance}, needed: ${amount}`);
    
    // Approve Router if necessary (use max uint256 for unlimited approval)
    if (routerAllowance < amount) {
      const tokenWrite = getContract({
        address: collateralToken,
        abi: erc20ABI,
        client: this.walletClient
      });

      // Use max uint256 for approval to avoid issues
      const maxApproval = 2n ** 256n - 1n;
      const approveTx = await tokenWrite.write.approve(
        [this.config.contracts.router, maxApproval],
        {
          account: this.account,
          chain: this.config.chain
        }
      );

      // Wait for approval
      await this.waitForTransaction(approveTx);
      console.log('  ✓ Approved Router to spend collateral (max approval)');
      
      // Double-check the approval went through
      const newAllowance = await token.read.allowance([
        this.account.address,
        this.config.contracts.router
      ]);
      console.log(`  New Router allowance: ${newAllowance}`);
    } else {
      console.log('  ✓ Router already has sufficient allowance');
    }

    // Now split the position via router
    const router = getContract({
      address: this.config.contracts.router,
      abi: routerABI,
      client: this.walletClient
    });

    return await router.write.splitPosition([collateralToken, marketAddress, amount], {
      account: this.account,
      chain: this.config.chain
    });
  }

  /**
   * Wait for transaction and verify success
   */
  async waitForTransaction(
    hash: Hash,
    confirmations = 1
  ): Promise<TransactionReceipt> {
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      confirmations
    });

    if (receipt.status === 'reverted') {
      throw new Error(`Transaction ${hash} reverted`);
    }

    return receipt;
  }

  /**
   * Estimate gas for a transaction
   */
  async estimateGas<T>(
    fn: () => Promise<T>
  ): Promise<bigint> {
    try {
      // Simulate the transaction to get gas estimate
      const gasEstimate = await this.publicClient.estimateGas({
        account: this.account,
        to: this.config.contracts.router, // Default, will be overridden by actual call
        value: 0n
      });
      return gasEstimate;
    } catch (error) {
      console.warn('Gas estimation failed:', error);
      // Return a default estimate if estimation fails
      return 500000n;
    }
  }

  /**
   * Execute with retry logic and exponential backoff for rate limits
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    baseDelay = 1000
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error as Error;
        
        // Check if it's a rate limit error
        const isRateLimit = error.message?.includes('rate limit') || 
                          error.details?.includes('rate limit') ||
                          error.cause?.message?.includes('rate limit') ||
                          error.status === 429;
        
        if (i < maxRetries - 1) {
          // Use exponential backoff for rate limits with max delay cap
          const delay = isRateLimit 
            ? Math.min(baseDelay * Math.pow(RetryConfig.BACKOFF_MULTIPLIER, i), RetryConfig.MAX_DELAY)
            : baseDelay;
          console.log(`Attempt ${i + 1} failed${isRateLimit ? ' (rate limited)' : ''}, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  /**
   * Helper to add delays between operations
   */
  async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}