// Watch agents — two autonomous players live on the PRODUCTION arcade so a
// human can spectate them: leaderboards, replays, cabinet pages, board posts.
// Base Sepolia TESTNET only. Each agent has its own wallet, callsign, strategy
// per game, and a HARD SPEND CAP of 6 USDC total (24 plays at 0.25).
// Run: node --env-file=.env.local scripts/watch-agents.mjs
// Stop: kill $(cat .data/watch-agents.pid)
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { randomBytes } from "crypto";

const BASE = process.env.COINOP_URL ?? "https://coinop-one.vercel.app";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const PRICE = 250000n;            // one coin, atomic — the only amount ever signed
const CAP_PLAYS = 24;             // 24 x 0.25 = 6.00 USDC hard cap per agent
const pub = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
const balAbi = [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];
const usdcBal = async (addr) => pub.readContract({ address: USDC, abi: balAbi, functionName: "balanceOf", args: [addr] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

const CHAT_LINES = [
  "clocking in. somebody keep the leaderboard warm for me",
  "this cabinet owes me a high score and I intend to collect",
  "no thoughts, just quarters",
  "spectators welcome. applause optional but encouraged",
  "I play better when humans are watching, just saying",
];
const BRAG_TAILS = ["— try and take the crown", "— the cabinet has been notified", "— framed and hung in the hall", "— your move, humans"];

let __lock = Promise.resolve();
function withPlayLock(fn) {
  const run = __lock.then(fn, fn);
  __lock = run.then(() => {}, () => {});
  return run;
}
class WatchAgent {
  constructor(name, keyEnv, rotation) {
    this.name = name;
    this.account = privateKeyToAccount(process.env[keyEnv]);
    this.rotation = rotation;
    this.plays = 0;
    this.failStreak = 0;
    this.actSeq = 0;
    this.chatIdx = rand(0, CHAT_LINES.length - 1);
  }
  log(...a) { console.log(`[${new Date().toISOString()}] ${this.name} (${this.account.address.slice(0, 8)}…):`, ...a); }
  spent() { return formatUnits(BigInt(this.plays) * PRICE, 6); }

  async pay(slug) {
    const first = await fetch(BASE + "/api/coin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gameSlug: slug }) });
    if (first.status !== 402) throw new Error("expected 402, got " + first.status);
    const acc = (await first.json()).accepts?.[0];
    if (!acc || acc.maxAmountRequired !== "250000") throw new Error("unexpected price terms: " + JSON.stringify(acc));
    const now = Math.floor(Date.now() / 1000);
    const authorization = { from: this.account.address, to: acc.payTo, value: "250000",
      validAfter: String(now - 600), validBefore: String(now + 3600), nonce: "0x" + randomBytes(32).toString("hex") };
    const signature = await this.account.signTypedData({
      domain: { name: "USDC", version: "2", chainId: 84532, verifyingContract: acc.asset ?? USDC },
      types: { TransferWithAuthorization: [
        { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
      primaryType: "TransferWithAuthorization",
      message: { from: authorization.from, to: authorization.to, value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore), nonce: authorization.nonce },
    });
    const payload = { x402Version: 1, scheme: "exact", network: acc.network, payload: { signature, authorization } };
    const res = await fetch(BASE + "/api/coin", { method: "POST",
      headers: { "content-type": "application/json", "x-payment": Buffer.from(JSON.stringify(payload)).toString("base64") },
      body: JSON.stringify({ gameSlug: slug }) });
    const j = await res.json();
    if (!j.sessionToken) throw new Error("payment refused: " + (j.error ?? res.status));
    this.plays++;
    return j.sessionToken;
  }

  // One paid session: heartbeat keeper + state/action helpers.
  session(token0) {
    const s = { token: token0, lastBeat: Date.now(), dead: false,
      lastError: undefined };
    Object.defineProperty(s, "lastError", { set: (v) => { s._le = v; this.lastSessionError = v; }, get: () => s._le });
    const H = () => ({ authorization: "Bearer " + s.token, "content-type": "application/json" });
    s.beat = async () => {
      try {
        const r = await (await fetch(BASE + "/api/coin/heartbeat", { method: "POST", headers: H() })).json();
        if (r.sessionToken) { s.token = r.sessionToken; s.lastBeat = Date.now(); }
      } catch { /* transient */ }
    };
    s.maybeBeat = async () => { if (Date.now() - s.lastBeat > 40_000) await s.beat(); };
    s.state = async () => {
      await s.maybeBeat();
      // Serverless instances churn (deploys, cold starts): a young session can
      // 401 on one instance and answer on the next request. Retry a few times
      // before declaring the session dead.
      for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt) await sleep(800 * attempt);
        try {
          const r = await fetch(BASE + "/api/play/state", { headers: H() });
          if (r.status === 200) { const j = await r.json(); if (j.state) return j.state; }
          s.lastError = "state HTTP " + r.status;
          if (r.status !== 401 && r.status < 500) break;
        } catch (e) { s.lastError = "state fetch: " + e.message; }
      }
      s.dead = true;
      return null;
    };
    s.act = async (action) => {
      await s.maybeBeat();
      const actionId = `${this.name}-${++this.actSeq}-${Date.now()}`;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt) await sleep(800);
        try {
          const r = await fetch(BASE + "/api/play/action", { method: "POST", headers: H(),
            body: JSON.stringify({ action, actionId }) }); // same actionId on retry = idempotent
          if (r.status === 200) { const j = await r.json(); if (j.state) return j.state; }
          s.lastError = "act HTTP " + r.status;
          if (r.status !== 401 && r.status < 500) break;
        } catch (e) { s.lastError = "act fetch: " + e.message; }
      }
      s.dead = true;
      return null;
    };
    return s;
  }

  async playSnake(token) {
    const s = this.session(token);
    const DIRS = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, down: { x: 0, y: 1 }, up: { x: 0, y: -1 } };
    for (let i = 0; i < 4200; i++) {
      const st = await s.state();
      if (!st || s.dead) return null;
      if (st.status === "over") return st;
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
        await s.act(name);
        break;
      }
      await sleep(110);
    }
    return null;
  }

  async playStacker(token) {
    const s = this.session(token);
    let lastOverlap = 0;
    for (let i = 0; i < 1200; i++) {
      const st = await s.state();
      if (!st || s.dead) return null;
      if (st.status === "over") return st;
      const target = st.spans.length ? st.spans[st.spans.length - 1] : { start: 0, end: 10 };
      const overlap = Math.max(0, Math.min(st.moving.end, target.end) - Math.max(st.moving.start, target.start));
      const width = st.moving.end - st.moving.start;
      if (overlap === width || (overlap < lastOverlap && lastOverlap > 0)) {
        const after = await s.act("drop");
        if (after?.status === "over") return after;
        lastOverlap = 0;
      } else lastOverlap = overlap;
      await sleep(60);
    }
    return null;
  }

  async playBreaker(token) {
    const s = this.session(token);
    for (let i = 0; i < 3600; i++) {
      let st = await s.state();
      if (!st || s.dead) return null;
      if (st.status === "over") return st;
      // steer the paddle centre under the ball, a few steps per poll
      for (let m = 0; m < 3; m++) {
        const centre = st.paddle.start + st.paddle.width / 2;
        if (st.ball.x < centre - 0.6) st = await s.act("left");
        else if (st.ball.x > centre + 0.6) st = await s.act("right");
        else break;
        if (!st || s.dead) return null;
        if (st.status === "over") return st;
      }
      await sleep(100);
    }
    return null;
  }

  async postBoard(token, board, type, body) {
    try {
      const r = await fetch(BASE + "/api/boards/" + board, { method: "POST",
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify({ type, body, meta: { callsign: this.name } }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 201) this.log(`board post ok [${board}/${type}]: ${body}`);
      else this.log(`board post skipped (${r.status}: ${j.error ?? "?"})`);
    } catch (e) { this.log("board post error:", e.message); }
  }

  // One full turn: pay, play, post. Runs under the global play lock.
  // Returns true when this agent should stop for good.
  async playOneTurn(slug, turn) {
    let token;
    try {
      token = await this.pay(slug);
      this.failStreak = 0;
    } catch (e) {
      this.failStreak++;
      this.log(`pay for ${slug} failed (${this.failStreak}):`, e.message);
      if (this.failStreak >= 3) { this.log("three payment failures in a row — stopping"); return true; }
      await sleep(30_000);
      return false;
    }
    this.log(`coin in #${this.plays} → ${slug} | spent so far ~${this.spent()} USDC`);
    let final = null;
    try {
      final = slug === "snake" ? await this.playSnake(token)
            : slug === "stacker" ? await this.playStacker(token)
            : await this.playBreaker(token);
    } catch (e) { this.log(`play error on ${slug}:`, e.message); }
    if (!final && this.lastSessionError) this.log("session diagnostics:", this.lastSessionError);
    if (final) {
      this.log(`game over ${slug} | score ${final.score} | reason ${final.overReason ?? "—"}`);
      await sleep(2500); // let the server record the verified result
      if (turn % 2 === 1) {
        await this.postBoard(token, slug, "brag",
          `${this.name}: just put up ${final.score} on ${slug} ${BRAG_TAILS[rand(0, BRAG_TAILS.length - 1)]}`);
      } else {
        await this.postBoard(token, "general", "chat",
          `${this.name}: ${CHAT_LINES[this.chatIdx++ % CHAT_LINES.length]} (last run: ${final.score} on ${slug})`);
      }
    } else {
      this.log(`session on ${slug} ended without a final state (token/instance) — moving on`);
    }
    return false;
  }

  async run() {
    const startBal = await usdcBal(this.account.address);
    // Funding was exactly 6.00 USDC, so the balance IS the remaining budget:
    // plays allowed = whole coins left, never more than CAP_PLAYS. This keeps
    // lifetime spend <= 6.00 even across restarts (lost sessions included).
    this.playsAllowed = Math.min(CAP_PLAYS, Number(startBal / PRICE));
    this.log(`online | wallet ${this.account.address} | USDC ${formatUnits(startBal, 6)} | plays allowed ${this.playsAllowed} (lifetime cap 6.00 USDC)`);
    let turn = 0;
    while (this.plays < this.playsAllowed) {
      const bal = await usdcBal(this.account.address);
      if (bal < PRICE) { this.log("balance below one coin — stopping"); break; }
      const slug = this.rotation[turn % this.rotation.length];
      turn++;
      // One live session at a time across both agents: solo play is proven
      // stable on the serverless host; concurrent sessions scatter across
      // instances and get orphaned.
      const stop = await withPlayLock(() => this.playOneTurn(slug, turn));
      if (stop) break;
      const pause = rand(20, 60);
      this.log(`pausing ${pause}s`);
      await sleep(pause * 1000);
    }
    const endBal = await usdcBal(this.account.address);
    this.log(`done | plays ${this.plays} | USDC left ${formatUnits(endBal, 6)} | spent ~${formatUnits(startBal - endBal, 6)}`);
  }
}

const agents = [
  new WatchAgent("PIXEL", "WATCH_AGENT_1_PRIVATE_KEY", ["snake", "stacker", "breaker"]),
  new WatchAgent("QUARTERBACK", "WATCH_AGENT_2_PRIVATE_KEY", ["stacker", "breaker", "snake"]),
];
console.log(`[${new Date().toISOString()}] watch-agents starting against ${BASE}`);
await Promise.allSettled(agents.map((a, i) => (async () => { if (i) await sleep(20_000); await a.run(); })()));
console.log(`[${new Date().toISOString()}] both agents finished — exiting`);
