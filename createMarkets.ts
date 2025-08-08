import { providers, Wallet, Contract } from 'ethers'
import { BigNumber } from 'ethers'
const ZeroAddress = '0x0000000000000000000000000000000000000000'
import * as fs from 'fs'
import * as dotenv from 'dotenv'
dotenv.config()

const MARKET_FACTORY = '0x83183DA839Ce8228E31Ae41222EaD9EDBb5cDcf1'

// Simplified ABI for clarity
const ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: 'string', name: 'marketName', type: 'string' },
          { internalType: 'string[]', name: 'outcomes', type: 'string[]' },
          { internalType: 'string', name: 'questionStart', type: 'string' },
          { internalType: 'string', name: 'questionEnd', type: 'string' },
          { internalType: 'string', name: 'outcomeType', type: 'string' },
          { internalType: 'uint256', name: 'parentOutcome', type: 'uint256' },
          { internalType: 'address', name: 'parentMarket', type: 'address' },
          { internalType: 'string', name: 'category', type: 'string' },
          { internalType: 'string', name: 'lang', type: 'string' },
          { internalType: 'uint256', name: 'lowerBound', type: 'uint256' },
          { internalType: 'uint256', name: 'upperBound', type: 'uint256' },
          { internalType: 'uint256', name: 'minBond', type: 'uint256' },
          { internalType: 'uint32', name: 'openingTime', type: 'uint32' },
          { internalType: 'string[]', name: 'tokenNames', type: 'string[]' }
        ],
        internalType: 'struct MarketFactory.CreateMarketParams',
        name: 'params',
        type: 'tuple'
      }
    ],
    name: 'createScalarMarket',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'nonpayable',
    type: 'function'
  }
]

// 🔄 Token name generation with uniqueness enforcement
function generateTokenNamesFromUrls (
  urls: string[]
): [string, string, string][] {
  const used = new Set<string>()
  const tokenNames: [string, string, string][] = []

  for (const url of urls) {
    const [org, repo] = url.split('/').slice(-2)
    let base = ''

    if (org.toLowerCase() === 'ethereum') {
      base = repo.slice(0, 8).toUpperCase()
    } else if (org.toLowerCase().includes('vyperlang')) {
      base = repo.slice(0, 8).toLowerCase()
    } else if (org.toLowerCase().includes('hyperledger')) {
      base = (repo + 'web').slice(0, 8).toLowerCase()
    } else {
      base = (org + repo)
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 8)
        .toUpperCase()
    }

    let unique = base
    let suffix = 1
    while (used.has(unique)) {
      const next = base.slice(0, 8 - suffix.toString().length) + suffix
      unique = next
      suffix++
    }

    used.add(unique)
    tokenNames.push([`${org}/${repo}`, `${unique}_D`, `${unique}_U`])
  }

  return tokenNames
}

async function main () {
  const DRY_RUN = false // Set to false to actually create markets, now just testing for token Names up and down tokens.

  const provider = new providers.JsonRpcProvider(process.env.RPC_URL)
  const wallet = new Wallet(process.env.PRIVATE_KEY!, provider)
  const contract = new Contract(MARKET_FACTORY, ABI, wallet)

  const repos: string[] = JSON.parse(fs.readFileSync('seedRepos.json', 'utf-8'))
  const tokens = generateTokenNamesFromUrls(repos)

  for (const [repoPath, downToken, upToken] of tokens) {
    const marketParams = {
      marketName: `[https://cryptopond.xyz/modelfactory/detail/2564617] What will be the originality score assigned by the jurors to github.com/${repoPath}? (4 decimals) [score]`,
      outcomes: ['DOWN', 'UP'],
      questionStart: '',
      questionEnd: '',
      outcomeType: '',
      parentOutcome: BigNumber.from('0'),
      parentMarket: ZeroAddress,
      category: 'misc',
      lang: 'en_US',
      lowerBound: BigNumber.from('0'),
      upperBound: BigNumber.from('1000000000000000000'),
      minBond: BigNumber.from('10000000000000000000'),
      openingTime: 1757212800,
      tokenNames: ['DOWN', 'UP'],
    }

    if (DRY_RUN) {
      console.log(
        `[DRY RUN] Repo: ${repoPath}, Tokens: [${downToken}, ${upToken}]`
      )
    } else {
      try {
        const tx = await contract.createScalarMarket(marketParams)
        console.log(`Market created for ${repoPath}: ${tx.hash}`)
        const receipt = await tx.wait()
        const event = receipt.events?.find(
          (e: any) =>
            e.address.toLowerCase() === MARKET_FACTORY.toLowerCase() &&
            e.topics[0] ===
              '0x109e5ac06d4835cca9a97d9014f7bb1bfafb85a2de6d4af1ad22aa8730e12c87'
        )
        if (event) {
          // The market address is the first topic (topics[1])
          const marketAddress = '0x' + event.topics[1].slice(26)
          console.log('✓ Market created at address:', marketAddress)

          // Save to createdMarkets.json
          const file = 'createdMarkets.json'
          let arr: any[] = []
          if (fs.existsSync(file)) {
            arr = JSON.parse(fs.readFileSync(file, 'utf-8'))
          }
          arr.push({ repo: repoPath, marketAddress })
          fs.writeFileSync(file, JSON.stringify(arr, null, 2))

          // Save to marketsLink.json
          const linkFile = 'marketsLink.json'
          let links: string[] = []
          if (fs.existsSync(linkFile)) {
            links = JSON.parse(fs.readFileSync(linkFile, 'utf-8'))
          }
          links.push(`app.seer.pm/markets/100/${marketAddress}`)
          fs.writeFileSync(linkFile, JSON.stringify(links, null, 2))
        } else {
          console.log(
            '✓ Market created, but event not found. Tx hash:',
            receipt.transactionHash
          )
        }
      } catch (error) {
        console.error(`✗ Failed for ${repoPath}:`, error)
      }
    }
  }
}

main().catch(console.error)
