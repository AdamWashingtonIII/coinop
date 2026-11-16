import { randomBytes } from "crypto";
import { and, asc, eq, lt } from "drizzle-orm";
import { createPublicClient, createWalletClient, http, parseEther, verifyMessage, type Address } from "viem";
import { base, baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { getDb, schema } from "./db";
import { availableToClaim } from "./rewards";
// QTR claims (ADR 0004 + automated claims): an agent proves wallet ownership by
// signing a one-time nonce message, which reserves its full claimable balance as
// a queued claim. The batch processor (processClaims) mints queued claims from
// the arcade's appointed minter wallet — capped at 1,000 QTR per mint by the
// contract itself, and by CLAIM_RUN_CAP_TOKENS per run here. The treasury key
// is never involved: the owner appointed the minter once (QTR.setMinter) and
// can revoke it the same way.
export const CLAIM_MESSAGE = (wallet: string, nonce: string) =>
  `COINOP claim:${wallet.toLowerCase()}:${nonce}`;
const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;
const id = () => randomBytes(12).toString("hex");

export async function issueClaimNonce(wallet: string): Promise<{ nonce: string; message: string; expiresAt: number }> {
  if (!WALLET_RE.test(wallet)) throw new Error("bad_wallet");
  const db = await getDb();
  const w = wallet.toLowerCase();
  await db.delete(schema.claimNonces).where(lt(schema.claimNonces.exp, new Date())); // opportunistic cleanup
  const nonce = randomBytes(16).toString("hex");
  const exp = new Date(Date.now() + 5 * 60_000);
  await db.insert(schema.claimNonces).values({ nonce, wallet: w, exp });
  return { nonce, message: CLAIM_MESSAGE(w, nonce), expiresAt: exp.getTime() };
}

export interface Claim { id: string; wallet: string; amount: number; status: string; txHash: string | null; createdAt: number }
export async function submitClaim(wallet: string, nonce: string, signature: string): Promise<Claim> {
  if (!WALLET_RE.test(wallet)) throw new Error("bad_wallet");
  const db = await getDb();
  const w = wallet.toLowerCase();
  const rows = await db.select().from(schema.claimNonces).where(eq(schema.claimNonces.nonce, nonce)).limit(1);
  const row = rows[0];
  if (!row || row.wallet !== w) throw new Error("bad_nonce");
  if (row.exp.getTime() < Date.now()) { await db.delete(schema.claimNonces).where(eq(schema.claimNonces.nonce, nonce)); throw new Error("nonce_expired"); }
  const ok = await verifyMessage({ address: wallet as Address, message: CLAIM_MESSAGE(w, nonce), signature: signature as `0x${string}` })
    .catch(() => false);
  if (!ok) throw new Error("bad_signature");
  await db.delete(schema.claimNonces).where(eq(schema.claimNonces.nonce, nonce)); // single-use
  const amount = await availableToClaim(w);
  if (amount <= 0) throw new Error("nothing_to_claim");
  const claim: Claim = { id: id(), wallet: w, amount, status: "queued", txHash: null, createdAt: Date.now() };
  await db.insert(schema.claims).values({ id: claim.id, wallet: w, amount, status: "queued" });
  return claim;
}

export async function listClaims(wallet: string): Promise<Claim[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.claims).where(eq(schema.claims.wallet, wallet.toLowerCase()))
    .orderBy(asc(schema.claims.createdAt));
  return rows.map((r) => ({ id: r.id, wallet: r.wallet, amount: r.amount, status: r.status,
    txHash: r.txHash, createdAt: r.createdAt.getTime() }));
}

const QTR_ABI = [
  { type: "function", name: "minter", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "mint", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
] as const;

export interface ProcessResult { batchId: string; minted: { claimId: string; wallet: string; amount: number; tx: string }[];
  failed: { claimId: string; reason: string }[]; note?: string }
export async function processClaims(): Promise<ProcessResult> {
  const batchId = id();
  const key = process.env.CLAIM_MINTER_PRIVATE_KEY;
  const contract = process.env.QTR_CONTRACT_ADDRESS;
  if (!key || !contract) return { batchId, minted: [], failed: [], note: "minter_not_configured" };
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "84532");
  const chain = chainId === base.id ? base : baseSepolia;
  const rpc = chainId === base.id ? (process.env.BASE_RPC_URL ?? "https://mainnet.base.org") : "https://sepolia.base.org";
  const account = privateKeyToAccount(key as `0x${string}`);
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const onChainMinter = await pub.readContract({ address: contract as Address, abi: QTR_ABI, functionName: "minter" });
  if (onChainMinter.toLowerCase() !== account.address.toLowerCase())
    return { batchId, minted: [], failed: [], note: "minter_not_appointed_on_chain" };
  const db = await getDb();
  const queued = await db.select().from(schema.claims).where(eq(schema.claims.status, "queued"))
    .orderBy(asc(schema.claims.createdAt)).limit(50);
  const runCap = Number(process.env.CLAIM_RUN_CAP_TOKENS ?? "5000");
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  const minted: ProcessResult["minted"] = [];
  const failed: ProcessResult["failed"] = [];
  let spent = 0;
  for (const c of queued) {
    if (spent + c.amount > runCap) { failed.push({ claimId: c.id, reason: "run_cap_reached" }); continue; }
    await db.update(schema.claims).set({ status: "batched", batchId }).where(eq(schema.claims.id, c.id));
    try {
      const tx = await wallet.writeContract({ address: contract as Address, abi: QTR_ABI,
        functionName: "mint", args: [c.wallet as Address, parseEther(String(c.amount))] });
      const receipt = await pub.waitForTransactionReceipt({ hash: tx });
      if (receipt.status !== "success") throw new Error("tx_reverted");
      await db.update(schema.claims).set({ status: "minted", txHash: tx, mintedAt: new Date() }).where(eq(schema.claims.id, c.id));
      minted.push({ claimId: c.id, wallet: c.wallet, amount: c.amount, tx });
      spent += c.amount;
    } catch (e) {
      await db.update(schema.claims).set({ status: "failed", batchId }).where(eq(schema.claims.id, c.id));
      failed.push({ claimId: c.id, reason: e instanceof Error ? e.message.slice(0, 120) : "mint_failed" });
    }
  }
  return { batchId, minted, failed };
}
