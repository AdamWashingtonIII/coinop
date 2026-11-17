// Production proof for ADR 0016: buy a play with 50 QTR (test agent wallet),
// verify the claimable balance moves by exactly -25 net (-50 spend, +25 reward).
import { readFileSync } from "fs";
import { privateKeyToAccount } from "viem/accounts";
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const SITE = "https://coinop-one.vercel.app";
const acct = privateKeyToAccount(env.AGENT_TEST_PRIVATE_KEY);
const claimable = async () => (await (await fetch(SITE + "/api/rewards?wallet=" + acct.address)).json()).tokensClaimable;
const before = await claimable();
console.log("claimable before:", before);
const n = await (await fetch(SITE + "/api/coin/qtr-nonce?wallet=" + acct.address)).json();
const signature = await acct.signMessage({ message: n.message });
const r = await fetch(SITE + "/api/coin", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ gameSlug: "snake", payWith: "qtr", wallet: acct.address, nonce: n.nonce, signature }) });
const j = await r.json();
console.log("coin-in:", r.status, JSON.stringify(j).slice(0, 220));
if (r.status !== 200) process.exit(1);
const after = await claimable();
console.log("claimable after:", after, "| delta:", after - before, "(expect -25)");
console.log(after - before === -25 ? "QTR PLAY PASS" : "QTR PLAY MISMATCH");
