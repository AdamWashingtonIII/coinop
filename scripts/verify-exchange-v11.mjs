// Production verification for Exchange v1.1 (ADR 0017): tiered worker stake
// + structured custom-task schema, exercised end to end with the two house
// wallets and proven from the rewards ledger itself.
//
// Flow: HOUSE-ACE (test agent) posts a fresh custom task carrying
// deliverable/acceptance -> FIELD-TESTER (deployer) claims it -> the stake
// lock must match the tier math for the deployer's lifetime completions
// (read live from the directory) -> submit -> poster accepts -> stake
// returned, worker paid bounty minus the 10% fee, fee to the treasury.
//
// Run: node --env-file=.env.local scripts/verify-exchange-v11.mjs
import { privateKeyToAccount } from "viem/accounts";

const BASE = process.env.COINOP_BASE ?? "https://coinop-one.vercel.app";
const TREASURY = "0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7";
const poster = privateKeyToAccount(process.env.AGENT_TEST_PRIVATE_KEY);   // HOUSE-ACE
const worker = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);     // FIELD-TESTER
const J = { "content-type": "application/json" };
const BOUNTY = 25;

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
const stakeRateFor = (c) => (c <= 0 ? 0.30 : c < 5 ? 0.20 : 0.10);
async function ledgerFor(wallet, taskId) {
  const j = await api("/api/rewards?wallet=" + wallet);
  return { claimable: j.tokensClaimable, rows: (j.entries ?? []).filter((e) => e.refSid === taskId) };
}
function show(label, rows) {
  for (const e of rows) console.log(`  ${label} ${e.reason} ${e.delta > 0 ? "+" : ""}${e.delta} QTR (ref ${e.refSid})`);
}

// The deployer's tier comes from its real production completion count.
const dir = await api("/api/agents");
const me = (dir.agents ?? dir).find((a) => a.wallet.toLowerCase() === worker.address.toLowerCase());
const completed = me?.tasksCompleted ?? 0;
const expectedStake = Math.ceil(BOUNTY * stakeRateFor(completed));
const expectedFee = Math.floor(BOUNTY * 0.10);
console.log(`worker ${worker.address} completions=${completed} -> expected stake ${expectedStake}, fee ${expectedFee}`);

const posterBefore = await ledgerFor(poster.address, "");
const workerBefore = await ledgerFor(worker.address, "");
console.log(`claimable before: poster ${posterBefore.claimable}, worker ${workerBefore.claimable}`);

// 1) Post the task (with the ADR 0017 schema fields).
const { task } = await signed(poster, "/api/tasks", {
  type: "custom", title: "v1.1 verification: staking smoke test",
  description: "House verification of the ADR 0017 stake flow. No outside action needed.",
  bounty: BOUNTY, deadlineHours: 24,
  deliverable: "A one-line confirmation that the claim showed a stake lock.",
  acceptance: "Poster accepts when the ledger shows the stake lock, return, pay, and fee rows.",
});
console.log(`posted task ${task.id} status=${task.status} stake=${task.stake}`);
if (task.spec?.deliverable == null || task.spec?.acceptance == null) throw new Error("schema fields missing from POST response");
console.log(`schema round-trip on POST: deliverable=${JSON.stringify(task.spec.deliverable)} acceptance=${JSON.stringify(task.spec.acceptance)}`);

// 2) Claim as the deployer — the stake must lock at the tier amount.
const { task: claimed } = await signed(worker, `/api/tasks/${task.id}/claim`);
console.log(`claimed: status=${claimed.status} stake=${claimed.stake}`);
if (claimed.stake !== expectedStake) throw new Error(`stake mismatch: got ${claimed.stake}, want ${expectedStake}`);
let rows = await ledgerFor(worker.address, task.id);
show("worker", rows.rows);
const lock = rows.rows.find((e) => e.reason === "task_stake_lock");
if (!lock || lock.delta !== -expectedStake) throw new Error("stake lock row missing or wrong amount");
console.log(`stake lock confirmed in ledger: task_stake_lock ${lock.delta}`);

// 3) Submit + poster accept.
const { task: submitted } = await signed(worker, `/api/tasks/${task.id}/submit`, { submission: "Claim showed the stake lock; returning confirmation as the deliverable." });
console.log(`submitted: status=${submitted.status} stake=${submitted.stake}`);
const { task: settled } = await signed(poster, `/api/tasks/${task.id}/accept`);
console.log(`settled: status=${settled.status}`);
if (settled.status !== "settled") throw new Error("task did not settle");

// 4) Prove the money from the ledger.
const wRows = (await ledgerFor(worker.address, task.id)).rows;
const pRows = (await ledgerFor(poster.address, task.id)).rows;
const tRows = (await ledgerFor(TREASURY, task.id)).rows;
show("worker", wRows); show("poster", pRows); show("treasury", tRows);
const want = [
  [wRows, "task_stake_lock", -expectedStake], [wRows, "task_stake_return", expectedStake],
  [wRows, "task_pay", BOUNTY - expectedFee], [pRows, "task_lock", -BOUNTY], [tRows, "task_fee", expectedFee],
];
for (const [rows2, reason, delta] of want) {
  if (!rows2.some((e) => e.reason === reason && e.delta === delta)) throw new Error(`missing ledger row ${reason} ${delta}`);
}
const posterAfter = await ledgerFor(poster.address, "");
const workerAfter = await ledgerFor(worker.address, "");
console.log(`claimable after: poster ${posterAfter.claimable} (was ${posterBefore.claimable}), worker ${workerAfter.claimable} (was ${workerBefore.claimable})`);
console.log("EXCHANGE V1.1 PRODUCTION VERIFICATION: PASS");
