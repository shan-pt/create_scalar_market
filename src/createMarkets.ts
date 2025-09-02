import { parseUnits } from 'viem';
import { getContract, decodeEventLog } from 'viem';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { getChainConfig } from './config/chains';
import { ContractClient } from './utils/contracts';
import { marketFactoryABI } from './config/abis';
import { RetryConfig } from './config/retry';

dotenv.config();

// 🔄 Token name generation with uniqueness enforcement
function generateTokenNamesFromUrls(
  urls: string[]
): [string, string, string][] {
  const used = new Set<string>();
  const tokenNames: [string, string, string][] = [];

  for (const url of urls) {
    const [org, repo] = url.split('/').slice(-2);
    let base = '';

    if (org.toLowerCase() === 'ethereum') {
      base = repo.slice(0, 8).toUpperCase();
    } else if (org.toLowerCase().includes('vyperlang')) {
      base = repo.slice(0, 8).toLowerCase();
    } else if (org.toLowerCase().includes('hyperledger')) {
      base = (repo + 'web').slice(0, 8).toLowerCase();
    } else {
      base = (org + repo)
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 8)
        .toUpperCase();
    }

    let unique = base;
    let suffix = 1;
    while (used.has(unique)) {
      const next = base.slice(0, 8 - suffix.toString().length) + suffix;
      unique = next;
      suffix++;
    }

    used.add(unique);
    tokenNames.push([`${org}/${repo}`, `${unique}_D`, `${unique}_U`]);
  }

  return tokenNames;
}

interface CreatedMarket {
  repoPath: string;
  marketId: `0x${string}`;
  downToken: string;
  upToken: string;
  txHash: `0x${string}`;
  timestamp: number;
}

interface MarketProgress {
  lastProcessedIndex: number;
  createdMarkets: CreatedMarket[];
}

/**
 * Load existing progress from file
 */
function loadProgress(): MarketProgress {
  const progressFile = 'marketProgress.json';
  
  if (fs.existsSync(progressFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
      console.log(`\n📂 Loaded existing progress: ${data.createdMarkets.length} markets already created`);
      return data;
    } catch (error) {
      console.warn('⚠️ Failed to load progress file, starting fresh');
    }
  }
  
  return {
    lastProcessedIndex: -1,
    createdMarkets: []
  };
}

/**
 * Save progress to file (append-only style)
 */
function saveProgress(progress: MarketProgress) {
  const progressFile = 'marketProgress.json';
  fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
}

/**
 * Append a single market to the log file
 */
function appendMarketToLog(market: CreatedMarket) {
  const logFile = 'createdMarkets.log';
  fs.appendFileSync(logFile, JSON.stringify(market) + '\n');
}

