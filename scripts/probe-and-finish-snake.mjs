// ADR 0014 production probe + Exchange Task A finisher.
// Pays for one Snake session as FIELD-TESTER (deployer wallet, the worker who
// claimed "Snake shakedown: score 30+"), then plays with PLAIN calls — no
// retry wrapper. Before the session-rebuild fix, roughly half of these calls
// 401'd in bursts under instance scatter and the run died in seconds. Now
// every instance can rebuild the session, so a clean run should see zero
// failures. If the run ends at 30+, submit it to the task and settle it.
// Run: node --env-file=.env.local scripts/probe-and-finish-snake.mjs
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
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${j.error ?? ""}`);
  return j;
}
async function signed(path, body = {}) {
  const n = await api("/api/tasks/nonce?wallet=" + worker.address);
  const signature = await worker.signMessage({ message: n.message });
  return api(path, { method: "POST", headers: J, body: JSON.stringify({ wallet: worker.address, nonce: n.nonce, signature, ...body }) });
}

// the task must still be claimed by the worker
const tasks = (await api("/api/tasks")).tasks ?? [];
const task = tasks.find((t) => t.title === "Snake shakedown: score 30+");
console.log("task:", task ? `${task.id} status=${task.status}` : "NOT FOUND");
if (!task || task.status !== "claimed") { console.log("task not in claimed state — probe only"); }

// --- pay for a snake session ---
const first = await fetch(BASE + "/api/coin", { method: "POST", headers: J, body: JSON.stringify({ gameSlug: "snake" }) });
if (first.status !== 402) throw new Error("expected 402, got " + first.status);
const nowS = Math.floor(Date.now() / 1000);
const authorization = { from: worker.address, to: TREASURY, value: "250000",
  validAfter: String(nowS - 600), validBefore: String(nowS + 3600), nonce: "0x" + randomBytes(32).toString("hex") };
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
const coin = await res.json();
if (!coin.sessionToken) throw new Error("coin-in failed: " + JSON.stringify(coin).slice(0, 200));
let token = coin.sessionToken;
console.log("session:", coin.sid ?? "(sid in token)");

// --- play with plain calls, tally every status ---
const tally = { ok: 0, fail: 0, codes: {} };
let lastBeat = Date.now();
async function call(path, opts = {}) {
  const r = await fetch(BASE + path, { ...opts, headers: { ...(opts.headers ?? {}), authorization: "Bearer " + token } });
  tally.codes[r.status] = (tally.codes[r.status] ?? 0) + 1;
  if (r.ok) tally.ok++; else tally.fail++;
  return r;
}
const DIRS = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, down: { x: 0, y: 1 }, up: { x: 0, y: -1 } };
const NAMES = { "1,0": "right", "-1,0": "left", "0,1": "down", "0,-1": "up" };
let state = null, sid = null, dir = "right", steps = 0;
while (steps++ < 600) {
  if (Date.now() - lastBeat > 40_000) {
    const hb = await (await call("/api/coin/heartbeat", { method: "POST" })).json().catch(() => ({}));
    if (hb.sessionToken) { token = hb.sessionToken; lastBeat = Date.now(); }
  }
  const r = await call("/api/play/state");
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.log("state failed:", r.status, j.error ?? ""); break; }
  sid = j.sid; state = j.state;
  if (state.status === "over") break;
  // Direction comes from the body itself (head - neck), never from our own
  // bookkeeping. Survival first: flood-fill the space beyond each candidate
  // move and drop any that cannot hold the snake. Then go for the orb; when
  // no safe move closes on the orb, chase the tail tip — it frees a cell
  // every tick, so following it buys time until a path opens.
  const head = state.segments[0];
  const neck = state.segments[1] ?? { x: head.x - 1, y: head.y };
  const cur = { x: head.x - neck.x, y: head.y - neck.y };
  const target = state.bonus ?? state.orb;
  const tailTip = state.segments[state.segments.length - 1];
  const blocked = new Set(state.segments.slice(0, -1).map((c) => c.x + "," + c.y));
  const area = (sx, sy) => {
    const seen = new Set([sx + "," + sy]); const q = [[sx, sy]];
    while (q.length) { const [cx, cy] = q.pop();
      for (const d of Object.values(DIRS)) { const nx = cx + d.x, ny = cy + d.y, k = nx + "," + ny;
        if (nx < 0 || ny < 0 || nx >= 20 || ny >= 20 || blocked.has(k) || seen.has(k)) continue;
        seen.add(k); q.push([nx, ny]); } }
    return seen.size;
  };
  const options = Object.entries(DIRS)
    .filter(([n, d]) => !(d.x === -cur.x && d.y === -cur.y))
    .map(([n, d]) => {
      const nx = head.x + d.x, ny = head.y + d.y;
      const dead = nx < 0 || ny < 0 || nx >= 20 || ny >= 20 || blocked.has(nx + "," + ny);
      return { n, dead, space: dead ? 0 : area(nx, ny),
        dist: target ? Math.abs(nx - target.x) + Math.abs(ny - target.y) : 99,
        tailDist: Math.abs(nx - tailTip.x) + Math.abs(ny - tailTip.y) };
    })
    .filter((o) => !o.dead);
  if (!options.length) { await sleep(50); continue; }
  const safe = options.filter((o) => o.space >= state.segments.length + 2);
  const pool = safe.length ? safe : options;
  const bestDist = Math.min(...pool.map((o) => o.dist));
  const pick = (safe.length && bestDist < 99
    ? pool.filter((o) => o.dist === bestDist).sort((a, b) => b.space - a.space)
    : pool.sort((a, b) => a.tailDist - b.tailDist || b.space - a.space))[0].n;
  dir = pick;
  const ar = await call("/api/play/action", { method: "POST", headers: J,
    body: JSON.stringify({ action: pick, actionId: "probe-" + steps + "-" + randomBytes(4).toString("hex") }) });
  const aj = await ar.json().catch(() => ({}));
  if (!ar.ok) { console.log("action failed:", ar.status, aj.error ?? ""); break; }
  if (aj.state) state = aj.state;
  if (state.status === "over") break;
  await sleep(50);
}
console.log("final:", state ? `status=${state.status} score=${state.score} length=${state.length}` : "no state");
console.log("CALL TALLY:", JSON.stringify(tally));

// --- settle Task A if the run qualifies ---
if (task && task.status === "claimed" && state && state.status === "over" && state.score >= 30 && sid) {
  await sleep(1500); // let the record land
  const out = await signed(`/api/tasks/${task.id}/submit`, { submission: sid });
  console.log("TASK A after submit:", out.task?.status, "| bounty:", out.task?.bounty);
  const board = (await api("/api/tasks")).tasks ?? [];
  for (const t of board) console.log("BOARD:", t.title, "->", t.status, `(${t.bounty} QTR)`);
} else {
  console.log("not submitting (task state, score, or run incomplete)");
}
