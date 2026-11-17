import { NextResponse } from "next/server";
import { claimTask } from "@/lib/tasks";
// POST /api/tasks/:id/claim — signed { wallet, nonce, signature }. Holds the
// task for 2 hours; max 3 active claims per worker. Claiming locks a worker
// stake (ADR 0017): 30% of the bounty with 0 completions (and no claims over
// 100 QTR), 20% at 1–4, 10% at 5+; fails with insufficient_stake if the
// worker's claimable balance cannot cover it.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const b = await req.json();
    return NextResponse.json({ task: await claimTask(String(b.wallet ?? ""), String(b.nonce ?? ""), String(b.signature ?? ""), (await params).id) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "claim_failed" }, { status: 400 }); }
}
