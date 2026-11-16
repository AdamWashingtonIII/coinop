import { describe, it, expect } from "vitest";
import { SnakeGame } from "./snake";
// Virtual clock: the engine advances by wall-clock ticks, so tests drive time.
function rig(seed = 42) {
  let t = 0;
  const game = new SnakeGame(() => t, seed);
  return { game, advance: (ms: number) => { t += ms; } };
}
describe("snake engine (frozen catalog rules)", () => {
  it("starts length 3 moving right, one cell per 200ms tick", () => {
    const { game, advance } = rig();
    const s0 = game.state();
    expect(s0.length).toBe(3); expect(s0.segments[0]).toEqual({ x: 10, y: 10 });
    advance(200);
    expect(game.state().segments[0]).toEqual({ x: 11, y: 10 });
  });
  it("steers with actions and refuses 180-degree turns", () => {
    const { game, advance } = rig();
    game.act("up"); advance(200);
    expect(game.state().segments[0]).toEqual({ x: 10, y: 9 });
    game.act("down"); advance(200); // reverse of up — must be ignored
    expect(game.state().segments[0]).toEqual({ x: 10, y: 8 });
  });
  it("dies on the wall", () => {
    const { game, advance } = rig();
    advance(200 * 12); // head starts x=10 moving right; wall at x=20
    const s = game.state();
    expect(s.status).toBe("over"); expect(s.overReason).toBe("hit_wall");
    expect(game.isOver).toBe(true);
  });
  it("rejects unknown actions", () => {
    const { game } = rig();
    expect(() => game.act("drop")).toThrow("unknown_action");
  });
  it("eating an orb scores +10 and grows by one (seeded orb hunt)", () => {
    const { game, advance } = rig(7);
    // Greedy hunt: steer toward the orb each tick using only legal turns.
    for (let i = 0; i < 400; i++) {
      const s = game.state();
      if (s.status === "over") break;
      if (!s.orb) break;
      const head = s.segments[0];
      const dx = s.orb.x - head.x, dy = s.orb.y - head.y;
      const cur = { x: s.segments[0].x - s.segments[1].x, y: s.segments[0].y - s.segments[1].y };
      let want: string | null = null;
      if (dx > 0 && cur.x !== -1) want = "right"; else if (dx < 0 && cur.x !== 1) want = "left";
      else if (dy > 0 && cur.y !== -1) want = "down"; else if (dy < 0 && cur.y !== 1) want = "up";
      if (want) game.act(want);
      advance(s.tickMs);
      const after = game.state();
      if (after.score >= 10) { expect(after.length).toBe(4); return; }
    }
    throw new Error("bot never reached the orb in 400 ticks");
  });
});
