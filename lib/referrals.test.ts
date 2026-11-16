import { describe, it, expect } from "vitest";
process.env.COINOP_DB_DIR = "memory://"; // in-memory PGlite: no disk, isolated per test file
process.env.SESSION_HMAC_SECRET = "test-secret-for-referrals";
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import { getOrCreateReferralCode, attributeReferral, onReferredFirstResult,
  referralStats, normalizeReferralCode, REFERRAL_DAILY_CAP } from "./referrals";
import { rewardBalance } from "./rewards";
import { createPlaySession, recordResult } from "./play/store";

// Distinct lowercase wallets per test — the in-memory DB is shared per file.
const W = (n: number) => "0x" + n.toString(16).padStart(40, "0");
async function referralRow(referred: string) {
  const db = await getDb();
  const rows = await db.select().from(schema.referrals).where(eq(schema.referrals.referredWallet, referred)).limit(1);
  return rows[0];
}

describe("referral codes (ADR 0010)", () => {
  it("format is QTR- + 8 unambiguous chars, and creation is idempotent", async () => {
    const code = await getOrCreateReferralCode(W(1));
    expect(code).toMatch(/^QTR-[A-Z0-9]{8}$/);
    expect(code).not.toMatch(/[01IO]/); // no ambiguous characters after the prefix rules
    expect(code.slice(4)).not.toMatch(/[01IO]/);
    expect(await getOrCreateReferralCode(W(1))).toBe(code); // same wallet, same code forever
    expect(await getOrCreateReferralCode(W(1).toUpperCase().replace("0X", "0x"))).toBe(code);
  });
  it("different wallets get different codes", async () => {
    expect(await getOrCreateReferralCode(W(2))).not.toBe(await getOrCreateReferralCode(W(3)));
  });
  it("normalize accepts messy input, rejects malformed codes", () => {
    expect(normalizeReferralCode("  qtr-ab3def7h ")).toBe("QTR-AB3DEF7H");
    expect(normalizeReferralCode("QTR-123")).toBeNull();
    expect(normalizeReferralCode("hello")).toBeNull();
    expect(normalizeReferralCode(undefined)).toBeNull();
  });
});

describe("attribution guards", () => {
  it("valid code + brand-new payer -> pending row", async () => {
    const code = await getOrCreateReferralCode(W(10));
    const r = await attributeReferral(code, W(11));
    expect(r.attributed).toBe(true);
    const row = await referralRow(W(11));
    expect(row?.referrerWallet).toBe(W(10));
    expect(row?.status).toBe("pending");
  });
  it("unknown and malformed codes are ignored", async () => {
    expect(await attributeReferral("QTR-ZZZZZZZZ", W(12))).toEqual({ attributed: false, reason: "unknown_code" });
    expect(await attributeReferral("not-a-code", W(12))).toEqual({ attributed: false, reason: "unknown_code" });
    expect(await referralRow(W(12))).toBeUndefined();
  });
  it("self-referral is impossible", async () => {
    const code = await getOrCreateReferralCode(W(13));
    expect(await attributeReferral(code, W(13))).toEqual({ attributed: false, reason: "self_referral" });
    expect(await referralRow(W(13))).toBeUndefined();
  });
  it("a payer can be attributed exactly once — to anyone", async () => {
    const c1 = await getOrCreateReferralCode(W(14));
    const c2 = await getOrCreateReferralCode(W(15));
    expect((await attributeReferral(c1, W(16))).attributed).toBe(true);
    expect(await attributeReferral(c1, W(16))).toEqual({ attributed: false, reason: "already_attributed" });
    expect(await attributeReferral(c2, W(16))).toEqual({ attributed: false, reason: "already_attributed" });
  });
  it("a payer with prior recorded results cannot be referred", async () => {
    const db = await getDb();
    await db.insert(schema.scores).values({ id: "prior-score", gameSlug: "stacker", wallet: W(17),
      value: 90, verified: true, sessionId: "old-session", rulesetHash: "test" });
    const code = await getOrCreateReferralCode(W(18));
    expect(await attributeReferral(code, W(17))).toEqual({ attributed: false, reason: "has_prior_results" });
    expect(await referralRow(W(17))).toBeUndefined();
  });
});

describe("qualification", () => {
  it("first recorded result pays the referrer exactly 25 QTR, exactly once", async () => {
    const code = await getOrCreateReferralCode(W(20));
    await attributeReferral(code, W(21));
    expect(await onReferredFirstResult(W(21))).toBe("qualified");
    expect(await rewardBalance(W(20))).toBe(25);
    // retries / replays cannot double-pay
    expect(await onReferredFirstResult(W(21))).toBeNull();
    expect(await onReferredFirstResult(W(21))).toBeNull();
    expect(await rewardBalance(W(20))).toBe(25);
    const stats = await referralStats(W(20));
    expect(stats).toMatchObject({ referred: 1, qualified: 1, qtrEarned: 25, code });
  });
  it("a wallet with no pending referral qualifies nothing", async () => {
    expect(await onReferredFirstResult(W(22))).toBeNull();
    expect(await rewardBalance(W(22))).toBe(0);
  });
  it("recordResult hook: a referred wallet's first finished game pays out (double-fire safe)", async () => {
    const code = await getOrCreateReferralCode(W(23));
    await attributeReferral(code, W(24));
    const { session } = await createPlaySession("snake", W(24));
    // Snake is wall-clock driven and dies on the far wall with no steering.
    const deadline = Date.now() + 9000;
    while (!session.game.isOver && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 200));
    expect(session.game.isOver).toBe(true);
    await recordResult(session);
    await recordResult(session); // the play routes may re-fire; must stay a no-op
    expect((await referralRow(W(24)))?.status).toBe("qualified");
    expect(await rewardBalance(W(23))).toBe(25);
  }, 20000);
});

describe("daily cap", () => {
  it(`the ${REFERRAL_DAILY_CAP + 1}th qualification in a day is capped: attributed, no accrual`, async () => {
    const referrer = W(30);
    const code = await getOrCreateReferralCode(referrer);
    for (let i = 0; i < REFERRAL_DAILY_CAP + 1; i++) {
      const referred = W(100 + i);
      expect((await attributeReferral(code, referred)).attributed).toBe(true);
      const outcome = await onReferredFirstResult(referred);
      expect(outcome).toBe(i < REFERRAL_DAILY_CAP ? "qualified" : "capped");
    }
    expect(await rewardBalance(referrer)).toBe(25 * REFERRAL_DAILY_CAP);
    const stats = await referralStats(referrer);
    expect(stats.referred).toBe(REFERRAL_DAILY_CAP + 1);
    expect(stats.qualified).toBe(REFERRAL_DAILY_CAP);
    expect(stats.capped).toBe(1);
    expect(stats.qtrEarned).toBe(25 * REFERRAL_DAILY_CAP);
    expect((await referralRow(W(100 + REFERRAL_DAILY_CAP)))?.status).toBe("capped");
  });
});
