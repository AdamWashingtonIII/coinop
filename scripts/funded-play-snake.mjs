// Funded Snake end-to-end test (Sepolia): a real agent wallet pays 0.25 USDC via
// x402, plays Snake against the server engine with a greedy bot, and we verify the
// full M2' chain: QTR accrual in Postgres, a verified leaderboard entry, and a
// stored replay. Payment code mirrors funded-play-test.mjs — the amount is fixed
// at exactly 250000 atomic (one coin) in code; nothing else can be signed.
// Run: node --env-file=.env.local scripts/funded-play-snake.mjs [baseUrl]
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { randomBytes } from "crypto";

const BASE = process.argv[2] ?? "http://localhost:3000";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const TREASURY = "0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7";
const account = privateKeyToAccount(process.env.AGENT_TEST_PRIVATE_KEY);
const pub = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
const usdcAbi = [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];
async function usdc(addr) {
  const b = await pub.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [addr] });
  return formatUnits(b, 6);
}
console.log("agent:", account.address, "| USDC before:", await usdc(account.address), "| treasury:", await usdc(TREASURY));

const first = await fetch(BASE + "/api/coin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gameSlug: "snake" }) });
const body402 = await first.json();
console.log("no-pay status:", first.status, "| network:", body402.accepts?.[0]?.network, "| amount:", body402.accepts?.[0]?.maxAmountRequired);
if (first.status !== 402) { console.log("expected 402"); process.exit(1); }

const now = Math.floor(Date.now() / 1000);
const authorization = { from: account.address, to: TREASURY, value: "250000",
  validAfter: String(now - 600), validBefore: String(now + 3600), nonce: "0x" + randomBytes(32).toString("hex") };
const signature = await account.signTypedData({
  domain: { name: "USDC", version: "2", chainId: 84532, verifyingContract: USDC },
  types: { TransferWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
  primaryType: "TransferWithAuthorization",
  message: { from: authorization.from, to: authorization.to, value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore), nonce: authorization.nonce },
});
const payload = { x402Version: 1, scheme: "exact", network: "base-sepolia", payload: { signature, authorization } };
const payRes = await fetch(BASE + "/api/coin", { method: "POST",
  headers: { "content-type": "application/json", "x-payment": Buffer.from(JSON.stringify(payload)).toString("base64") },
  body: JSON.stringify({ gameSlug: "snake" }) });
const coin = await payRes.json();
console.log("pay ->", payRes.status, coin.sessionToken ? "SESSION OK" : "error: " + (coin.error ?? "?"));
if (!coin.sessionToken) process.exit(1);
let token = coin.sessionToken;
// NOTE: Snake starts moving the moment the coin lands — play FIRST, verify settlement after.

const H = () => ({ authorization: "Bearer " + token, "content-type": "application/json" });
let lastBeat = Date.now();
async function heartbeat() {
  const r = await (await fetch(BASE + "/api/coin/heartbeat", { method: "POST", headers: H() })).json();
  if (r.sessionToken) { token = r.sessionToken; lastBeat = Date.now(); }
}
const DIRS = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, down: { x: 0, y: 1 }, up: { x: 0, y: -1 } };
let finalState = null;
for (let i = 0; i < 2400; i++) {
  if (Date.now() - lastBeat > 40_000) await heartbeat();
  const s = await (await fetch(BASE + "/api/play/state", { headers: H() })).json();
  const st = s.state;
  if (!st) { console.log("no state:", JSON.stringify(s)); process.exit(1); }
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
    await fetch(BASE + "/api/play/action", { method: "POST", headers: H(), body: JSON.stringify({ action: name }) });
    break;
  }
  await new Promise((r) => setTimeout(r, 110));
}
console.log("game over | score:", finalState?.score, "| length:", finalState?.length, "| reason:", finalState?.overReason);
await new Promise((r) => setTimeout(r, 4000));
console.log("USDC after settle — agent:", await usdc(account.address), "| treasury:", await usdc(TREASURY));
if (!finalState) { console.log("CHECK — game never ended"); process.exit(1); }

const rewards = await (await fetch(BASE + "/api/rewards?wallet=" + account.address)).json();
console.log("rewards accrued:", rewards.tokensAccrued, "| claimable:", rewards.tokensClaimable);
const board = await (await fetch(BASE + "/api/leaderboard?slug=snake")).json();
console.log("leaderboard:", JSON.stringify(board.entries));
const replays = await (await fetch(BASE + "/api/replays?slug=snake")).json();
console.log("replays:", JSON.stringify(replays.replays?.map((r) => ({ sid: r.sid.slice(0, 8), score: r.finalScore }))));
let replayOk = false;
if (replays.replays?.length) {
  const detail = await (await fetch(BASE + "/api/replay/" + replays.replays[0].sid)).json();
  replayOk = Array.isArray(detail.snapshots) && detail.snapshots.length > 0;
  console.log("replay snapshots:", detail.snapshots?.length, "| actions:", detail.actions?.length);
}
const onBoard = board.entries?.some((e) => e.wallet.toLowerCase() === account.address.toLowerCase() && e.score === finalState.score);
console.log(rewards.tokensAccrued >= 25 && onBoard && replayOk
  ? "PASS — snake play settled, 25 QTR accrued in Postgres, leaderboard + replay recorded"
  : "CHECK — something above did not line up");
