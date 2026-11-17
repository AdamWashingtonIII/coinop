// Funded-play end-to-end test (Base MAINNET) for GRAND PRIX: the test agent
// pays 0.25 USDC via x402, races a full 3-lap grand prix against the server
// engine with the reference driver, and we verify the on-chain settlement,
// the recorded finish, and the +25 QTR accrual.
// Run: node --env-file=.env.local scripts/funded-grandprix-mainnet.mjs [baseUrl]
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, formatUnits } from "viem";
import { base } from "viem/chains";
import { randomBytes } from "crypto";

const BASE = process.argv[2] ?? "https://coinop-one.vercel.app";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TREASURY = "0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7";
const account = privateKeyToAccount(process.env.AGENT_TEST_PRIVATE_KEY);
const pub = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const usdcAbi = [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];
async function usdc(addr) {
  const b = await pub.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [addr] });
  return Number(formatUnits(b, 6));
}
const agentBefore = await usdc(account.address);
const treasuryBefore = await usdc(TREASURY);
console.log("agent:", account.address, "| USDC before:", agentBefore, "| treasury before:", treasuryBefore);
const rewardsBefore = await (await fetch(BASE + "/api/rewards?wallet=" + account.address)).json().catch(() => ({}));
console.log("rewards before:", JSON.stringify(rewardsBefore));

const first = await fetch(BASE + "/api/coin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gameSlug: "grandprix" }) });
const body402 = await first.json().catch(() => ({}));
const a0 = body402.accepts?.[0] ?? {};
const amount = a0.amount ?? a0.maxAmountRequired;
console.log("no-pay status:", first.status, "| amount:", amount, "| payTo:", a0.payTo);
if (first.status !== 402 || String(amount) !== "250000" || a0.payTo !== TREASURY || a0.asset !== USDC) {
  console.log("REQUIREMENTS MISMATCH — refusing to sign"); process.exit(1);
}
const now = Math.floor(Date.now() / 1000);
const authorization = { from: account.address, to: TREASURY, value: "250000",
  validAfter: String(now - 600), validBefore: String(now + 3600), nonce: "0x" + randomBytes(32).toString("hex") };
const signature = await account.signTypedData({
  domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: USDC },
  types: { TransferWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
  primaryType: "TransferWithAuthorization",
  message: { from: authorization.from, to: authorization.to, value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore), nonce: authorization.nonce },
});
let coin = null;
for (const network of ["eip155:8453", "base"]) {
  const payload = { x402Version: 1, scheme: "exact", network, payload: { signature, authorization } };
  const res = await fetch(BASE + "/api/coin", { method: "POST",
    headers: { "content-type": "application/json", "x-payment": Buffer.from(JSON.stringify(payload)).toString("base64") },
    body: JSON.stringify({ gameSlug: "grandprix" }) });
  const j = await res.json().catch(() => ({}));
  console.log("pay attempt network=" + network, "-> status", res.status, j.sessionToken ? "SESSION OK" : "error: " + (j.error ?? JSON.stringify(j).slice(0, 200)));
  if (j.sessionToken) { coin = j; break; }
}
if (!coin) { console.log("PAYMENT FAILED"); process.exit(1); }

// Drive the race with the reference policy (same as the engine tests).
const H = { authorization: "Bearer " + coin.sessionToken, "content-type": "application/json" };
const act = async (action) => { await fetch(BASE + "/api/play/action", { method: "POST", headers: H, body: JSON.stringify({ action }) }); };
await act("accelerate");
let final = null, actions = 0;
for (let i = 0; i < 2400; i++) {
  const s = await (await fetch(BASE + "/api/play/state", { headers: H })).json().catch(() => ({}));
  const st = s.state;
  if (!st) { console.log("state lost at poll", i, JSON.stringify(s).slice(0, 160)); break; }
  if (st.status === "over") { final = st; break; }
  let curveAhead = 0;
  for (let k = 4; k < 18; k++) { const c = st.road[k]?.curve ?? 0; if (Math.abs(c) > Math.abs(curveAhead)) curveAhead = c; }
  let targetLat = Math.max(-0.72, Math.min(0.72, curveAhead * 2.4));
  let blocked = false;
  for (const r of st.rivals) {
    if (r.relS > 4 && r.relS < 72 && Math.abs(r.lat - st.lat) < 0.6)
      targetLat = Math.max(-0.82, Math.min(0.82, r.lat + (st.lat >= r.lat ? 0.75 : -0.75)));
    if (r.relS > 0 && r.relS < 30 && Math.abs(r.lat - st.lat) < 0.62 && r.kmh < st.kmh) blocked = true;
  }
  const wantSteer = targetLat > st.lat + 0.07 ? 1 : targetLat < st.lat - 0.07 ? -1 : 0;
  if (wantSteer !== st.steer) { await act(wantSteer === 1 ? "right" : wantSteer === -1 ? "left" : "center"); actions++; }
  const wantThrottle = blocked || (Math.abs(curveAhead) > 0.5 && st.speed > 76) ? -1 : 1;
  if (wantThrottle !== st.throttle) { await act(wantThrottle === 1 ? "accelerate" : "brake"); actions++; }
  await new Promise((r) => setTimeout(r, 200));
}
if (!final) { console.log("RACE DID NOT COMPLETE over the API"); process.exit(1); }
console.log("RACE OVER | finished:", final.finished, "| position:", final.finalPosition, "| score:", final.score,
  "| laps:", final.lapTimes.map((x) => (x / 1000).toFixed(1)).join("/"), "| overtakes:", final.overtakes, "| crashes:", final.crashes, "| actions sent:", actions);

let settled = false;
for (let i = 0; i < 12 && !settled; i++) {
  const t = await usdc(TREASURY), ag = await usdc(account.address);
  if (Math.abs(t - treasuryBefore - 0.25) < 1e-9 && Math.abs(agentBefore - ag - 0.25) < 1e-9) settled = true;
  else await new Promise((r) => setTimeout(r, 5000));
}
console.log(settled ? "PASS — 0.25 USDC settled agent -> treasury" : "CHECK — settlement delta not seen");
const rewards = await (await fetch(BASE + "/api/rewards?wallet=" + account.address)).json();
const delta = (rewards.tokensAccrued ?? 0) - (rewardsBefore.tokensAccrued ?? 0);
console.log(delta === 25 ? "PASS — +25 QTR accrued" : "CHECK — accrual delta = " + delta);
const board = await (await fetch(BASE + "/api/leaderboard?slug=grandprix&season=all")).json().catch(() => ({}));
const mine = (board.entries ?? []).find((e) => (e.wallet ?? "").toLowerCase() === account.address.toLowerCase());
console.log(mine ? "PASS — grand prix leaderboard carries the run: " + JSON.stringify(mine) : "CHECK — run not on the leaderboard yet");
console.log(final.finished && settled && delta === 25 ? "GRAND PRIX FUNDED PLAY: PASS" : "GRAND PRIX FUNDED PLAY: CHECK ABOVE");
