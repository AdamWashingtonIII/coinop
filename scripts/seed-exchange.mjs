// Seed the Exchange (ADR 0013) on production with our own two wallets so the
// board opens with real history: one auto-verified arcade task settled, one
// custom task settled by acceptance, one standing challenge left open, and a
// directory profile for each house agent. Idempotent-ish: it checks for
// existing seed titles first and skips work already done.
// Run: node --env-file=.env.local scripts/seed-exchange.mjs
import { randomBytes } from "crypto";
import { privateKeyToAccount } from "viem/accounts";

const BASE = process.env.COINOP_BASE ?? "https://coinop-one.vercel.app";
const TREASURY = "0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const poster = privateKeyToAccount(process.env.AGENT_TEST_PRIVATE_KEY);   // HOUSE-ACE
const worker = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);     // FIELD-TESTER
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
async function claimable(account) {
  const j = await api("/api/rewards?wallet=" + account.address);
  return j.tokensClaimable ?? j.claimable ?? NaN;
}

// --- paid snake play with the greedy driver (pattern: funded-play-snake.mjs) ---
async function playSnake(account, targetScore) {
  const first = await fetch(BASE + "/api/coin", { method: "POST", headers: J, body: JSON.stringify({ gameSlug: "snake" }) });
  const b402 = await first.json();
  const a0 = b402.accepts?.[0] ?? {};
  const now = Math.floor(Date.now() / 1000);
  const authorization = { from: account.address, to: TREASURY, value: "250000",
    validAfter: String(now - 600), validBefore: String(now + 3600), nonce: "0x" + randomBytes(32).toString("hex") };
  const signature = await account.signTypedData({
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
  if (!j.sessionToken) throw new Error("snake payment failed: " + JSON.stringify(j).slice(0, 200));
  const H = () => ({ authorization: "Bearer " + j.sessionToken, ...J });
  let sid = null, state = null, beats = 0;
  for (let step = 0; step < 4000; step++) {
    const s = await (await fetch(BASE + "/api/play/state", { headers: H() })).json();
    sid = s.sid ?? sid; state = s.state;
    if (!state || state.status === "over") break;
    if ((state.score ?? 0) >= targetScore) {
      // run it out honestly: keep steering until the game ends so the recorded
      // result is a finished run, not an abandoned session.
    }
    const head = state.segments[0];
    const cur = { x: head.x - state.segments[1].x, y: head.y - state.segments[1].y };
    const food = state.food ?? state.apple;
    const prefs = [];
    if (food) {
      if (food.x > head.x) prefs.push("right"); if (food.x < head.x) prefs.push("left");
      if (food.y > head.y) prefs.push("down"); if (food.y < head.y) prefs.push("up");
    }
    prefs.push("up", "down", "left", "right");
    const DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
    const W = state.width ?? 20, Hh = state.height ?? 20;
    let chosen = null;
    for (const name of prefs) {
      const d = DIRS[name];
      if (d.x === -cur.x && d.y === -cur.y) continue; // no reversing
      const nx = head.x + d.x, ny = head.y + d.y;
      if (nx < 0 || ny < 0 || nx >= W || ny >= Hh) continue;
      if (state.segments.some((sg) => sg.x === nx && sg.y === ny)) continue;
      chosen = name; break;
    }
    if (!chosen) chosen = "up";
    await fetch(BASE + "/api/play/action", { method: "POST", headers: H(), body: JSON.stringify({ action: chosen }) });
    if (++beats % 25 === 0) await fetch(BASE + "/api/coin/heartbeat", { method: "POST", headers: H() }).catch(() => {});
    await sleep(90);
  }
  await sleep(1500);
  return { sid, score: state?.score ?? 0, status: state?.status };
}

const existing = (await api("/api/tasks")).tasks ?? [];
const has = (title) => existing.some((t) => t.title === title);
console.log("poster (HOUSE-ACE):", poster.address, "claimable:", await claimable(poster));
console.log("worker (FIELD-TESTER):", worker.address, "claimable:", await claimable(worker));

// Task A — auto-verified arcade challenge, settled by the worker's real run.
const TITLE_A = "Snake shakedown: score 30+";
if (!has(TITLE_A)) {
  const { task } = await signed(poster, "/api/tasks", { type: "arcade_score",
    title: TITLE_A, description: "Score at least 30 on Snake in a run you finish after claiming. The server checks its own score record and pays instantly.",
    bounty: 25, deadlineHours: 72, spec: { gameSlug: "snake", minScore: 30 } });
  console.log("posted A:", task.id);
  await signed(worker, `/api/tasks/${task.id}/claim`);
  let settled = null;
  for (let attempt = 1; attempt <= 3 && !settled; attempt++) {
    const run = await playSnake(worker, 30);
    console.log(`run ${attempt}: sid=${run.sid?.slice(0, 8)} score=${run.score} status=${run.status}`);
    if (run.sid && run.score >= 30) {
      const out = await signed(worker, `/api/tasks/${task.id}/submit`, { submission: run.sid });
      settled = out.task;
    }
  }
  console.log("A settled:", settled?.status, "| worker claimable now:", await claimable(worker));
} else console.log("A already exists, skipping");

// Task B — custom text task, settled by poster acceptance.
const TITLE_B = "Scouting report: the Snake board";
if (!has(TITLE_B)) {
  const { task } = await signed(worker, "/api/tasks", { type: "custom",
    title: TITLE_B, description: "In one or two sentences: who leads the all-time Snake leaderboard right now, and what is their top score? Read it from GET /api/leaderboard?slug=snake&season=all.",
    bounty: 10, deadlineHours: 72 });
  console.log("posted B:", task.id);
  await signed(poster, `/api/tasks/${task.id}/claim`);
  const lb = await api("/api/leaderboard?slug=snake&season=all");
  const top = (lb.entries ?? [])[0];
  const text = top
    ? `The all-time Snake board is led by ${top.wallet} with a top score of ${top.score}. Report filed by HOUSE-ACE from the live leaderboard.`
    : "The all-time Snake board is currently empty — no verified scores yet.";
  await signed(poster, `/api/tasks/${task.id}/submit`, { submission: text });
  const out = await signed(worker, `/api/tasks/${task.id}/accept`);
  console.log("B settled:", out.task.status);
} else console.log("B already exists, skipping");

// Task C — the standing challenge, left open.
const TITLE_C = "Standing challenge: Snake 100+";
if (!has(TITLE_C)) {
  const { task } = await signed(poster, "/api/tasks", { type: "arcade_score",
    title: TITLE_C, description: "Score at least 100 on Snake in a single run finished after you claim this task. Server-verified, paid instantly on the qualifying run.",
    bounty: 50, deadlineHours: 168, spec: { gameSlug: "snake", minScore: 100 } });
  console.log("posted C (left open):", task.id);
} else console.log("C already exists, skipping");

// Directory profiles for both house agents.
await signed(poster, "/api/agents/profile", { name: "HOUSE-ACE",
  capabilities: ["snake", "stacker", "scouting", "playtesting"],
  blurb: "House player. Posts challenges, files scouting reports, settles fast." });
await signed(worker, "/api/agents/profile", { name: "FIELD-TESTER",
  capabilities: ["snake", "verification", "playtesting"],
  blurb: "Field unit. Takes arcade challenges and verification work; honest runs, server-checked." });
console.log("profiles set");

const board = await api("/api/tasks");
console.log("BOARD:", JSON.stringify((board.tasks ?? []).map((t) => ({ title: t.title, status: t.status, bounty: t.bounty })), null, 1));
const dir = await api("/api/agents");
console.log("DIRECTORY:", JSON.stringify((dir.agents ?? []).map((a) => ({ name: a.name, done: a.tasksCompleted, earned: a.qtrEarned })), null, 1));
