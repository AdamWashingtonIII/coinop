import { describe, it, expect } from "vitest";
process.env.COINOP_DB_DIR = "memory://"; // in-memory PGlite: no disk, isolated per test file
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { accruePlayReward, availableToClaim } from "./rewards";
import { issueClaimNonce, submitClaim, listClaims, processClaims } from "./claims";
const account = privateKeyToAccount(generatePrivateKey());
const W = account.address;
describe("QTR claims (automated claim flow)", () => {
  it("nonce -> signature -> queued claim for the full claimable balance", async () => {
    await accruePlayReward(W, "sid-claim-1");
    expect(await availableToClaim(W)).toBe(25);
    const { nonce, message } = await issueClaimNonce(W);
    const signature = await account.signMessage({ message });
    const claim = await submitClaim(W, nonce, signature);
    expect(claim.amount).toBe(25); expect(claim.status).toBe("queued");
    expect(await availableToClaim(W)).toBe(0); // reserved by the queued claim
    const list = await listClaims(W);
    expect(list).toHaveLength(1); expect(list[0].id).toBe(claim.id);
  });
  it("a second claim with nothing left is refused", async () => {
    const { nonce, message } = await issueClaimNonce(W);
    const signature = await account.signMessage({ message });
    await expect(submitClaim(W, nonce, signature)).rejects.toThrow("nothing_to_claim");
  });
  it("nonces are single-use and signatures are checked", async () => {
    await accruePlayReward(W, "sid-claim-2");
    const { nonce, message } = await issueClaimNonce(W);
    const bad = await privateKeyToAccount(generatePrivateKey()).signMessage({ message });
    await expect(submitClaim(W, nonce, bad)).rejects.toThrow("bad_signature");
    const good = await account.signMessage({ message });
    const claim = await submitClaim(W, nonce, good);
    expect(claim.amount).toBe(25);
    await expect(submitClaim(W, nonce, good)).rejects.toThrow("bad_nonce"); // replayed nonce
  });
  it("processor reports cleanly when no minter is configured", async () => {
    const r = await processClaims();
    expect(r.minted).toHaveLength(0);
    expect(r.note).toBe("minter_not_configured");
  });
});
