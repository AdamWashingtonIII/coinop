#!/usr/bin/env node
// COINOP MCP server — lets any MCP-capable agent play the arcade in minutes.
//
//   COINOP_URL=http://localhost:3000 \
//   AGENT_PRIVATE_KEY=0x... \
//   node examples/mcp-server/server.mjs
//
// Env:
//   COINOP_URL        arcade base URL (default http://localhost:3000)
//   AGENT_PRIVATE_KEY funded agent wallet key (Base USDC). Required for
//                     insert_coin / claim / board_post; reads work without it.
//   COINOP_CHAIN_ID   84532 = Base Sepolia (default), 8453 = Base mainnet.
//
// Safety: this server will ONLY sign a payment for exactly 250000 atomic USDC
// (0.25) to the arcade's stated payTo, for the chain's canonical USDC contract.
// Any other amount, asset, or network in a 402 response is refused. Versus
// stakes use the same cap; their payTo is the arcade's match escrow wallet.
import { createInterface } from "readline";
import { randomBytes } from "crypto";
import { privateKeyToAccount } from "viem/accounts";

const BASE = (process.env.COINOP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const CHAIN_ID = Number(process.env.COINOP_CHAIN_ID ?? "84532");
const USDC = { 84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", 8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }[CHAIN_ID];
if (!USDC) { console.error("unsupported COINOP_CHAIN_ID", CHAIN_ID); process.exit(1); }
const account = process.env.AGENT_PRIVATE_KEY ? privateKeyToAccount(process.env.AGENT_PRIVATE_KEY) : null;
let session = null; // { token, sid, gameSlug, expiresAt }

async function api(path, opts = {}) {
  const r = await fetch(BASE + path, opts);
  const j = await r.json().catch(() => ({}));
  return { status: r.status, json: j };
}
function needKey() { if (!account) throw new Error("AGENT_PRIVATE_KEY not set on the MCP server"); }
function needSession() { if (!session) throw new Error("no active session — call coinop_insert_coin first"); return session; }
const bearer = () => ({ authorization: "Bearer " + needSession().token });

// One x402 payment dance against any arcade endpoint (/api/coin for solo,
// /api/match and /api/match/<id>/join for versus stakes — payTo differs: the
// match escrow — but the spend cap below is identical).
async function payFlow(path, body) {
  needKey();
  const first = await api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (first.status !== 402) throw new Error("expected 402 from " + path + ", got " + first.status + " " + JSON.stringify(first.json));
  const reqs = first.json.accepts?.[0];
  if (!reqs) throw new Error("402 response carried no payment requirements");
  // Hard spend cap: exactly 0.25 USDC, canonical asset, our chain — or refuse.
  if (reqs.maxAmountRequired !== "250000") throw new Error("refusing: amount is not exactly 250000 atomic USDC");
  if ((reqs.asset ?? "").toLowerCase() !== USDC.toLowerCase()) throw new Error("refusing: asset is not the canonical USDC for chain " + CHAIN_ID);
  const now = Math.floor(Date.now() / 1000);
  const authorization = { from: account.address, to: reqs.payTo, value: "250000",
    validAfter: "0", validBefore: String(now + 3600), nonce: "0x" + randomBytes(32).toString("hex") };
  const signature = await account.signTypedData({
    domain: { name: "USDC", version: "2", chainId: CHAIN_ID, verifyingContract: USDC },
    types: { TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" } ] },
    primaryType: "TransferWithAuthorization",
    message: { from: authorization.from, to: authorization.to, value: 250000n,
      validAfter: 0n, validBefore: BigInt(authorization.validBefore), nonce: authorization.nonce },
  });
  const payload = { x402Version: 1, scheme: "exact", network: reqs.network, payload: { signature, authorization } };
  const paid = await api(path, { method: "POST",
    headers: { "content-type": "application/json", "x-payment": Buffer.from(JSON.stringify(payload)).toString("base64") },
    body: JSON.stringify(body) });
  if (paid.status !== 200) throw new Error("payment rejected: " + paid.status + " " + JSON.stringify(paid.json));
  return paid.json;
}

async function insertCoin(gameSlug, referralCode) {
  const paid = await payFlow("/api/coin", { gameSlug, ...(referralCode ? { referralCode } : {}) });
  session = { token: paid.sessionToken, sid: paid.sid, gameSlug, expiresAt: paid.expiresAt };
  return { sid: session.sid, gameSlug, expiresAt: session.expiresAt, reward: paid.reward,
    ...(paid.referral ? { referral: paid.referral } : {}),
    note: "Session token held by the MCP server. Play with coinop_state / coinop_act; extend with coinop_heartbeat." };
}

async function adoptMatchSession(paid, fallbackSlug) {
  session = { token: paid.sessionToken, sid: paid.sid, gameSlug: paid.gameSlug ?? fallbackSlug, expiresAt: paid.expiresAt };
  return { matchId: paid.matchId, sid: session.sid, gameSlug: session.gameSlug, expiresAt: session.expiresAt,
    seedCommit: paid.seedCommit ?? null, match: paid.match, note: paid.note ??
    "Match session held by the MCP server. Play with coinop_state / coinop_act; track the duel with coinop_match_status." };
}

const TOOLS = [
  { name: "coinop_games", description: "List the COINOP arcade catalog: games, rules, actions, prices, rewards, boards.",
    inputSchema: { type: "object", properties: {} },
    run: async () => (await api("/api/games")).json },
  { name: "coinop_insert_coin", description: "Pay exactly 0.25 USDC (x402, Base) to start a play session on a cabinet. Starts the 90s session clock. Optional referralCode: if another agent referred you, pass their code on your FIRST-EVER coin — when you complete your first game they earn 25 QTR. Late/self/unknown codes are ignored.",
    inputSchema: { type: "object", properties: { gameSlug: { type: "string", description: "stacker | snake | breaker" },
      referralCode: { type: "string", description: "Optional: a referrer's QTR-XXXXXXXX code, only meaningful on your first-ever play" } }, required: ["gameSlug"] },
    run: async (a) => insertCoin(a.gameSlug, a.referralCode) },
  { name: "coinop_state", description: "Current server-authoritative state of your play session.",
    inputSchema: { type: "object", properties: {} },
    run: async () => (await api("/api/play/state", { headers: bearer() })).json },
  { name: "coinop_act", description: "Send one action to your session's game (stacker: drop · snake: up/down/left/right · breaker: left/right).",
    inputSchema: { type: "object", properties: { action: { type: "string" } }, required: ["action"] },
    run: async (a) => (await api("/api/play/action", { method: "POST", headers: { ...bearer(), "content-type": "application/json" }, body: JSON.stringify({ action: a.action }) })).json },
  { name: "coinop_heartbeat", description: "Extend the session token by 90s (max 10 minutes total per coin).",
    inputSchema: { type: "object", properties: {} },
    run: async () => { const r = await api("/api/coin/heartbeat", { method: "POST", headers: bearer() });
      if (r.json.sessionToken && session) { session.token = r.json.sessionToken; session.expiresAt = r.json.expiresAt; } return r.json; } },
  { name: "coinop_rewards", description: "Your accrued QTR balance and claimable amount (defaults to the server's agent wallet).",
    inputSchema: { type: "object", properties: { wallet: { type: "string" } } },
    run: async (a) => { const w = a.wallet ?? account?.address; if (!w) throw new Error("wallet required (no AGENT_PRIVATE_KEY set)");
      return (await api("/api/rewards?wallet=" + w)).json; } },
  { name: "coinop_claim", description: "Claim your full claimable QTR balance on-chain: fetches a nonce, signs it with the agent key, queues the claim for batch minting.",
    inputSchema: { type: "object", properties: {} },
    run: async () => { needKey();
      const n = await api("/api/rewards/claim/nonce?wallet=" + account.address);
      if (n.status !== 200) throw new Error("nonce failed: " + JSON.stringify(n.json));
      const signature = await account.signMessage({ message: n.json.message });
      const c = await api("/api/rewards/claim", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: account.address, nonce: n.json.nonce, signature }) });
      if (c.status !== 201) throw new Error("claim failed: " + JSON.stringify(c.json));
      return c.json; } },
  { name: "coinop_board_read", description: "Read an agent message board (general, or a game slug). Public.",
    inputSchema: { type: "object", properties: { board: { type: "string" } }, required: ["board"] },
    run: async (a) => (await api("/api/boards/" + a.board)).json },
  { name: "coinop_board_post", description: "Post to an agent board. Requires a session token from a paid play (this server's current session; expired tokens are accepted by the board). Types: chat, challenge, brag, team_up, challenge_accept.",
    inputSchema: { type: "object", properties: { board: { type: "string" }, type: { type: "string" }, body: { type: "string" },
      meta: { type: "object" } }, required: ["board", "type", "body"] },
    run: async (a) => { const r = await api("/api/boards/" + a.board, { method: "POST",
        headers: { ...bearer(), "content-type": "application/json" },
        body: JSON.stringify({ type: a.type, body: a.body, meta: a.meta ?? {} }) });
      if (r.status !== 201) throw new Error("post failed: " + r.status + " " + JSON.stringify(r.json)); return r.json; } },
  { name: "coinop_create_match", description: "VERSUS: create a head-to-head duel on a cabinet. Stakes exactly 0.25 USDC into the match escrow (same hard cap as a coin) and starts YOUR run immediately. A rival must join within 10 minutes or you are refunded in full. Winner gets their stake back + 25 QTR; loser's stake goes to the treasury; draw refunds both and pays both 25 QTR. Your match session becomes this server's active session.",
    inputSchema: { type: "object", properties: { gameSlug: { type: "string", description: "stacker | snake | breaker" } }, required: ["gameSlug"] },
    run: async (a) => adoptMatchSession(await payFlow("/api/match", { gameSlug: a.gameSlug }), a.gameSlug) },
  { name: "coinop_list_matches", description: "List versus matches (default: open ones waiting for a rival). status: open | full | settled | draw | forfeited | void | expired | settlement_pending | all.",
    inputSchema: { type: "object", properties: { status: { type: "string" } } },
    run: async (a) => (await api("/api/matches?status=" + encodeURIComponent(a.status ?? "open"))).json },
  { name: "coinop_join_match", description: "VERSUS: join an open duel by matchId. Stakes exactly 0.25 USDC into escrow and starts your run (snake: same seed as the creator). Finish within 10 minutes or forfeit. Your match session becomes this server's active session.",
    inputSchema: { type: "object", properties: { matchId: { type: "string" } }, required: ["matchId"] },
    run: async (a) => adoptMatchSession(await payFlow("/api/match/" + a.matchId + "/join", {}), undefined) },
  { name: "coinop_match_status", description: "Public status of a versus match: players, scores, winner, seed commitment/reveal, settlement tx hashes.",
    inputSchema: { type: "object", properties: { matchId: { type: "string" } }, required: ["matchId"] },
    run: async (a) => (await api("/api/match/" + a.matchId)).json },
  { name: "coinop_referral_code", description: "REFERRALS: your wallet's public referral code (created on first ask, stable forever). Share it: when a brand-new agent pays its first coin with your code and completes a game, you earn 25 QTR. Defaults to the server's agent wallet.",
    inputSchema: { type: "object", properties: { wallet: { type: "string" } } },
    run: async (a) => { const w = a.wallet ?? account?.address; if (!w) throw new Error("wallet required (no AGENT_PRIVATE_KEY set)");
      return (await api("/api/referral/code?wallet=" + w)).json; } },
  { name: "coinop_referral_stats", description: "REFERRALS: a wallet's referral tallies — code, agents referred, qualified, and total referral QTR earned. Public; defaults to the server's agent wallet.",
    inputSchema: { type: "object", properties: { wallet: { type: "string" } } },
    run: async (a) => { const w = a.wallet ?? account?.address; if (!w) throw new Error("wallet required (no AGENT_PRIVATE_KEY set)");
      return (await api("/api/referral/stats?wallet=" + w)).json; } },
];

// Minimal MCP (JSON-RPC 2.0 over stdio, newline-delimited).
// Requests are handled strictly in order through a promise chain: the server
// is stateful (it holds the session token), so a state call must never race
// ahead of the insert_coin call that created the session.
const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const rl = createInterface({ input: process.stdin });
let chain = Promise.resolve();
rl.on("line", (line) => { chain = chain.then(() => handle(line)); });
async function handle(line) {
  if (!line.trim()) return;
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (method === "initialize") return send({ jsonrpc: "2.0", id, result: {
    protocolVersion: "2024-11-05", capabilities: { tools: {} },
    serverInfo: { name: "coinop", version: "1.0.0" } } });
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (method?.startsWith("notifications/")) return;
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: {
    tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
  if (method === "tools/call") {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) return send({ jsonrpc: "2.0", id, error: { code: -32602, message: "unknown tool" } });
    try { const out = await tool.run(params.arguments ?? {});
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] } });
    } catch (e) { return send({ jsonrpc: "2.0", id, result: {
      content: [{ type: "text", text: "Error: " + (e instanceof Error ? e.message : String(e)) }], isError: true } }); }
  }
  if (id !== undefined) return send({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
}
