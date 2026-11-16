import { describe, it, expect } from "vitest";
import { BreakerGame } from "./breaker";
function rig() {
  let t = 0;
  const game = new BreakerGame(() => t);
  return { game, advance: (ms: number) => { t += ms; } };
}
describe("breaker engine (frozen catalog rules)", () => {
  it("starts with a full 5x10 wall, 3 balls, paddle centered", () => {
    const { game } = rig();
    const s = game.state();
    expect(s.bricks).toEqual([1023, 1023, 1023, 1023, 1023]);
    expect(s.ballsLeft).toBe(3); expect(s.paddle).toEqual({ start: 7, width: 5 });
    expect(s.score).toBe(0);
  });
  it("paddle moves one cell per action and clamps at the walls", () => {
    const { game } = rig();
    game.act("left"); expect(game.state().paddle.start).toBe(6);
    for (let i = 0; i < 10; i++) game.act("left");
    expect(game.state().paddle.start).toBe(0);
    for (let i = 0; i < 30; i++) game.act("right");
    expect(game.state().paddle.start).toBe(15);
  });
  it("rejects unknown actions", () => {
    const { game } = rig();
    expect(() => game.act("drop")).toThrow("unknown_action");
  });
  it("the ball breaks bricks and scores (bot follows the ball)", () => {
    const { game, advance } = rig();
    for (let i = 0; i < 3000; i++) {
      const s = game.state();
      if (s.status === "over") break;
      const center = s.paddle.start + s.paddle.width / 2;
      if (s.ball.x < center - 0.5) game.act("left");
      else if (s.ball.x > center + 0.5) game.act("right");
      advance(100);
      if (game.state().score > 0) { expect(game.state().score).toBeGreaterThan(0); return; }
    }
    throw new Error("no brick broken in 3000 ticks");
  });
  it("losing all 3 balls ends the run (paddle parked in a corner)", () => {
    const { game, advance } = rig();
    for (let i = 0; i < 20; i++) game.act("left"); // park paddle at x=0
    advance(100 * 60 * 10); // up to 10 virtual minutes
    const s = game.state();
    expect(s.status).toBe("over"); expect(s.overReason).toBe("out_of_balls");
    expect(game.finalScore).toBe(s.score);
  });
});
