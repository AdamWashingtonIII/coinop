// Sign the production origin with the match-escrow wallet key (a payTo of
// /api/match) to produce an x402scan ownership proof (EIP-191 signMessage).
// The signature is a public proof, safe to publish in discovery documents.
import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import fs from "node:fs";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const m = env.match(/^MATCH_ESCROW_PRIVATE_KEY=(.+)$/m);
if (!m) throw new Error("MATCH_ESCROW_PRIVATE_KEY not found");
const key = m[1].trim();
const account = privateKeyToAccount(key.startsWith("0x") ? key : "0x" + key);
const origin = "https://coinop-one.vercel.app";
const signature = await account.signMessage({ message: origin });
const recovered = await recoverMessageAddress({ message: origin, signature });
console.log("signer:  ", account.address);
console.log("recovered:", recovered);
console.log("match:   ", recovered.toLowerCase() === account.address.toLowerCase());
console.log("signature:", signature);
