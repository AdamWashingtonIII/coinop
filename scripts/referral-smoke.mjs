// Referral program end-to-end smoke (ADR 0010), local server + Base Sepolia:
// a FRESH wallet is funded 0.25 test USDC from the test agent, pays its first
// coin carrying the watch agent's referral code, plays Stacker to completion,
// and the referrer must accrue exactly +25 QTR with the referral qualified.
// Run: node --env-file=.env.local scripts/referral-smoke.mjs [baseUrl]
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { createPublicClient, createWalletClient, http, formatUnits, parseSignature } from "viem";
import { baseSepolia } from "viem/chains";
import { randomBytes } from "crypto";

const BASE = process.argv[2] ?? "http://localhost:3100";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const pub = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
const referrer = privateKeyToAccount(process.env.WATCH_AGENT_1_PRIVATE_KEY);
const funder = privateKeyToAccount(process.env.AGENT_TEST_PRIVATE_KEY);
const fresh = privateKeyToAccount(generatePrivateKey());
console.log("referrer (watch 1):", referrer.address);
console.log("referred (fresh):  ", fresh.address);

// 1) fund the fresh wallet with exactly one coin from the test agent:
// EIP-3009 authorization signed by the funder, submitted by any ETH holder.
const balAbi = [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];
const usdc = async (a) => formatUnits(await pub.readContract({ address: USDC, abi: balAbi, functionName: "balanceOf", args: [a] }), 6);
console.log("funder USDC:", await usdc(funder.address), "| fresh USDC before:", await usdc(fresh.address));
const now = Math.floor(Date.now() / 1000);
const auth = { from: funder.address, to: fresh.address, value: "250000",
  validAfter: "0", validBefore: String(now + 3600), nonce: "0x" + randomBytes(32).toString("hex") };
const sig = await funder.signTypedData({
  domain: { name: "USDC", version: "2", chainId: 84532, verifyingContract: USDC },
  types: { TransferWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
  primaryType: "TransferWithAuthorization",
  message: { from: auth.from, to: auth.to, value: 250000n, validAfter: 0n, validBefore: BigInt(auth.validBefore), nonce: auth.nonce },
});
const { v, r, s } = parseSignature(sig);
const twaAbi = [{ name: "transferWithAuthorization", type: "function", stateMutability: "nonpayable",
  inputs: [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint8" }, { type: "bytes32" }, { type: "bytes32" }],
  outputs: [] }];
let submitted = null;
for (const keyName of ["AGENT_TEST_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY", "CLAIM_MINTER_PRIVATE_KEY"]) {
  const submitter = privateKeyToAccount(process.env[keyName]);
  const eth = await pub.getBalance({ address: submitter.address });
  if (eth < 5000000000000n) { console.log("submitter", keyName, "skipped (low ETH)"); continue; } // ~0.000005 ETH; the call costs ~0.0000006 at typical Sepolia gas
  const wc = createWalletClient({ account: submitter, chain: baseSepolia, transport: http("https://sepolia.base.org") });
  const hash = await wc.writeContract({ address: USDC, abi: twaAbi, functionName: "transferWithAuthorization",
    args: [auth.from, auth.to, 250000n, 0n, BigInt(auth.validBefore), auth.nonce, Number(v), r, s] });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  submitted = { by: keyName, hash, status: rcpt.status };
  break;
}
if (!submitted) { console.log("FAIL — no ETH-holding submitter for the funding transfer"); process.exit(1); }
console.log("funding transfer:", submitted.hash, "| status:", submitted.status, "| fresh USDC after:", await usdc(fresh.address));

// 2) referrer state before + their code
const rewardsOf = async (w) => (await (await fetch(BASE + "/api/rewards?wallet=" + w)).json()).tokensAccrued;
const before = await rewardsOf(referrer.address);
const codeRes = await (await fetch(BASE + "/api/referral/code?wallet=" + referrer.address)).json();
console.log("referrer QTR before:", before, "| code:", codeRes.code);
if (!codeRes.code) { console.log("FAIL — no referral code"); process.exit(1); }

// 3) fresh wallet pays its first coin WITH the referral code
const first = await fetch(BASE + "/api/coin", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ gameSlug: "stacker", referralCode: codeRes.code }) });
const body402 = await first.json();
if (first.status !== 402) { console.log("FAIL — expected 402, got", first.status); process.exit(1); }
const reqs = body402.accepts[0];
const payAuth = { from: fresh.address, to: reqs.payTo, value: "250000",
  validAfter: "0", validBefore: String(now + 3600), nonce: "0x" + randomBytes(32).toString("hex") };
const paySig = await fresh.signTypedData({
  domain: { name: "USDC", version: "2", chainId: 84532, verifyingContract: USDC },
  types: { TransferWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
  primaryType: "TransferWithAuthorization",
  message: { from: payAuth.from, to: payAuth.to, value: 250000n, validAfter: 0n, validBefore: BigInt(payAuth.validBefore), nonce: payAuth.nonce },
});
const payload = { x402Version: 1, scheme: "exact", network: reqs.network, payload: { signature: paySig, authorization: payAuth } };
const paid = await fetch(BASE + "/api/coin", { method: "POST",
  headers: { "content-type": "application/json", "x-payment": Buffer.from(JSON.stringify(payload)).toString("base64") },
  body: JSON.stringify({ gameSlug: "stacker", referralCode: codeRes.code }) });
const coin = await paid.json();
console.log("coin-in:", paid.status, "| session:", coin.sid ? "OK" : "FAIL", "| referral:", JSON.stringify(coin.referral));
if (!coin.sessionToken) { console.log("FAIL — no session"); process.exit(1); }

// 4) play Stacker to completion (same timing bot as funded-play-test.mjs)
const H = { authorization: "Bearer " + coin.sessionToken, "content-type": "application/json" };
let lastOverlap = 0, finalScore = null;
for (let i = 0; i < 900; i++) {
  const st = (await (await fetch(BASE + "/api/play/state", { headers: H })).json()).state;
  if (!st || st.status === "over") { finalScore = st?.score; break; }
  const target = st.spans.length ? st.spans[st.spans.length - 1] : { start: 0, end: 10 };
  const overlap = Math.max(0, Math.min(st.moving.end, target.end) - Math.max(st.moving.start, target.start));
  const width = st.moving.end - st.moving.start;
  if (overlap === width || (overlap < lastOverlap && lastOverlap > 0)) {
    const a = await (await fetch(BASE + "/api/play/action", { method: "POST", headers: H, body: JSON.stringify({ action: "drop" }) })).json();
    if (a.gameOver) { finalScore = a.finalScore; break; }
    lastOverlap = 0;
  } else lastOverlap = overlap;
  await new Promise((res) => setTimeout(res, 60));
}
console.log("game finished | final score:", finalScore);
await new Promise((res) => setTimeout(res, 1500)); // recordResult + qualification settle

// 5) verify: referral qualified, referrer +25 exactly
const stats = await (await fetch(BASE + "/api/referral/stats?wallet=" + referrer.address)).json();
const after = await rewardsOf(referrer.address);
console.log("stats:", JSON.stringify(stats));
console.log("referrer QTR after:", after, "| delta:", after - before);
const pass = coin.referral?.status === "attributed" && stats.qualified >= 1 && stats.qtrEarned >= 25 && after - before === 25;
console.log(pass ? "SMOKE PASS — referred agent played, referrer earned exactly +25 QTR" : "SMOKE CHECK — see lines above");
