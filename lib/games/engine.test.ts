import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { rulesetHash, createEngine } from "./engine";
import { SnakeGame } from "./snake";
describe("fairness + ruleset pinning (adopted from the DeepSeek review)", () => {
  it("rulesetHash is stable per game and differs across games", () => {
    expect(rulesetHash("snake")).toBe(rulesetHash("snake"));
    expect(rulesetHash("snake")).not.toBe(rulesetHash("stacker"));
    expect(rulesetHash("snake")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("snake publishes a seed commitment from frame one but never the seed mid-run", () => {
    let t = 0;
    const g = new SnakeGame(() => t, 4242);
    const st = g.state();
    expect(st.seedCommit).toBe(createHash("sha256").update("coinop-snake-seed:4242").digest("hex"));
    expect(JSON.stringify(st)).not.toContain("4242");
    expect(g.revealSeed()).toBe("4242"); // revealed into the replay record at game over
  });
  it("every live engine satisfies the shared contract", () => {
    for (const slug of ["stacker", "snake", "breaker", "thermonuclear", "tictactoe", "lightcycles", "battleship", "chess", "checkers", "go"]) {
      const e = createEngine(slug);
      expect(e).not.toBeNull();
      expect(e!.state().slug).toBe(slug);
      expect(Array.isArray(e!.snapshots())).toBe(true);
    }
  });
});