async function main() {
  const DRY_RUN = false; // Set to false to actually create markets

  const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY not found in environment variables');
  }

  const chainId = parseInt(process.env.CHAIN_ID || '100');
  const config = getChainConfig(chainId);
  const client = new ContractClient(config, privateKey);

  const marketFactory = getContract({
    address: config.contracts.marketFactory,
    abi: marketFactoryABI,
    client: client.walletClient
  });

  // Load existing progress to resume if interrupted
  const progress = loadProgress();
  const processedRepos = new Set(progress.createdMarkets.map(m => m.repoPath));

  const repos: string[] = JSON.parse(fs.readFileSync('seedRepos.json', 'utf-8'));
  const tokens = generateTokenNamesFromUrls(repos);

  // Filter out already processed markets
  const marketsToCreate = tokens.filter(([repoPath]) => !processedRepos.has(repoPath));
  
  if (marketsToCreate.length === 0) {
    console.log('\n✅ All markets from seedRepos.json have already been created!');
    console.log(`Total markets created: ${progress.createdMarkets.length}`);
    return;
  }

  console.log(`\n📊 Market Creation Summary:`);
  console.log(`  Total markets in seedRepos.json: ${repos.length}`);
  console.log(`  Already created: ${progress.createdMarkets.length}`);
  console.log(`  Remaining to create: ${marketsToCreate.length}`);
  console.log('');

  // Arrays to store newly created markets
  const newlyCreatedMarkets: CreatedMarket[] = [];
  const marketsLinks: any[] = [];

  // Process markets sequentially with rate limiting
  for (let i = 0; i < marketsToCreate.length; i++) {
    const [repoPath, downToken, upToken] = marketsToCreate[i];
    const marketNumber = i + 1;
    const totalRemaining = marketsToCreate.length;
    const marketParams = {
      marketName: `[https://cryptopond.xyz/modelfactory/detail/2564617] What will be the originality score assigned by the jurors to github.com/${repoPath}? (4 decimals) [score]`,
      outcomes: ['DOWN', 'UP'],
      questionStart: '',
      questionEnd: '',
      outcomeType: '',
      parentOutcome: 0n,
      parentMarket: '0x0000000000000000000000000000000000000000' as `0x${string}`,
      category: 'misc',
      lang: 'en_US',
      lowerBound: parseUnits('0', 18),
      upperBound: parseUnits('1', 18),
      minBond: parseUnits('10', 18), // 10 tokens minimum bond
      openingTime: 1757212800, // Unix timestamp for opening
      tokenNames: ['DOWN', 'UP'] // Use outcome names, not generated token names
    };

    console.log(`\n[${marketNumber}/${totalRemaining}] Creating market for ${repoPath}`);
    console.log(`  Token names: ${downToken}, ${upToken}`);

    if (!DRY_RUN) {
      try {
        // Create the market with retry logic
        const txHash = await client.executeWithRetry(
          async () => {
            return await marketFactory.write.createScalarMarket([marketParams], {
              account: client.account,
              chain: config.chain
            });
          },
          RetryConfig.RATE_LIMIT_RETRIES,
          RetryConfig.RATE_LIMIT_DELAY
        );

        console.log(`  Transaction sent: ${config.explorerUrl}/tx/${txHash}`);

        // Wait for confirmation with retry
        const receipt = await client.executeWithRetry(
          async () => client.waitForTransaction(txHash),
          RetryConfig.DEFAULT_RETRIES,
          RetryConfig.DEFAULT_DELAY
        );
        console.log(`  ✓ Transaction confirmed`);

        // Parse the MarketCreated event from receipt logs
        let marketId: `0x${string}` | null = null;
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: marketFactoryABI,
              data: log.data,
              topics: log.topics
            });
            
            if (decoded.eventName === 'NewMarket' && decoded.args) {
              const args = decoded.args as unknown as { 
                market: `0x${string}`;
                marketName: string;
                parentMarket: `0x${string}`;
                conditionId: `0x${string}`;
                questionId: `0x${string}`;
                questionsIds: `0x${string}`[];
              };
              marketId = args.market;
              break;
            }
          } catch {
            // Not the event we're looking for
          }
        }

        if (!marketId) {
          console.error('  ⚠ Market created but could not find market ID in logs');
          continue;
        }

        console.log(`  ✓ Market created with ID: ${marketId}`);

        // Store market data
        const createdMarket: CreatedMarket = {
          repoPath,
          marketId,
          downToken,
          upToken,
          txHash,
          timestamp: Date.now()
        };

        // Append to log file immediately (for crash recovery)
        appendMarketToLog(createdMarket);
        
        // Update in-memory progress
        progress.createdMarkets.push(createdMarket);
        progress.lastProcessedIndex = i;
        newlyCreatedMarkets.push(createdMarket);
        
        // Save progress after each successful creation
        saveProgress(progress);

        marketsLinks.push({
          repoPath,
          marketUrl: `https://app.seer.pm/markets/${marketId}`,
          explorerUrl: `${config.explorerUrl}/tx/${txHash}`
        });

        // Add delay between operations to avoid rate limits
        if (i < marketsToCreate.length - 1) {
          console.log(`  ⏳ Waiting ${RetryConfig.OPERATION_DELAY}ms before next market...`);
          await client.delay(RetryConfig.OPERATION_DELAY);
        }

      } catch (error: any) {
        console.error(`  ❌ Failed to create market after retries:`, error.message || error);
        
        // Check if it's a non-retryable error
        if (error.message?.includes('insufficient funds') || 
            error.message?.includes('nonce too low')) {
          console.error('\n🛑 Fatal error detected, stopping execution');
          break;
        }
        
        // Continue with next market for other errors
        console.log('  Continuing with next market...');
      }
    } else {
      console.log('  [DRY RUN] Market would be created with these parameters');
    }
  }

  // Write final results
  if (!DRY_RUN && newlyCreatedMarkets.length > 0) {
    // Write all created markets (including previously created ones)
    fs.writeFileSync('createdMarkets.json', JSON.stringify(progress.createdMarkets, null, 2));
    
    // Write market links for all markets
    const allMarketLinks = progress.createdMarkets.map(m => ({
      repoPath: m.repoPath,
      marketUrl: `https://app.seer.pm/markets/${m.marketId}`,
      explorerUrl: `${config.explorerUrl}/tx/${m.txHash}`
    }));
    fs.writeFileSync('marketsLink.json', JSON.stringify(allMarketLinks, null, 2));
    
    console.log('\n✅ Market creation session complete!');
    console.log(`  Newly created: ${newlyCreatedMarkets.length} markets`);
    console.log(`  Total created: ${progress.createdMarkets.length} markets`);
    console.log('  Results saved to createdMarkets.json and marketsLink.json');
    console.log('  Progress saved to marketProgress.json');
    console.log('  Log appended to createdMarkets.log');
  } else if (DRY_RUN) {
    console.log('\n[DRY RUN] No markets were created');
  } else if (!DRY_RUN && newlyCreatedMarkets.length === 0) {
    console.log('\n⚠️ No new markets were created in this session');
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}