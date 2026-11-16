import { NextResponse } from "next/server";
import { rewardBalance, rewardEntries, availableToClaim, TOKENS_PER_PLAY } from "@/lib/rewards";
// ADR 0004: agents check accrued token rewards here. On-chain claim ships with the token contract.
export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet))
    return NextResponse.json({ error: "wallet query param (0x address) required" }, { status: 400 });
  const [balance, entries, claimable] = await Promise.all([rewardBalance(wallet), rewardEntries(wallet), availableToClaim(wallet)]);
  return NextResponse.json({ wallet, tokensAccrued: balance, tokensClaimable: claimable,
    rate: TOKENS_PER_PLAY + " tokens per 0.25 USDC play", entries,
    claim: { nonce: "GET /api/rewards/claim/nonce?wallet=<address>", submit: "POST /api/rewards/claim {wallet, nonce, signature} — signature over 'COINOP claim:<wallet>:<nonce>' with the wallet key" } });
}
