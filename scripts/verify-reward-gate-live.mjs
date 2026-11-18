// ADR 0021 reward-gate LIVE proof (Base MAINNET, production):
//  coin 1: pay 0.25 USDC, play Stacker to a recorded score -> +25 QTR released exactly once.
//  coin 2: pay 0.25 USDC, never play -> reward stays pending, claimable unchanged.
// Run: node --env-file=.env.local scripts/verify-reward-gate-live.mjs
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, formatUnits } from "viem";
import { base } from "viem/chains";
import { randomBytes } from "crypto";

const BASE = "https://coinop-one.vercel.app";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TREASURY = "0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7";
const account = privateKeyToAccount(process.env.AGENT_TEST_PRIVATE_KEY);
const pub = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const usdcAbi = [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];
const usdc = async (a) => Number(formatUnits(await pub.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [a] }), 6));
const rewards = async () => (await fetch(BASE + "/api/rewards?wallet=" + account.address)).json();
const pendings = (r) => (r.entries ?? []).filter((e) => e.reason === "play_reward_pending").length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function coinIn() {
  const first = await fetch(BASE + "/api/coin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gameSlug: "stacker" }) });
  const b = await first.json().catch(() => ({}));
  const a0 = b.accepts?.[0] ?? {};
  if (first.status !== 402 || String(a0.amount ?? a0.maxAmountRequired) !== "250000" || a0.payTo !== TREASURY || a0.asset !== USDC) {
    throw new Error("402 requirements mismatch: " + JSON.stringify(b).slice(0, 200));
  }
  const now = Math.floor(Date.now() / 1000);
  const authorization = { from: account.address, to: TREASURY, value: "250000", validAfter: String(now - 600), validBefore: String(now + 3600), nonce: "0x" + randomBytes(32).toString("hex") };
  const signature = await account.signTypedData({
    domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: USDC },
    types: { TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
    primaryType: "TransferWithAuthorization",
    message: { from: authorization.from, to: authorization.to, value: 250000n, validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore), nonce: authorization.nonce },
  });
  for (const network of ["eip155:8453", "base"]) {
    const payload = { x402Version: 1, scheme: "exact", network, payload: { signature, authorization } };
    const res = await fetch(BASE + "/api/coin", { method: "POST", headers: { "content-type": "application/json", "x-payment": Buffer.from(JSON.stringify(payload)).toString("base64") }, body: JSON.stringify({ gameSlug: "stacker" }) });
    const j = await res.json().catch(() => ({}));
    if (j.sessionToken) { console.log("  coin-in ok | reward state:", JSON.stringify(j.reward ?? j.tokens ?? "n/a")); return j; }
    console.log("  attempt", network, "->", res.status, (j.error ?? "").slice(0, 120));
  }
  throw new Error("coin-in payment failed");
}

console.log("agent:", account.address, "| USDC:", await usdc(account.address));
const r0 = await rewards();
console.log("BEFORE  accrued:", r0.tokensAccrued, "| claimable:", r0.tokensClaimable, "| pending entries:", pendings(r0));

// ---- coin 1: play to a recorded score ----
console.log("COIN 1: paying + playing stacker...");
const c1 = await coinIn();
let token = c1.sessionToken;
let lastBeat = Date.now();
const H = () => ({ authorization: "Bearer " + token, "content-type": "application/json" });
let drops = 0, finalScore = null;
for (let i = 0; i < 900; i++) {
  if (Date.now() - lastBeat > 20000) {
    const hb = await fetch(BASE + "/api/coin/heartbeat", { method: "POST", headers: H() }).then((r) => r.json()).catch(() => ({}));
    if (hb.sessionToken) token = hb.sessionToken;
    lastBeat = Date.now();
  }
  const s = await (await fetch(BASE + "/api/play/state", { headers: H() })).json();
  const st = s.state;
  if (!st || st.status === "over") { finalScore = st?.score; console.log("  game over | score:", st?.score, "| rows:", st?.level, "| reason:", st?.overReason); break; }
  const target = st.spans.length ? st.spans[st.spans.length - 1] : { start: 0, end: 10 };
  const overlap = Math.max(0, Math.min(st.moving.end, target.end) - Math.max(st.moving.start, target.start));
  // play decently for a few rows, then deliberately miss to end the game fast
  if (drops >= 4 || overlap === (st.moving.end - st.moving.start)) {
    await fetch(BASE + "/api/play/action", { method: "POST", headers: H(), body: JSON.stringify({ action: "drop" }) });
    drops++;
    if (drops > 4) { /* next polls: drop immediately regardless of overlap -> miss ends game */ }
  }
  if (drops > 4) {
    await fetch(BASE + "/api/play/action", { method: "POST", headers: H(), body: JSON.stringify({ action: "drop" }) }).catch(() => {});
  }
  await sleep(60);
}
console.log("  drops:", drops, "| final score:", finalScore);
let r1 = await rewards();
for (let i = 0; i < 6 && (r1.tokensClaimable ?? 0) - (r0.tokensClaimable ?? 0) !== 25; i++) { await sleep(5000); r1 = await rewards(); }
console.log("AFTER PLAY  accrued:", r1.tokensAccrued, "| claimable:", r1.tokensClaimable, "| pending entries:", pendings(r1));
const dClaim1 = (r1.tokensClaimable ?? 0) - (r0.tokensClaimable ?? 0);
console.log(dClaim1 === 25 ? "PASS — played coin released exactly +25 QTR (once)" : "FAIL — claimable delta after play = " + dClaim1);

// ---- coin 2: pay, never play ----
console.log("COIN 2: paying, NOT playing...");
const c2 = await coinIn();
console.log("  session issued:", !!c2.sessionToken, "(left unplayed)");
await sleep(8000);
const r2 = await rewards();
console.log("AFTER IDLE COIN  accrued:", r2.tokensAccrued, "| claimable:", r2.tokensClaimable, "| pending entries:", pendings(r2));
const dClaim2 = (r2.tokensClaimable ?? 0) - (r1.tokensClaimable ?? 0);
console.log(dClaim2 === 0 && pendings(r2) === pendings(r1) + 1
  ? "PASS — unplayed coin's 25 QTR still pending, claimable unchanged"
  : "CHECK — claimable delta = " + dClaim2 + ", pending delta = " + (pendings(r2) - pendings(r1)));
console.log("agent USDC after:", await usdc(account.address));
