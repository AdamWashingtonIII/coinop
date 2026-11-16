import { NextResponse } from "next/server";
import { listClaims, submitClaim } from "@/lib/claims";
// POST {wallet, nonce, signature} -> queues a claim for the wallet's full
// claimable QTR balance. GET ?wallet= lists the wallet's claims and statuses.
// Queued claims are minted in batches by the claim processor (see /api/internal/process-claims).
export async function POST(req: Request) {
  const j = (await req.json().catch(() => null)) as { wallet?: string; nonce?: string; signature?: string } | null;
  if (!j?.wallet || !j?.nonce || !j?.signature)
    return NextResponse.json({ error: "wallet_nonce_signature_required" }, { status: 400 });
  try { return NextResponse.json({ claim: await submitClaim(j.wallet, j.nonce, j.signature) }, { status: 201 }); }
  catch (e) {
    const code = e instanceof Error ? e.message : "claim_failed";
    return NextResponse.json({ error: code }, { status: code === "nothing_to_claim" ? 422 : 400 });
  }
}
export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet))
    return NextResponse.json({ error: "wallet query param (0x address) required" }, { status: 400 });
  return NextResponse.json({ wallet, claims: await listClaims(wallet) });
}
