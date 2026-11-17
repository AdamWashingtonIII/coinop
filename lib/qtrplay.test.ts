import { describe, it, expect } from "vitest";
process.env.COINOP_DB_DIR = "memory://";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { issueQtrNonce, spendQtrForPlay, QTR_PLAY_PRICE } from "./qtrplay";
import { accruePlayReward, rewardBalance } from "./rewards";

const acct = privateKeyToAccount(generatePrivateKey());
const W = acct.address;
async function signedSpend(sid: string) {
  const n = await issueQtrNonce(W);
  const signature = await acct.signMessage({ message: n.message });
  return spendQtrForPlay(W, n.nonce, signature, sid);
}

describe("pay with QTR (ADR 0016)", () => {
  it("price is 50 QTR", () => { expect(QTR_PLAY_PRICE).toBe(50); });
  it("a signed spend debits 50 from the claimable balance", async () => {
    await accruePlayReward(W, "seed-1"); await accruePlayReward(W, "seed-2"); await accruePlayReward(W, "seed-3");
    expect(await rewardBalance(W)).toBe(75);
    expect(await signedSpend("sid-q1")).toBe("ok");
    expect(await rewardBalance(W)).toBe(25);
  });
  it("insufficient balance is refused without debiting", async () => {
    expect(await signedSpend("sid-q2")).toBe("insufficient");
    expect(await rewardBalance(W)).toBe(25);
  });
  it("a bad signature is refused, and the nonce is burned either way", async () => {
    const n = await issueQtrNonce(W);
    const bad = await privateKeyToAccount(generatePrivateKey()).signMessage({ message: n.message });
    expect(await spendQtrForPlay(W, n.nonce, bad, "sid-q3")).toBe("signature_invalid");
    const good = await acct.signMessage({ message: n.message });
    expect(await spendQtrForPlay(W, n.nonce, good, "sid-q3")).toBe("nonce_invalid"); // single-use
  });
  it("two racing spends cannot both take the same 50 QTR", async () => {
    await accruePlayReward(W, "seed-4"); // balance back to exactly 50
    const [a, b] = await Promise.all([signedSpend("sid-r1"), signedSpend("sid-r2")]);
    expect([a, b].filter((r) => r === "ok")).toHaveLength(1);
    expect(await rewardBalance(W)).toBe(0);
  });
});
