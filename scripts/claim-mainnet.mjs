// Claim test (Base MAINNET): the test agent claims its full claimable QTR
// balance through the production API, the internal processor mints from the
// appointed minter wallet, and we verify the mint on-chain.
// Run: node --env-file=.env.local scripts/claim-mainnet.mjs
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, formatUnits } from "viem";
import { base } from "viem/chains";

const BASE = "https://coinop-one.vercel.app";
const QTR = "0x155dcad05188723216fb5782FFC51689A537611e";
const account = privateKeyToAccount(process.env.AGENT_TEST_PRIVATE_KEY);
const pub = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const abi = [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
             { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }];
const qtr = async (fn, args) => pub.readContract({ address: QTR, abi, functionName: fn, args });

const balBefore = Number(formatUnits(await qtr("balanceOf", [account.address]), 18));
const supplyBefore = Number(formatUnits(await qtr("totalSupply", []), 18));
console.log("QTR before — agent:", balBefore, "| totalSupply:", supplyBefore);

const rewards = await (await fetch(BASE + "/api/rewards?wallet=" + account.address)).json();
console.log("claimable per API:", rewards.tokensClaimable);
if (!rewards.tokensClaimable) { console.log("nothing to claim"); process.exit(1); }

const { nonce, message } = await (await fetch(BASE + `/api/rewards/claim/nonce?wallet=${account.address}`)).json();
const signature = await account.signMessage({ message }); // sign the server's exact message (lowercased wallet)
const submit = await fetch(BASE + "/api/rewards/claim", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ wallet: account.address, nonce, signature }) });
console.log("claim submit:", submit.status, JSON.stringify(await submit.json()).slice(0, 200));

const proc = await fetch(BASE + "/api/internal/process-claims", { method: "POST",
  headers: { "x-internal-secret": process.env.INTERNAL_JOB_SECRET } });
console.log("process-claims:", proc.status, (await proc.text()).slice(0, 300));

for (let i = 0; i < 10; i++) {
  await new Promise((r) => setTimeout(r, 4000));
  const bal = Number(formatUnits(await qtr("balanceOf", [account.address]), 18));
  const sup = Number(formatUnits(await qtr("totalSupply", []), 18));
  console.log(`mint check ${i}: agent QTR ${bal} | supply ${sup}`);
  if (bal > balBefore) {
    console.log(bal - balBefore === rewards.tokensClaimable ? "PASS — claim minted exactly the claimable amount on mainnet" : "CHECK — minted delta differs from claimable");
    break;
  }
  if (i === 9) console.log("CHECK — no mint seen after processing");
}
