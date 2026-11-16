// Funded-play end-to-end test (Base MAINNET): the test agent wallet pays
// 0.25 USDC via x402 through the CDP facilitator, plays Stacker against the
// server engine, and we verify the on-chain settlement + 25 QTR accrual.
// Run: node --env-file=.env.local scripts/funded-play-mainnet.mjs [baseUrl]
// The signed amount is fixed at exactly 250000 atomic (one coin) in code.
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
console.log("agent:", account.address, "| USDC before:", agentBefore, "| treasury USDC before:", treasuryBefore);
const rewardsBefore = await (await fetch(BASE + "/api/rewards?wallet=" + account.address)).json().catch(() => ({}));
console.log("rewards before:", JSON.stringify(rewardsBefore));

// 1) ask for the price — expect a 402 (v2 shape under CDP)
const first = await fetch(BASE + "/api/coin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gameSlug: "stacker" }) });
const body402 = await first.json().catch(() => ({}));
const a0 = body402.accepts?.[0] ?? {};
const amount = a0.amount ?? a0.maxAmountRequired;
console.log("no-pay status:", first.status, "| x402Version:", body402.x402Version, "| network:", a0.network, "| amount:", amount, "| asset:", a0.asset, "| payTo:", a0.payTo, "| bazaar ext:", !!body402.extensions?.bazaar);
if (first.status !== 402) { console.log("expected 402, got", first.status); process.exit(1); }
if (String(amount) !== "250000" || a0.payTo !== TREASURY || a0.asset !== USDC) {
  console.log("REQUIREMENTS MISMATCH — refusing to sign"); process.exit(1);
}

// 2) sign an EIP-3009 authorization for exactly one coin (mainnet domain)
const now = Math.floor(Date.now() / 1000);
const authorization = { from: account.address, to: TREASURY, value: "250000",
  validAfter: String(now - 600), validBefore: String(now + 3600), nonce: "0x" + randomBytes(32).toString("hex") };
const signature = await account.signTypedData({
  domain: { name: "USDC", version: "2", chainId: 8453, verifyingContract: USDC },
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
    body: JSON.stringify({ gameSlug: "stacker" }) });
  const j = await res.json().catch(() => ({}));
  console.log("pay attempt network=" + network, "-> status", res.status, j.sessionToken ? "SESSION OK" : "error: " + (j.error ?? JSON.stringify(j).slice(0, 200)));
  if (j.sessionToken) { coin = j; break; }
}
if (!coin) { console.log("PAYMENT FAILED on both network spellings"); process.exit(1); }

// 3) prove the quarter moved on-chain (settle is async — poll up to ~60s)
let settled = false;
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const t = await usdc(TREASURY), ag = await usdc(account.address);
  console.log(`settle check ${i}: agent ${ag} | treasury ${t}`);
  if (Math.abs(t - treasuryBefore - 0.25) < 1e-9 && Math.abs(agentBefore - ag - 0.25) < 1e-9) { settled = true; break; }
}
console.log(settled ? "PASS — 0.25 USDC settled agent -> treasury on Base mainnet" : "CHECK — settlement delta not seen yet");

// 4) play Stacker to completion
const H = { authorization: "Bearer " + coin.sessionToken, "content-type": "application/json" };
let lastOverlap = 0, drops = 0;
for (let i = 0; i < 600; i++) {
  const s = await (await fetch(BASE + "/api/play/state", { headers: H })).json();
  const st = s.state;
  if (!st || st.status === "over") { console.log("game over | score:", st?.score, "| rows:", st?.level, "| reason:", st?.overReason); break; }
  const target = st.spans.length ? st.spans[st.spans.length - 1] : { start: 0, end: 10 };
  const overlap = Math.max(0, Math.min(st.moving.end, target.end) - Math.max(st.moving.start, target.start));
  const width = st.moving.end - st.moving.start;
  if (overlap === width || (overlap < lastOverlap && lastOverlap > 0)) {
    await fetch(BASE + "/api/play/action", { method: "POST", headers: H, body: JSON.stringify({ action: "drop" }) });
    drops++; lastOverlap = 0;
  } else lastOverlap = overlap;
  await new Promise((r) => setTimeout(r, 60));
}
console.log("drops:", drops);
const rewards = await (await fetch(BASE + "/api/rewards?wallet=" + account.address)).json();
console.log("rewards after:", JSON.stringify(rewards));
const delta = (rewards.tokensAccrued ?? 0) - (rewardsBefore.tokensAccrued ?? 0);
console.log(delta === 25 ? "PASS — +25 QTR accrued for the mainnet play" : "CHECK — accrual delta = " + delta);
