import { describe, it, expect } from "vitest";
process.env.COINOP_DB_DIR = "memory://"; // in-memory PGlite: no disk, isolated per test file
import { accruePlayReward, rewardBalance, flagReward, TOKENS_PER_PLAY } from "./rewards";
const W = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
describe("token rewards (ADR 0004)", () => {
  it("rate is exactly 25 tokens per play", () => { expect(TOKENS_PER_PLAY).toBe(25); });
  it("accrues per paid play and sums by wallet", async () => {
    await accruePlayReward(W, "sid-1"); await accruePlayReward(W, "sid-2");
    expect(await rewardBalance(W)).toBe(50);
    expect(await rewardBalance(W.toLowerCase())).toBe(50); // case-insensitive wallet match
  });
  it("flagged rewards (unpaid play) do not count toward balance", async () => {
    await accruePlayReward(W, "sid-3"); await flagReward("sid-3");
    expect(await rewardBalance(W)).toBe(50);
  });
});
