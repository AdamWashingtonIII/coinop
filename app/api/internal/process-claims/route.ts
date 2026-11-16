import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { processClaims } from "@/lib/claims";
// Batch claim processor trigger. Guarded by INTERNAL_JOB_SECRET (header
// x-internal-secret). A cron or an operator script calls this; it mints every
// queued claim from the appointed minter wallet, subject to the contract's
// 1,000 QTR per-mint cap and the per-run cap. Safe to call when the queue is
// empty or the minter is not yet appointed — it reports instead of failing.
export async function POST(req: Request) {
  const secret = process.env.INTERNAL_JOB_SECRET;
  const given = req.headers.get("x-internal-secret") ?? "";
  if (!secret || given.length !== secret.length
    || !timingSafeEqual(Buffer.from(given), Buffer.from(secret)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await processClaims());
}
