// Funded-play end-to-end test (Sepolia): a real agent wallet pays 0.25 USDC via x402,
// plays Stacker against the server engine, and we verify the QTR accrual.
// Run: node --env-file=.env.local scripts/funded-play-test.mjs [baseUrl]
// Payment is a hand-built x402 v1 "exact" EIP-3009 authorization — the amount is
// fixed at exactly 250000 atomic (one coin) in code; nothing else can be signed.
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { randomBytes } from "crypto";

const BASE = process.argv[2] ?? "http://localhost:3100";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const TREASURY = "0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7";
const account = privateKeyToAccount(process.env.AGENT_TEST_PRIVATE_KEY);
const pub = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
const usdcAbi = [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];
async function usdc(addr) {
  const b = await pub.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [addr] });
  return formatUnits(b, 6);
}
console.log("agent:", account.address, "| USDC before:", await usdc(account.address), "| treasury USDC before:", await usdc(TREASURY));

// 1) ask for the price — expect a 402 with accepts[0]
const first = await fetch(BASE + "/api/coin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gameSlug: "stacker" }) });
const body402 = await first.json();
console.log("no-pay status:", first.status, "| accepts network:", body402.accepts?.[0]?.network, "| amount:", body402.accepts?.[0]?.maxAmountRequired);
if (first.status !== 402) { console.log("expected 402, got", first.status); process.exit(1); }

// 2) sign an EIP-3009 authorization for exactly one coin
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

let coin = null;
for (const network of ["base-sepolia", "eip155:84532"]) {
  const payload = { x402Version: 1, scheme: "exact", network, payload: { signature, authorization } };
  const res = await fetch(BASE + "/api/coin", { method: "POST",
    headers: { "content-type": "application/json", "x-payment": Buffer.from(JSON.stringify(payload)).toString("base64") },
    body: JSON.stringify({ gameSlug: "stacker" }) });
  const j = await res.json();
  console.log("pay attempt network=" + network, "-> status", res.status, j.sessionToken ? "SESSION OK" : "error: " + (j.error ?? "?"));
  if (j.sessionToken) { coin = j; break; }
}
if (!coin) { console.log("PAYMENT FAILED on both network spellings"); process.exit(1); }

// give the async settle a moment, then prove the quarter moved on-chain
await new Promise((r) => setTimeout(r, 6000));
console.log("USDC after pay — agent:", await usdc(account.address), "| treasury:", await usdc(TREASURY));

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
console.log("rewards:", JSON.stringify(rewards));
console.log(rewards.tokensAccrued === 25 ? "PASS — 25 QTR accrued for one paid play" : "CHECK — expected tokensAccrued 25");
