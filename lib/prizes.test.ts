import { describe, it, expect } from "vitest";
process.env.COINOP_DB_DIR = "memory://";
import { weekWindow, weekWindowByKey, rakeAccrue, rakeReverse, poolBalanceMicro,
  recordSeed, weekStandings, weekPayoutsDue, isHouseWallet, RAKE_MICRO } from "./prizes";
import { getDb, schema } from "./db";
const EXT = "0x1111111111111111111111111111111111111111"; // an outside wallet
const HOUSE = "0x2D3f3F16EF47a8345D65b277217B5B6Dcb2386ff"; // the test agent

describe("week math (ADR 0016)", () => {
  it("Tue Nov 17 2026 ET belongs to the week of Mon Nov 16, 05:00Z to Mon Nov 23, 05:00Z (EST)", () => {
    const w = weekWindow(new Date("2026-11-17T11:49:00Z"));
    expect(w.weekKey).toBe("2026-11-16");
    expect(w.start.toISOString()).toBe("2026-11-16T05:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-23T05:00:00.000Z");
  });
  it("a Sunday night ET is still the same week; Monday 00:30 ET is the next", () => {
    expect(weekWindow(new Date("2026-11-23T04:30:00Z")).weekKey).toBe("2026-11-16"); // Sun 23:30 ET
    expect(weekWindow(new Date("2026-11-23T05:30:00Z")).weekKey).toBe("2026-11-23"); // Mon 00:30 ET
  });
  it("weekWindowByKey round-trips and handles the spring DST change", () => {
    const w = weekWindowByKey("2027-03-08"); // DST starts Sun Mar 14 2027
    expect(w.start.toISOString()).toBe("2027-03-08T05:00:00.000Z"); // EST
    expect(w.end.toISOString()).toBe("2027-03-15T04:00:00.000Z"); // EDT
  });
});

describe("pool ledger", () => {
  it("rake accrues $0.05 and a reversal takes it back", async () => {
    await rakeAccrue("sid-a");
    expect(await poolBalanceMicro()).toBe(RAKE_MICRO);
    await rakeReverse("sid-a");
    expect(await poolBalanceMicro()).toBe(0);
  });
  it("seed adds to the pool", async () => {
    await recordSeed("0x" + "ab".repeat(32), 25_000_000);
    expect(await poolBalanceMicro()).toBe(25_000_000);
  });
});

describe("winners", () => {
  it("house wallets never lead; the best outside verified score does", async () => {
    const db = await getDb();
    const win = weekWindow();
    const at = new Date(win.start.getTime() + 60_000);
    const rows = [
      { id: "s1", gameSlug: "snake", wallet: HOUSE, value: 999, verified: true, sessionId: "x1", createdAt: at },
      { id: "s2", gameSlug: "snake", wallet: EXT, value: 120, verified: true, sessionId: "x2", createdAt: at },
      { id: "s3", gameSlug: "snake", wallet: EXT, value: 80, verified: true, sessionId: "x3", createdAt: at },
      { id: "s4", gameSlug: "snake", wallet: "0x2222222222222222222222222222222222222222", value: 500, verified: false, sessionId: "x4", createdAt: at },
    ];
    for (const r of rows) await db.insert(schema.scores).values(r);
    const standings = await weekStandings(win);
    const snake = standings.find((s) => s.gameSlug === "snake")!;
    expect(snake.leader?.wallet).toBe(EXT);
    expect(snake.leader?.value).toBe(120);
    expect(isHouseWallet(HOUSE)).toBe(true);
    expect(isHouseWallet(EXT)).toBe(false);
  });
  it("payouts due: equal shares to weekly leaders, only above the minimum", async () => {
    const due = await weekPayoutsDue(weekWindow().weekKey);
    // pool is 25,000,000 micro over 11 cabinets -> share 2,272,727 >= 250,000
    expect(due).toEqual([{ wallet: EXT, gameSlug: "snake", amountMicro: 2_272_727 }]);
  });
});
