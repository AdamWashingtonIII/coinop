// Deploy QTR (contracts/QTR.sol) to Base MAINNET — the mainnet-switch twin of
// scripts/deploy-qtr.js (Hardhat, used for the Sepolia v2 deployment).
// Same artifact bytecode, owner = TREASURY_ADDRESS (Adam's treasury), deployer
// is the throwaway DEPLOYER_PRIVATE_KEY wallet from .env.local.
//
//   node scripts/deploy-qtr-mainnet.mjs --dry-run   # plan + gas estimate, sends NOTHING
//   MAINNET_DEPLOY_CONFIRM=YES node scripts/deploy-qtr-mainnet.mjs
//
// Safety rails:
//  - Preflight proves the local Hardhat artifact is byte-identical (runtime
//    code hash) to the QTR v2 contract already live on Base Sepolia, so the
//    mainnet deploy can only ever ship the exact audited-by-use code. Any
//    mismatch aborts before a transaction is even contemplated.
//  - Without --dry-run, the script refuses to send unless
//    MAINNET_DEPLOY_CONFIRM=YES is set in the environment.
//  - After deployment it verifies owner() on-chain and prints the address.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPublicClient, createWalletClient, http, keccak256, encodeDeployData, formatEther } from "viem";
import { base, baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Fill any missing env from .env.local (same values `node --env-file` would give).
if (existsSync(join(root, ".env.local"))) {
  for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
    const t = line.trim();
    if (t && !t.startsWith("#") && t.includes("=")) {
      const i = t.indexOf("=");
      const k = t.slice(0, i).trim();
      if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
    }
  }
}
const DRY_RUN = process.argv.includes("--dry-run");
const SEPOLIA_QTR_V2 = "0x5Eb82d3B5F39C9CE7ccEa88241cda64bEb5B89e2"; // runtime-code reference
const treasury = process.env.TREASURY_ADDRESS ?? "";
if (!/^0x[0-9a-fA-F]{40}$/.test(treasury)) throw new Error("TREASURY_ADDRESS missing/invalid in env");
if (!process.env.DEPLOYER_PRIVATE_KEY) throw new Error("DEPLOYER_PRIVATE_KEY missing in env");
const deployer = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);

const artifact = JSON.parse(readFileSync(join(root, "artifacts-contracts/contracts/QTR.sol/QTR.json"), "utf8"));
const { abi, bytecode, deployedBytecode } = artifact;

const pubMain = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org") });
const pubSepolia = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org") });

// Preflight: artifact runtime code must equal the live Sepolia v2 code.
const artifactHash = keccak256(deployedBytecode);
const liveCode = await pubSepolia.getCode({ address: SEPOLIA_QTR_V2 });
if (!liveCode) throw new Error("preflight: no code at the Sepolia QTR v2 address — cannot verify artifact");
const liveHash = keccak256(liveCode);
console.log("artifact runtime-code hash:", artifactHash);
console.log("sepolia v2  runtime-code hash:", liveHash);
if (artifactHash !== liveHash) throw new Error("PREFLIGHT FAILED: artifact does not match Sepolia v2 — recompile before any mainnet deploy");
console.log("preflight OK: artifact is byte-identical to the live Sepolia v2 contract");

const data = encodeDeployData({ abi, bytecode, args: [treasury] });
const [gas, gasPrice, balance] = await Promise.all([
  pubMain.estimateGas({ account: deployer.address, data }),
  pubMain.getGasPrice(),
  pubMain.getBalance({ address: deployer.address }),
]);
const cost = gas * gasPrice;
console.log("\n=== QTR mainnet deploy plan ===");
console.log("network:        Base mainnet (chain 8453)");
console.log("deployer:      ", deployer.address);
console.log("owner (treasury):", treasury);
console.log("estimated gas: ", gas.toString());
console.log("gas price:     ", (Number(gasPrice) / 1e9).toFixed(4), "gwei");
console.log("estimated cost:", formatEther(cost), "ETH");
console.log("deployer balance:", formatEther(balance), "ETH", balance >= cost ? "(sufficient)" : "(INSUFFICIENT)");

if (DRY_RUN) { console.log("\n--dry-run: nothing sent."); process.exit(0); }
if (process.env.MAINNET_DEPLOY_CONFIRM !== "YES") {
  console.error("\nREFUSED: real mainnet deploy requires MAINNET_DEPLOY_CONFIRM=YES (and Adam's funding in place).");
  process.exit(1);
}
if (balance < cost) throw new Error("deployer balance below estimated cost — fund the deployer first");

const wallet = createWalletClient({ account: deployer, chain: base, transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org") });
const hash = await wallet.deployContract({ abi, bytecode, args: [treasury] });
console.log("\ndeploy tx:", hash);
const receipt = await pubMain.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("deploy transaction did not produce a contract");
const address = receipt.contractAddress;
const owner = await pubMain.readContract({ address, abi, functionName: "owner" });
const name = await pubMain.readContract({ address, abi, functionName: "name" });
const symbol = await pubMain.readContract({ address, abi, functionName: "symbol" });
console.log("QTR deployed (mainnet):", address);
console.log("owner():", owner, owner.toLowerCase() === treasury.toLowerCase() ? "✓ matches treasury" : "✗ MISMATCH");
console.log("name/symbol:", name, "/", symbol);
console.log("explorer: https://basescan.org/address/" + address);
if (owner.toLowerCase() !== treasury.toLowerCase()) process.exit(1);
