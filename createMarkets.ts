import { JsonRpcProvider, Wallet, Contract } from "ethers";
import { ZeroAddress } from "ethers";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();

const MARKET_FACTORY = "0x83183DA839Ce8228E31Ae41222EaD9EDBb5cDcf1";

// Simplified ABI for clarity
const ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: "string", name: "marketName", type: "string" },
          { internalType: "string[]", name: "outcomes", type: "string[]" },
          { internalType: "string", name: "questionStart", type: "string" },
          { internalType: "string", name: "questionEnd", type: "string" },
          { internalType: "string", name: "outcomeType", type: "string" },
          { internalType: "uint256", name: "parentOutcome", type: "uint256" },
          { internalType: "address", name: "parentMarket", type: "address" },
          { internalType: "string", name: "category", type: "string" },
          { internalType: "string", name: "lang", type: "string" },
          { internalType: "uint256", name: "lowerBound", type: "uint256" },
          { internalType: "uint256", name: "upperBound", type: "uint256" },
          { internalType: "uint256", name: "minBond", type: "uint256" },
          { internalType: "uint32", name: "openingTime", type: "uint32" },
          { internalType: "string[]", name: "tokenNames", type: "string[]" }
        ],
        internalType: "struct MarketFactory.CreateMarketParams",
        name: "params",
        type: "tuple"
      }
    ],
    name: "createScalarMarket",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "nonpayable",
    type: "function"
  }
];

// 🔄 Token name generation with uniqueness enforcement
function generateTokenNamesFromUrls(urls: string[]): [string, string, string][] {
  const used = new Set<string>();
  const tokenNames: [string, string, string][] = [];

  for (const url of urls) {
    const [org, repo] = url.split("/").slice(-2);
    let base = "";

    if (org.toLowerCase() === "ethereum") {
      base = repo.slice(0, 8).toUpperCase();
    } else if (org.toLowerCase().includes("vyperlang")) {
      base = repo.slice(0, 8).toLowerCase();
    } else if (org.toLowerCase().includes("hyperledger")) {
      base = (repo + "web").slice(0, 8).toLowerCase();
    } else {
      base = (org + repo).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase();
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

async function main() {
  const DRY_RUN = true; // Set to false to actually create markets, now just testing for token Names up and down tokens.

  const provider = new JsonRpcProvider(process.env.RPC_URL);
  const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);
  const contract = new Contract(MARKET_FACTORY, ABI, wallet);

  const repos: string[] = JSON.parse(fs.readFileSync("seedRepos.json", "utf-8"));
  const tokens = generateTokenNamesFromUrls(repos);

  for (const [repoPath, downToken, upToken] of tokens) {
    const marketParams = {
      marketName: `[https://cryptopond.xyz/modelfactory/detail/2564617] What will be the originality score assigned by the jurors to github.com/${repoPath}? [score]`,
      outcomes: ["DOWN", "UP"],
      questionStart: "",
      questionEnd: "",
      outcomeType: "",
      parentOutcome: 0n,
      parentMarket: ZeroAddress,
      category: "misc",
      lang: "en_US",
      lowerBound: 0n,
      upperBound: 1000000000000000000n,
      minBond: 10000000000000000000n,
      openingTime: 1757212800,
      tokenNames: [downToken, upToken]
    };

    if (DRY_RUN) {
      console.log(`[DRY RUN] Repo: ${repoPath}, Tokens: [${downToken}, ${upToken}]`);
    } else {
      try {
        const tx = await contract.createScalarMarket(marketParams);
        console.log(`Market created for ${repoPath}: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log("✓ Market created:", receipt.contractAddress ?? receipt.transactionHash);
      } catch (error) {
        console.error(`✗ Failed for ${repoPath}:`, error);
      }
    }
  }
}

main().catch(console.error);
