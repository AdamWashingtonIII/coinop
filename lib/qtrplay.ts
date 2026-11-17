import { randomBytes } from "crypto";
import { eq, sql } from "drizzle-orm";
import { verifyMessage, type Address } from "viem";
import { getDb, schema } from "./db";
// Pay for a play with QTR (ADR 0016): 50 QTR from the wallet's claimable
// ledger balance buys one play. Wallet-signature auth mirrors the Exchange
// (ADR 0013): a single-use 5-minute nonce, message signed verbatim. The
// debit is ONE atomic conditional insert — the row lands only if the
// available balance (ledger sum minus reserved claims) covers the price,
// so two racing coin-ins cannot spend the same QTR twice.
export const QTR_PLAY_PRICE = 50;
export const QTR_MESSAGE = (wallet: string, nonce: string) =>
  `COINOP qtrplay:${wallet.toLowerCase()}:${nonce}`;
const id = () => randomBytes(12).toString("hex");

export async function issueQtrNonce(wallet: string): Promise<{ nonce: string; message: string; expiresAt: number }> {
  const w = wallet.toLowerCase();
  const nonce = randomBytes(16).toString("hex");
  const exp = Date.now() + 5 * 60_000;
  const db = await getDb();
  await db.insert(schema.qtrPlayNonces).values({ nonce, wallet: w, exp: new Date(exp) });
  return { nonce, message: QTR_MESSAGE(w, nonce), expiresAt: exp };
}

export type QtrSpendResult = "ok" | "nonce_invalid" | "signature_invalid" | "insufficient";
export async function spendQtrForPlay(wallet: string, nonce: string, signature: string, refSid: string): Promise<QtrSpendResult> {
  const w = wallet.toLowerCase();
  const db = await getDb();
  const rows = await db.select().from(schema.qtrPlayNonces).where(eq(schema.qtrPlayNonces.nonce, nonce));
  const row = rows[0];
  if (!row || row.wallet !== w || row.exp.getTime() < Date.now()) return "nonce_invalid";
  await db.delete(schema.qtrPlayNonces).where(eq(schema.qtrPlayNonces.nonce, nonce)); // single-use, whatever happens next
  const ok = await verifyMessage({ address: wallet as Address, message: QTR_MESSAGE(w, nonce),
    signature: signature as `0x${string}` }).catch(() => false);
  if (!ok) return "signature_invalid";
  const inserted = await db.execute(sql`
    INSERT INTO rewards_ledger (id, wallet, delta, reason, ref_id, flagged)
    SELECT ${id()}, ${w}, ${-QTR_PLAY_PRICE}, 'play_spend', ${refSid}, false
    WHERE (SELECT coalesce(sum(delta),0) FROM rewards_ledger WHERE wallet = ${w} AND flagged = false)
        - (SELECT coalesce(sum(amount),0) FROM claims WHERE wallet = ${w} AND status IN ('queued','batched','minted'))
        >= ${QTR_PLAY_PRICE}
    RETURNING id`);
  const n = (inserted as unknown as { rows?: unknown[]; rowCount?: number }).rows?.length
    ?? (inserted as unknown as { rowCount?: number }).rowCount ?? 0;
  return n > 0 ? "ok" : "insufficient";
}
