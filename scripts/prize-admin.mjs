// Prize pool operations (ADR 0016). Modes:
//   node scripts/prize-admin.mjs balance            -> prize wallet USDC + ETH
//   node scripts/prize-admin.mjs record-seed <tx>   -> verify + record a seed transfer into the prize wallet
//   node scripts/prize-admin.mjs test-send          -> 0.01 USDC prize wallet -> test agent (payout-path micro-test)
//   node scripts/prize-admin.mjs payouts [weekKey]  -> pay last week's (or the given week's) cabinet winners
// Payouts are computed from the public /api/prizes view, sent from the prize
// wallet, and recorded through /api/prizes/record, which re-verifies every
// transfer on-chain before it enters the ledger. Idempotent: cabinets the
// API already shows as paid are skipped.
import { readFileSync } from "fs";
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const SITE = "https://coinop-one.vercel.app";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TEST_AGENT = "0x2D3f3F16EF47a8345D65b277217B5B6Dcb2386ff";
const ERC20 = parseAbi(["function transfer(address to, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const acct = privateKeyToAccount(env.PRIZE_WALLET_PRIVATE_KEY);
const pub = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const wal = createWalletClient({ account: acct, chain: base, transport: http("https://mainnet.base.org") });
const mode = process.argv[2];

async function sendUsdc(to, micro) {
  const hash = await wal.writeContract({ address: USDC, abi: ERC20, functionName: "transfer", args: [to, BigInt(micro)] });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error("transfer failed: " + hash);
  return hash;
}
async function record(body) {
  const r = await fetch(SITE + "/api/prizes/record", { method: "POST",
    headers: { "content-type": "application/json", "x-admin-secret": env.PRIZE_ADMIN_SECRET }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("record failed " + r.status + ": " + JSON.stringify(j));
  return j;
}

if (mode === "balance") {
  const usdc = await pub.readContract({ address: USDC, abi: ERC20, functionName: "balanceOf", args: [acct.address] });
  const eth = await pub.getBalance({ address: acct.address });
  console.log("prize wallet", acct.address, "| USDC", formatUnits(usdc, 6), "| ETH", formatUnits(eth, 18));
} else if (mode === "record-seed") {
  const tx = process.argv[3];
  const rc = await pub.getTransactionReceipt({ hash: tx });
  const log = rc.logs.find((l) => l.address.toLowerCase() === USDC.toLowerCase()
    && l.topics[2] && ("0x" + l.topics[2].slice(26)).toLowerCase() === acct.address.toLowerCase());
  if (!log) throw new Error("no USDC transfer into the prize wallet in " + tx);
  const from = "0x" + log.topics[1].slice(26);
  const amount = Number(BigInt(log.data));
  await record({ kind: "seed", txHash: tx, from, amountMicro: amount });
  console.log("seed recorded:", amount / 1e6, "USDC from", from);
} else if (mode === "test-send") {
  const hash = await sendUsdc(TEST_AGENT, 10_000);
  console.log("micro-test sent 0.01 USDC to the test agent:", hash);
} else if (mode === "payouts") {
  let weekKey = process.argv[3];
  if (!weekKey) {
    const cur = await (await fetch(SITE + "/api/prizes")).json();
    const start = new Date(cur.start);
    weekKey = new Date(start.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
    // convert the previous week's Monday (UTC view) — the API's week keys are ET Mondays;
    // fetch the previous week explicitly to be safe:
    const prev = await (await fetch(SITE + "/api/prizes?week=" + weekKey)).json().catch(() => null);
    if (!prev || prev.weekKey !== weekKey) throw new Error("could not resolve previous week key from " + cur.weekKey);
  }
  const view = await (await fetch(SITE + "/api/prizes?week=" + weekKey)).json();
  const paidSlugs = new Set((view.payouts ?? []).map((p) => p.gameSlug));
  const share = view.shareMicro;
  const due = (view.cabinets ?? []).filter((c) => c.leader && !paidSlugs.has(c.gameSlug) && share >= 250_000);
  console.log("week", weekKey, "| pool $" + view.poolUsd, "| share $" + view.shareUsd, "| cabinets due:", due.length);
  for (const c of due) {
    const hash = await sendUsdc(c.leader.wallet, share);
    await record({ kind: "payout", txHash: hash, wallet: c.leader.wallet, gameSlug: c.gameSlug, weekKey, amountMicro: share });
    console.log("paid", c.gameSlug, "->", c.leader.wallet, "$" + view.shareUsd, hash);
  }
  console.log("done");
} else {
  console.log("modes: balance | record-seed <tx> | test-send | payouts [weekKey]");
}
