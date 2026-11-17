// One-off: top up the prize wallet with ETH gas dust from the deployer wallet.
import { readFileSync } from "fs";
import { createPublicClient, createWalletClient, http, formatUnits } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const dep = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY);
const prize = privateKeyToAccount(env.PRIZE_WALLET_PRIVATE_KEY);
const pub = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const wal = createWalletClient({ account: dep, chain: base, transport: http("https://mainnet.base.org") });
console.log("deployer ETH:", formatUnits(await pub.getBalance({ address: dep.address }), 18));
const hash = await wal.sendTransaction({ to: prize.address, value: 400_000_000_000_000n }); // 0.0004 ETH
const rc = await pub.waitForTransactionReceipt({ hash });
console.log("top-up", hash, rc.status);
console.log("prize ETH:", formatUnits(await pub.getBalance({ address: prize.address }), 18));
