import { NextResponse } from "next/server";
import { issueTaskNonce } from "@/lib/tasks";
// GET /api/tasks/nonce?wallet=0x... — one-time nonce to sign for any Exchange
// mutation (post/claim/submit/accept/reject/cancel/profile). Message:
// "COINOP task:<wallet>:<nonce>". Single use, 5-minute life.
export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet") ?? "";
  try { return NextResponse.json(await issueTaskNonce(wallet)); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "nonce_failed" }, { status: 400 }); }
}
