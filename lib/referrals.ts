import { randomBytes } from "crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { accrueReferralReward, TOKENS_PER_PLAY } from "./rewards";
// Referral program (ADR 0010). The operator's rule: when an agent you referred
// completes its first game, you earn 25 QTR — the same token unit as a play.
//
// Codes are public attribution, not secrets: "QTR-" + 8 chars from an
// unambiguous alphabet (no 0/O/1/I, so a code read aloud or OCR'd off a
// screenshot can't be mis-transcribed). One code per wallet, created on
// first ask and stable forever after.
//
// Attribution happens at a VERIFIED coin-in (solo /api/coin or a versus
// match create): the code must exist, must not be the payer's own, and the
// payer must be brand-new to the arcade — zero recorded results and no
// existing referral row. Anything else is ignored, never an error: a bad
// code must never cost a player their quarter.
//
// Qualification happens when the referred wallet's first game result is
// recorded (recordResult hook in lib/play/store.ts). The pending ->
// qualified transition is status-guarded, so exactly one caller can win it
// and retries/replays can never double-pay. Past the referrer's daily cap
// the row flips to capped instead: attributed, but no accrual.
export const REFERRAL_REWARD_TOKENS = TOKENS_PER_PLAY; // 25 QTR, the operator's figure
export const REFERRAL_DAILY_CAP = 10; // qualified rewards per referrer per UTC day
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars, no 0/O/1/I
const CODE_RE = /^QTR-[A-Z0-9]{8}$/;
const lc = (w: string) => w.toLowerCase();
const id = () => randomBytes(12).toString("hex");

export function generateReferralCode(): string {
  const bytes = randomBytes(8);
  let out = "QTR-";
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

// The wallet's code, created on first ask. Safe under races: a concurrent
// insert of the same wallet (or an astronomically unlikely code collision)
// falls back to reading the winning row.
export async function getOrCreateReferralCode(wallet: string): Promise<string> {
  const db = await getDb();
  const w = lc(wallet);
  const existing = await db.select({ code: schema.referralCodes.code }).from(schema.referralCodes)
    .where(eq(schema.referralCodes.wallet, w)).limit(1);
  if (existing[0]) return existing[0].code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode();
    try {
      await db.insert(schema.referralCodes).values({ wallet: w, code });
      return code;
    } catch {
      const again = await db.select({ code: schema.referralCodes.code }).from(schema.referralCodes)
        .where(eq(schema.referralCodes.wallet, w)).limit(1);
      if (again[0]) return again[0].code;
    }
  }
  throw new Error("referral_code_unavailable");
}

async function hasRecordedResults(wallet: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select({ n: sql<number>`count(*)` }).from(schema.scores)
    .where(sql`lower(${schema.scores.wallet}) = ${wallet}`);
  return Number(rows[0]?.n ?? 0) > 0;
}

export type AttributionResult =
  | { attributed: true; referrer: string }
  | { attributed: false; reason: "unknown_code" | "self_referral" | "already_attributed" | "has_prior_results" };

// Record a pending referral for a payer who just paid a verified coin with
// someone's code. Never throws for a bad code — callers surface the outcome
// in their response, and a refused attribution never affects the paid play.
export async function attributeReferral(rawCode: unknown, payer: string): Promise<AttributionResult> {
  const db = await getDb();
  const referred = lc(payer);
  const code = normalizeReferralCode(rawCode);
  if (!code) return { attributed: false, reason: "unknown_code" };
  const codeRows = await db.select({ wallet: schema.referralCodes.wallet }).from(schema.referralCodes)
    .where(eq(schema.referralCodes.code, code)).limit(1);
  const referrer = codeRows[0]?.wallet;
  if (!referrer) return { attributed: false, reason: "unknown_code" };
  if (referrer === referred) return { attributed: false, reason: "self_referral" };
  const existing = await db.select({ id: schema.referrals.id }).from(schema.referrals)
    .where(eq(schema.referrals.referredWallet, referred)).limit(1);
  if (existing[0]) return { attributed: false, reason: "already_attributed" };
  if (await hasRecordedResults(referred)) return { attributed: false, reason: "has_prior_results" };
  try {
    await db.insert(schema.referrals).values({ id: id(), referrerWallet: referrer, referredWallet: referred, status: "pending" });
  } catch { return { attributed: false, reason: "already_attributed" }; } // unique-index race
  return { attributed: true, referrer };
}

