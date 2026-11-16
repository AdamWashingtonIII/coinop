import { describe, it, expect } from "vitest";
import { settleOutcome, expiredPayout, STAKE_ATOMIC } from "./match-settle";
// ADR 0009 economics: winner refunded + 25 QTR, loser -> treasury, no other rake.
const sum = (legs: { amount: bigint }[]) => legs.reduce((a, l) => a + l.amount, 0n);

describe("versus settlement (ADR 0009)", () => {
  it("stake is exactly one quarter", () => { expect(STAKE_ATOMIC).toBe(250000n); });

  it("higher score wins: winner refunded, loser to treasury, winner +25 QTR", () => {
    const r = settleOutcome({ scoreA: 300, scoreB: 120, finishedA: true, finishedB: true });
    expect(r.kind).toBe("win"); expect(r.winner).toBe("a");
    expect(r.legs).toEqual([{ to: "a", amount: 250000n }, { to: "treasury", amount: 250000n }]);
    expect(r.qtrA).toBe(25); expect(r.qtrB).toBe(0);
    const r2 = settleOutcome({ scoreA: 10, scoreB: 990, finishedA: true, finishedB: true });
    expect(r2.winner).toBe("b");
    expect(r2.legs).toEqual([{ to: "b", amount: 250000n }, { to: "treasury", amount: 250000n }]);
    expect(r2.qtrA).toBe(0); expect(r2.qtrB).toBe(25);
  });

  it("tie is a draw: both refunded, both +25 QTR, treasury gets nothing", () => {
    const r = settleOutcome({ scoreA: 200, scoreB: 200, finishedA: true, finishedB: true });
    expect(r.kind).toBe("draw"); expect(r.winner).toBeNull();
    expect(r.legs).toEqual([{ to: "a", amount: 250000n }, { to: "b", amount: 250000n }]);
    expect(r.qtrA).toBe(25); expect(r.qtrB).toBe(25);
  });

  it("unfinished player forfeits: finisher wins on win terms", () => {
    const r = settleOutcome({ scoreA: 50, scoreB: null, finishedA: true, finishedB: false });
    expect(r.kind).toBe("forfeit"); expect(r.winner).toBe("a");
    expect(r.legs).toEqual([{ to: "a", amount: 250000n }, { to: "treasury", amount: 250000n }]);
    expect(r.qtrA).toBe(25); expect(r.qtrB).toBe(0);
    const r2 = settleOutcome({ scoreA: null, scoreB: 50, finishedA: false, finishedB: true });
    expect(r2.kind).toBe("forfeit"); expect(r2.winner).toBe("b");
    expect(r2.qtrB).toBe(25); expect(r2.qtrA).toBe(0);
  });

  it("neither finished is void: both refunded, no QTR, no treasury", () => {
    const r = settleOutcome({ scoreA: null, scoreB: null, finishedA: false, finishedB: false });
    expect(r.kind).toBe("void"); expect(r.winner).toBeNull();
    expect(r.legs).toEqual([{ to: "a", amount: 250000n }, { to: "b", amount: 250000n }]);
    expect(r.qtrA).toBe(0); expect(r.qtrB).toBe(0);
  });

  it("expired (unjoined) refunds the lone stake to the creator, no QTR", () => {
    const p = expiredPayout();
    expect(p.legs).toEqual([{ to: "a", amount: 250000n }]);
    expect(p.qtrA).toBe(0); expect(p.qtrB).toBe(0);
  });

  it("conservation: 500000 in = 500000 out in EVERY two-player outcome", () => {
    const cases = [
      { scoreA: 1, scoreB: 0, finishedA: true, finishedB: true },
      { scoreA: 0, scoreB: 1, finishedA: true, finishedB: true },
      { scoreA: 0, scoreB: 0, finishedA: true, finishedB: true },
      { scoreA: 7, scoreB: null, finishedA: true, finishedB: false },
      { scoreA: null, scoreB: 7, finishedA: false, finishedB: true },
      { scoreA: null, scoreB: null, finishedA: false, finishedB: false },
    ];
    for (const c of cases) {
      const r = settleOutcome(c);
      expect(sum(r.legs)).toBe(500000n);
      // refund legs always precede the treasury leg (settlement resumes by count)
      const kinds = r.legs.map((l) => l.to);
      const tIdx = kinds.indexOf("treasury");
      if (tIdx >= 0) expect(tIdx).toBe(kinds.length - 1);
    }
    expect(sum(expiredPayout().legs)).toBe(250000n);
  });
});
