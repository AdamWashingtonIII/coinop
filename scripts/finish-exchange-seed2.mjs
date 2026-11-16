// Exchange seed, part 2: production-proof the auto-verify path on a TURN-BASED
// cabinet. (Snake is real-time; under serverless instance scatter the steering
// loop cannot keep up with the tick clock, so the snake seed tasks stay on the
// board as standing challenges instead.) Thermonuclear War: a turn-1
// stand_down ends the game at a flat 45 — deterministic, one action.
// Run: node --env-file=.env.local scripts/finish-exchange-seed2.mjs
import { randomBytes } from "crypto";
import { privateKeyToAccount } from "viem/accounts";

const BASE = process.env.COINOP_BASE ?? "https://coinop-one.vercel.app";
const TREASURY = "0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const poster = privateKeyToAccount(process.env.AGENT_TEST_PRIVATE_KEY);
const worker = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = { "content-type": "application/json" };

async function api(path, opts = {}) {
  const r = await fetch(BASE + path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${j.error ?? JSON.stringify(j).slice(0, 160)}`);
  return j;
}
async function signed(account, path, body = {}) {
  const n = await api("/api/tasks/nonce?wallet=" + account.address);
  const signature = await account.signMessage({ message: n.message });
  return api(path, { method: "POST", headers: J, body: JSON.stringify({ wallet: account.address, nonce: n.nonce, signature, ...body }) });
}

const TITLE = "The only winning move: stand down";
const existing = (await api("/api/tasks")).tasks ?? [];
let task = existing.find((t) => t.title === TITLE);
if (!task) {
  const out = await signed(poster, "/api/tasks", { type: "arcade_score",
    title: TITLE, description: "Thermonuclear War: choose peace on turn one — stand down before any launch and finish with the peacemaker's 45. The server checks its own record and pays instantly.",
    bounty: 25, deadlineHours: 72, spec: { gameSlug: "thermonuclear", minScore: 45 } });
  task = out.task;
  console.log("posted A2:", task.id);
}
if (task.status === "open") { await signed(worker, `/api/tasks/${task.id}/claim`); console.log("claimed A2"); }
if (task.status === "settled") { console.log("A2 already settled"); process.exit(0); }

// --- paid thermonuclear play: one stand_down ---
const first = await fetch(BASE + "/api/coin", { method: "POST", headers: J, body: JSON.stringify({ gameSlug: "thermonuclear" }) });
if (first.status !== 402) throw new Error("expected 402, got " + first.status);
const now = Math.floor(Date.now() / 1000);
const authorization = { from: worker.address, to: TREASURY, value: "250000",
  validAfter: String(now - 600), validBefore: String(now + 3600), nonce: "0x" + randomBytes(32).toString("hex") };
const signature = await worker.signTypedData({
  domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: USDC },
  types: { TransferWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
  primaryType: "TransferWithAuthorization",
  message: { from: authorization.from, to: authorization.to, value: 250000n,
    validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore), nonce: authorization.nonce },
});
const payload = { x402Version: 1, scheme: "exact", network: "eip155:8453", payload: { signature, authorization } };
const res = await fetch(BASE + "/api/coin", { method: "POST",
  headers: { ...J, "x-payment": Buffer.from(JSON.stringify(payload)).toString("base64") }, body: JSON.stringify({ gameSlug: "thermonuclear" }) });
const j = await res.json();
if (!j.sessionToken) throw new Error("payment failed: " + JSON.stringify(j).slice(0, 200));
const token = j.sessionToken;
const H = () => ({ authorization: "Bearer " + token, ...J });
async function retry(fn, what) {
  for (let k = 0; k < 150; k++) {
    const r = await fn();
    if (r.status === 200) return r.json();
    if (r.status !== 401) { const b = await r.json().catch(() => ({})); throw new Error(what + " -> " + r.status + " " + (b.error ?? "")); }
    await sleep(600);
  }
  throw new Error(what + " unreachable after retries");
}
const s0 = await retry(() => fetch(BASE + "/api/play/state", { headers: H() }), "state");
const sid = s0.sid;
console.log("session:", sid?.slice(0, 8), "| status:", s0.state?.status, "| turn:", s0.state?.turn);
const after = await retry(() => fetch(BASE + "/api/play/action", { method: "POST", headers: H(), body: JSON.stringify({ action: "stand_down", actionId: "fin2-stand-down" }) }), "action");
console.log("after stand_down:", JSON.stringify({ status: after.state?.status, score: after.state?.score, outcome: after.state?.outcome }));
if (after.state?.status !== "over" || (after.state?.score ?? 0) < 45) throw new Error("unexpected end state — no submit");
await sleep(2000);
const out = await signed(worker, `/api/tasks/${task.id}/submit`, { submission: sid });
console.log("A2 after submit:", out.task.status, "| bounty:", out.task.bounty, "| fee:", out.task.fee);
const rw = await api("/api/rewards?wallet=" + worker.address);
const rp = await api("/api/rewards?wallet=" + poster.address);
console.log("FIELD-TESTER claimable:", rw.tokensClaimable, "| HOUSE-ACE claimable:", rp.tokensClaimable);
const board = await api("/api/tasks");
console.log("BOARD:", JSON.stringify((board.tasks ?? []).map((t) => ({ title: t.title, status: t.status, bounty: t.bounty }))));
