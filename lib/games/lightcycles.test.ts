import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { LightCyclesGame, LC_W, LC_H, type LightCyclesState } from "./lightcycles";
// Virtual clock: the engine advances by wall-clock ticks, so tests drive time.
function rig(seed = 42) {
  let t = 0;
  const game = new LightCyclesGame(() => t, seed);
  return { game, advance: (ms: number) => { t += ms; } };
}
const DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } } as const;
// Survival bot for the derez hunt: flood-fill the free space behind every legal
// next cell and steer into the largest region (deterministic given the state).
function flood(blocked: Set<number>, sx: number, sy: number): number {
  const seen = new Set([sy * LC_W + sx]);
  const stack = [[sx, sy]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const d of Object.values(DIRS)) {
      const nx = x + d.x, ny = y + d.y, i = ny * LC_W + nx;
      if (nx < 0 || nx >= LC_W || ny < 0 || ny >= LC_H || blocked.has(i) || seen.has(i)) continue;
      seen.add(i); stack.push([nx, ny]);
    }
  }
  return seen.size;
}
function botStep(game: LightCyclesGame, prev: { x: number; y: number }): { x: number; y: number } {
  const s = game.state();
  let cur = { x: s.you.x - prev.x, y: s.you.y - prev.y };
  if (cur.x === 0 && cur.y === 0) cur = { x: 1, y: 0 };
  const blocked = new Set([...s.trailYou, ...s.trailRival]);
  let bestName: string | null = null; let bestCount = -1;
  for (const [name, d] of Object.entries(DIRS)) {
    if (d.x === -cur.x && d.y === -cur.y) continue; // no 180-degree turns
    const nx = s.you.x + d.x, ny = s.you.y + d.y;
    if (nx < 0 || nx >= LC_W || ny < 0 || ny >= LC_H || blocked.has(ny * LC_W + nx)) continue;
    const c = flood(blocked, nx, ny);
    if (c > bestCount) { bestCount = c; bestName = name; }
  }
  if (bestName) game.act(bestName);
  return { ...s.you };
}
function expectConsistent(s: LightCyclesState) {
  // Score is exactly the survived ticks plus 100 per derez, and the agent's
  // trail grows by exactly one cell per survived tick (plus its start cell).
  expect(s.score).toBe(s.tick + 100 * s.derezzed);
  expect(s.trailYou.length - 1).toBe(s.score - 100 * s.derezzed);
  expect(new Set(s.trailYou).size).toBe(s.trailYou.length);
  for (const i of s.trailYou) { expect(i).toBeGreaterThanOrEqual(0); expect(i).toBeLessThan(LC_W * LC_H); }
}
describe("light cycles engine", () => {
  it("starts both cycles mid-grid facing each other, trails at the start cells", () => {
    const { game } = rig();
    const s = game.state();
    expect(s.you).toEqual({ x: 8, y: 15 });
    expect(s.rival).toEqual({ x: 31, y: 15 });
    expect(s.trailYou).toEqual([15 * LC_W + 8]);
    expect(s.trailRival).toEqual([15 * LC_W + 31]);
    expect(s.score).toBe(0); expect(s.derezzed).toBe(0); expect(s.tickMs).toBe(120);
  });
  it("publishes a seed commitment from frame one and reveals the seed", () => {
    const { game } = rig(4242);
    expect(game.state().seedCommit).toBe(createHash("sha256").update("coinop-lightcycles-seed:4242").digest("hex"));
    expect(game.revealSeed()).toBe("4242");
  });
  it("moves one cell per 120ms tick and scores +1 per tick survived", () => {
    const { game, advance } = rig();
    game.act("up"); // turn away from the head-on course with the rival
    advance(120 * 5);
    const s = game.state();
    expect(s.you).toEqual({ x: 8, y: 10 });
    expect(s.tick).toBe(5); expect(s.score).toBe(5);
    expect(s.trailYou.length).toBe(6);
  });
  it("steers with actions and refuses 180-degree turns", () => {
    const { game, advance } = rig();
    game.act("up"); advance(120);
    expect(game.state().you).toEqual({ x: 8, y: 14 });
    game.act("down"); advance(120); // reverse of up — must be ignored
    expect(game.state().you).toEqual({ x: 8, y: 13 });
  });
  it("is deterministic: same seed + same steering = same state", () => {
    const run = () => {
      const { game, advance } = rig(42);
      let prev = { x: 8, y: 15 };
      for (let i = 0; i < 150; i++) {
        if (game.state().status === "over") break;
        prev = botStep(game, prev);
        advance(game.state().tickMs);
      }
      return game.state();
    };
    expect(run()).toEqual(run());
  });
  it("dies on the wall with overReason 'crashed'", () => {
    const { game, advance } = rig();
    game.act("up");
    advance(120 * 20); // head starts y=15 moving up; wall at y=0
    const s = game.state();
    expect(s.status).toBe("over"); expect(s.overReason).toBe("crashed");
    expect(game.isOver).toBe(true);
    expect(game.finalScore).toBe(s.score);
  });
  it("rejects unknown actions", () => {
    const { game } = rig();
    expect(() => game.act("boost")).toThrow("unknown_action");
  });
  it("rival derez: +100, derezzed=1, rival trail wiped, tick speeds up (seed 6)", () => {
    const { game, advance } = rig(6);
    let prev = { x: 8, y: 15 };
    let s = game.state();
    for (let i = 0; i < 20000 && s.derezzed < 1 && s.status !== "over"; i++) {
      prev = botStep(game, prev);
      advance(game.state().tickMs);
      s = game.state();
    }
    expect(s.status).toBe("playing");
    expect(s.derezzed).toBe(1);
    expect(s.tick).toBe(339);
    expect(s.score).toBe(439); // 339 survival ticks + 100 derez bonus
    expect(s.tickMs).toBe(110); // 120 - 10 per derez
    expect(s.rival).not.toBeNull();
    expect(s.trailRival.length).toBe(1); // wiped — only the respawn cell remains
    expectConsistent(s);
  });
});
