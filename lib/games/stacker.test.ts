import { describe, it, expect } from "vitest";
import { StackerGame, GRID_H } from "./stacker";
describe("stacker engine (server-authoritative)", () => {
  it("starts sliding with a width-3 block and score 0", () => {
    const g = new StackerGame(() => 0);
    const s = g.state();
    expect(s.status).toBe("playing"); expect(s.score).toBe(0);
    expect(s.moving.end - s.moving.start).toBe(3);
  });
  it("dropping at tick 0 lands a full-width row on the base", () => {
    const g = new StackerGame(() => 0);
    const s = g.drop();
    expect(s.spans).toEqual([{ start: 0, end: 3 }]); expect(s.score).toBeGreaterThan(0);
  });
  it("a total miss ends the game", () => {
    let t = 0; const g = new StackerGame(() => t);
    g.drop(); // row at [0,3)
    t = 250 * 5; // next block (width 3) now starts at 5 -> no overlap with [0,3)
    const s = g.drop();
    expect(s.status).toBe("over"); expect(s.overReason).toBe("missed_the_tower");
  });
  it("score is owned by the server state, not the client", () => {
    const g = new StackerGame(() => 0);
    g.drop(); const s = g.state();
    expect(s.score).toBe(31); // 3*10 + row bonus 1
  });
});
