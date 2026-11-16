// Finish the Exchange seed: task A ("Snake shakedown: score 30+") is claimed by
// FIELD-TESTER but unsubmitted — the first seed run steered at the wrong state
// field and never ate. This plays one honest snake run with the proven driver
// (target = state.bonus ?? state.orb, as in funded-play-snake.mjs) and submits
// its sid for auto-verification. Run: node --env-file=.env.local scripts/finish-exchange-seed.mjs
import { randomBytes } from "crypto";
import { privateKeyToAccount } from "viem/accounts";

const BASE = process.env.COINOP_BASE ?? "https://coinop-one.vercel.app";
const TREASURY = "0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
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

const tasks = (await api("/api/tasks?status=claimed")).tasks ?? [];
let task = tasks.find((t) => t.title === "Snake shakedown: score 30+");
if (!task) {
  const open = (await api("/api/tasks?status=open")).tasks ?? [];
  task = open.find((t) => t.title === "Snake shakedown: score 30+");
  if (!task) throw new Error("task A not found in claimed or open");
  await signed(worker, `/api/tasks/${task.id}/claim`);
  console.log("re-claimed task A:", task.id);
} else console.log("task A still claimed:", task.id, "by", task.worker);

// --- paid snake, proven driver ---
const first = await fetch(BASE + "/api/coin", { method: "POST", headers: J, body: JSON.stringify({ gameSlug: "snake" }) });
const b402 = await first.json();
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
  headers: { ...J, "x-payment": Buffer.from(JSON.stringify(payload)).toString("base64") }, body: JSON.stringify({ gameSlug: "snake" }) });
const j = await res.json();
if (!j.sessionToken) throw new Error("payment failed: " + JSON.stringify(j).slice(0, 200));
let token = j.sessionToken, lastBeat = Date.now();
const H = () => ({ authorization: "Bearer " + token, ...J });
// Production sessions live in one serverless instance's memory, so calls that
// land on a sibling instance 401 — retry until the owning instance answers.
// Actions carry an actionId, so a retry can never double-apply.
async function callState() {
  for (let k = 0; k < 150; k++) {
    const r = await fetch(BASE + "/api/play/state", { headers: H() });
    if (r.status === 200) return r.json();
    await sleep(600);
  }
  throw new Error("state unreachable after retries");
}
async function callAction(name, step) {
  for (let k = 0; k < 150; k++) {
    const r = await fetch(BASE + "/api/play/action", { method: "POST", headers: H(), body: JSON.stringify({ action: name, actionId: "fin-" + step }) });
    if (r.status === 200) return;
    if (r.status !== 401) { const b = await r.json().catch(() => ({})); throw new Error("action " + name + " -> " + r.status + " " + (b.error ?? "")); }
    await sleep(600);
  }
  throw new Error("action unreachable after retries");
}
async function callHeartbeat() {
  for (let k = 0; k < 60; k++) {
    const r = await fetch(BASE + "/api/coin/heartbeat", { method: "POST", headers: H() });
    if (r.status === 200) { const b = await r.json().catch(() => ({})); if (b.sessionToken) { token = b.sessionToken; lastBeat = Date.now(); } return; }
    await sleep(600);
  }
}
const DIRS = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, down: { x: 0, y: 1 }, up: { x: 0, y: -1 } };
let finalState = null, sid = null;
for (let i = 0; i < 2400; i++) {
  if (Date.now() - lastBeat > 40_000) await callHeartbeat();
  const s = await callState();
  sid = s.sid ?? sid;
  const st = s.state;
  if (!st) throw new Error("no state: " + JSON.stringify(s).slice(0, 200));
  if (st.status === "over") { finalState = st; break; }
  const head = st.segments[0];
  const cur = { x: head.x - st.segments[1].x, y: head.y - st.segments[1].y };
  const target = st.bonus ?? st.orb;
  const prefs = [];
  if (target) {
    if (target.x > head.x) prefs.push("right");
    if (target.x < head.x) prefs.push("left");
    if (target.y > head.y) prefs.push("down");
    if (target.y < head.y) prefs.push("up");
  }
  prefs.push("right", "down", "left", "up");
  for (const name of prefs) {
    const d = DIRS[name];
    if (d.x === -cur.x && d.y === -cur.y) continue;
    const nx = head.x + d.x, ny = head.y + d.y;
    if (nx < 0 || nx >= 20 || ny < 0 || ny >= 20) continue;
    if (st.segments.slice(0, -1).some((sg) => sg.x === nx && sg.y === ny)) continue;
    await callAction(name, i);
    break;
  }
  await sleep(110);
}
console.log("game over | score:", finalState?.score, "| sid:", sid);
if (!finalState || (finalState.score ?? 0) < 30) throw new Error("run did not reach 30 — task left claimed, no submit");
await sleep(2000); // let the result record land
const out = await signed(worker, `/api/tasks/${task.id}/submit`, { submission: sid });
console.log("A after submit:", out.task.status, "| bounty:", out.task.bounty, "| fee:", out.task.fee);
const rw = await api("/api/rewards?wallet=" + worker.address);
console.log("FIELD-TESTER claimable:", rw.tokensClaimable);