async function qualifiedTodayCount(referrer: string): Promise<number> {
  const db = await getDb();
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const rows = await db.select({ n: sql<number>`count(*)` }).from(schema.referrals)
    .where(and(eq(schema.referrals.referrerWallet, referrer), eq(schema.referrals.status, "qualified"),
      gte(schema.referrals.qualifiedAt, dayStart)));
  return Number(rows[0]?.n ?? 0);
}

// Qualification, serialized in-process so the daily-cap check and the status
// transition can't interleave within this server (the per-referred-wallet
// uniqueness is additionally enforced by the DB unique index + ledger check).
let qualifyChain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = qualifyChain.then(fn, fn);
  qualifyChain = run.then(() => {}, () => {});
  return run;
}

// Called from recordResult when any wallet records a result. If that wallet
// has a pending referral, this is by construction its FIRST recorded result:
// flip the row (qualified, or capped past the referrer's daily cap) and, for
// qualified, accrue +25 QTR to the referrer exactly once.
export function onReferredFirstResult(wallet: string): Promise<"qualified" | "capped" | null> {
  return serialized(async () => {
    const db = await getDb();
    const referred = lc(wallet);
    const rows = await db.select().from(schema.referrals)
      .where(and(eq(schema.referrals.referredWallet, referred), eq(schema.referrals.status, "pending"))).limit(1);
    const row = rows[0];
    if (!row) return null;
    const capped = (await qualifiedTodayCount(row.referrerWallet)) >= REFERRAL_DAILY_CAP;
    const next = capped ? "capped" : "qualified";
    const won = await db.update(schema.referrals).set({ status: next, qualifiedAt: new Date() })
      .where(and(eq(schema.referrals.id, row.id), eq(schema.referrals.status, "pending"))).returning();
    if (!won.length) return null; // another caller already decided this row
    if (!capped) {
      try {
        // Ledger check (the matches.ts pattern): even if the row transition
        // were somehow replayed, a referral entry for this referred wallet
        // already in the ledger blocks a second payment.
        const paid = await db.select({ id: schema.rewardsLedger.id }).from(schema.rewardsLedger)
          .where(and(eq(schema.rewardsLedger.reason, "referral"), eq(schema.rewardsLedger.refId, referred))).limit(1);
        if (!paid[0]) await accrueReferralReward(row.referrerWallet, referred);
      } catch (e) {
        // Roll back to pending so the next recordResult retry can pay.
        await db.update(schema.referrals).set({ status: "pending", qualifiedAt: null })
          .where(eq(schema.referrals.id, row.id)).catch(() => {});
        throw e;
      }
    }
    return next;
  });
}

export interface ReferralStats { wallet: string; code: string; referred: number; qualified: number;
  capped: number; pending: number; qtrEarned: number }
export async function referralStats(wallet: string): Promise<ReferralStats> {
  const db = await getDb();
  const w = lc(wallet);
  const code = await getOrCreateReferralCode(w);
  const byStatus = await db.select({ status: schema.referrals.status, n: sql<number>`count(*)` })
    .from(schema.referrals).where(eq(schema.referrals.referrerWallet, w)).groupBy(schema.referrals.status);
  const count = (s: string) => Number(byStatus.find((r) => r.status === s)?.n ?? 0);
  const earned = await db.select({ s: sql<number>`coalesce(sum(${schema.rewardsLedger.delta}),0)` })
    .from(schema.rewardsLedger)
    .where(and(eq(schema.rewardsLedger.wallet, w), eq(schema.rewardsLedger.reason, "referral"),
      eq(schema.rewardsLedger.flagged, false)));
  const qualified = count("qualified"), capped = count("capped"), pending = count("pending");
  return { wallet: w, code, referred: qualified + capped + pending, qualified, capped, pending,
    qtrEarned: Number(earned[0]?.s ?? 0) };
}
