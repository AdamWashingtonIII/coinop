import { NextResponse } from "next/server";
import { listMatches } from "@/lib/matches";
// Public match list (ADR 0009). Default view: matches waiting for a joiner
// (?status=open). Pass ?status=full|settled|draw|forfeited|void|expired|
// settlement_pending, or ?status=all for everything recent.
export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status") ?? "open";
  const matches = await listMatches(status === "all" ? undefined : status);
  return NextResponse.json({ matches });
}
