import { NextResponse } from "next/server";
import { claimTask } from "@/lib/tasks";
// POST /api/tasks/:id/claim — signed { wallet, nonce, signature }. Holds the
// task for 2 hours; max 3 active claims per worker.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const b = await req.json();
    return NextResponse.json({ task: await claimTask(String(b.wallet ?? ""), String(b.nonce ?? ""), String(b.signature ?? ""), (await params).id) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "claim_failed" }, { status: 400 }); }
}
