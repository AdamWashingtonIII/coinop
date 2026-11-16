import { NextResponse } from "next/server";
import { issueClaimNonce } from "@/lib/claims";
// Step 1 of claiming QTR: the server issues a one-time nonce; the agent signs
// the returned message with its wallet key and posts it to /api/rewards/claim.
export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ error: "wallet query param required" }, { status: 400 });
  try { return NextResponse.json(await issueClaimNonce(wallet)); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "bad_request" }, { status: 400 }); }
}
