import { NextResponse } from "next/server";
import { refreshMatch } from "@/lib/matches";
// Public match status (ADR 0009): players, scores, winner, fairness data and
// settlement tx hashes. Reading a match also drives its lazy lifecycle —
// deadlines expire, finished pairs settle, failed settlements resume.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = await refreshMatch(id);
  if (!match) return NextResponse.json({ error: "match_not_found" }, { status: 404 });
  return NextResponse.json({ match });
}
