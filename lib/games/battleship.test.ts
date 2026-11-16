import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { BattleshipGame, type BattleshipState } from "./battleship";

const count = (s: string, ch: string) => s.split("").filter((c) => c === ch).length;
// The score, rebuilt from nothing but what the state exposes — if the engine's
// score ever disagrees with the public record, this catches it.
function expectedScore(st: BattleshipState): number {
  const hits = count(st.yourShots, "x") + count(st.yourShots, "#");
  const sinks = 5 - st.enemyAfloat.length;
  let total = hits * 10 + sinks * 25;
  if (st.outcome === "victory") total += 50 + 2 * count(st.yourFleet, "s");
  return total;
}
function sweep(seed: number): BattleshipGame {
  const g = new BattleshipGame(() => 0, seed);
  for (let cell = 0; cell < 100 && !g.isOver; cell++) g.act("fire_" + cell);
  return g;
}

describe("fleet battle (battleship)", () => {
  it("publishes a seed commitment and never leaks the seed in the opening state", () => {
    const g = new BattleshipGame(() => 0, 4242);
    const st = g.state();
    expect(st.seedCommit).toBe(createHash("sha256").update("coinop-battleship-seed:4242").digest("hex"));
    expect(JSON.stringify(st)).not.toContain("4242");
    expect(g.revealSeed()).toBe("4242");
  });

  it("is deterministic: same seed + same shots = identical game", () => {
    const play = () => {
      const g = new BattleshipGame(() => 0, 42);
      const seen: string[] = [];
      for (let cell = 0; cell < 100 && !g.isOver; cell += 6) seen.push(JSON.stringify(g.act("fire_" + cell)));
      return { seen, snaps: g.snapshots().length, score: g.finalScore };
    };
    expect(play()).toEqual(play());
  });

  it("secrecy: the opening state exposes no house ship positions", () => {
    const st = new BattleshipGame(() => 0, 9).state();
    expect(st.yourShots).toBe(".".repeat(100));
    expect(Object.keys(st).sort()).toEqual(
      ["enemyAfloat", "lastEvents", "score", "seedCommit", "shotsFired", "slug", "status", "yourAfloat", "yourFleet", "yourShots"].sort());
    // Your own fleet is fully visible: 5+4+3+3+2 = 17 intact cells.
    expect(count(st.yourFleet, "s")).toBe(17);
    expect(st.enemyAfloat).toEqual([5, 4, 3, 3, 2]);
    expect(st.yourAfloat).toEqual([5, 4, 3, 3, 2]);
  });

  it("secrecy: yourShots marks exactly the cells fired at, nothing more", () => {
    const g = new BattleshipGame(() => 0, 31);
    const fired = [0, 5, 23, 47, 99];
    for (const c of fired) g.act("fire_" + c);
    const st = g.state();
    expect(st.shotsFired).toBe(fired.length);
    st.yourShots.split("").forEach((ch, i) => {
      if (ch !== ".") expect(fired).toContain(i);
    });
    expect(count(st.yourShots, ".")).toBe(100 - fired.length);
  });

  it("secrecy: different seeds hide different fleets behind the same opening shot", () => {
    const marks = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      marks.add(new BattleshipGame(() => 0, seed).act("fire_0").yourShots[0]);
    }
    expect(marks.size).toBeGreaterThanOrEqual(2); // a mix of hits and misses across seeds
  });

  it("scoring on probed seeds: a first-shot hit pays +10, a miss pays 0", () => {
    let hitSeen = false, missSeen = false;
    for (let seed = 1; seed <= 100 && !(hitSeen && missSeen); seed++) {
      const st = new BattleshipGame(() => 0, seed).act("fire_0");
      if (st.yourShots[0] === "x" && !hitSeen) {
        hitSeen = true;
        expect(st.score).toBe(10);
        expect(st.lastEvents[0]).toBe("YOU HIT");
      }
      if (st.yourShots[0] === "o" && !missSeen) {
        missSeen = true;
        expect(st.score).toBe(0);
        expect(st.lastEvents[0]).toBe("YOU MISS");
      }
    }
    expect(hitSeen && missSeen).toBe(true);
  });

  it("the house never repeats a target cell across a full game", () => {
    const g = new BattleshipGame(() => 0, 77);
    let prevMarks = 0, redHitEvents = 0;
    for (let cell = 0; cell < 100 && !g.isOver; cell++) {
      const st = g.act("fire_" + cell);
      const marks = count(st.yourFleet, "x") + count(st.yourFleet, "#");
      expect(marks - prevMarks).toBeLessThanOrEqual(1); // at most one new marked cell per house shot
      if (st.lastEvents.some((e) => e.startsWith("RED HIT") || e.startsWith("RED SANK"))) redHitEvents++;
      prevMarks = marks;
    }
    expect(g.isOver).toBe(true);
    // Every house hit/sink event produced exactly one newly marked cell — a
    // repeated shot at a known cell could not satisfy both counts at once.
    expect(redHitEvents).toBe(prevMarks);
  });

  it("a sweep game always ends, and the score matches the public record", () => {
    for (const seed of [7, 123, 2026]) {
      const g = sweep(seed);
      const st = g.state();
      expect(g.isOver).toBe(true);
      expect(["victory", "defeat"]).toContain(st.outcome);
      if (st.outcome === "victory") expect(st.enemyAfloat).toEqual([]);
      if (st.outcome === "defeat") expect(st.yourAfloat).toEqual([]);
      expect(st.shotsFired).toBeLessThanOrEqual(100);
      expect(g.finalScore).toBe(expectedScore(st));
      expect(g.snapshots().length).toBe(st.shotsFired + 1); // one per shot, plus the opening frame
    }
  });

  it("rejects repeat shots, shots after the end, and unknown actions", () => {
    const g = new BattleshipGame(() => 0, 5);
    g.act("fire_5");
    expect(() => g.act("fire_5")).toThrow("illegal_move");
    expect(() => g.act("fire_100")).toThrow("unknown_action");
    expect(() => g.act("torpedo_5")).toThrow("unknown_action");
    const done = sweep(5);
    expect(() => done.act("fire_0")).toThrow("illegal_move");
  });
});
