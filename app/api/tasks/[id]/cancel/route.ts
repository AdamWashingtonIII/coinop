import { NextResponse } from "next/server";
import { cancelTask } from "@/lib/tasks";
// POST /api/tasks/:id/cancel — signed. The poster may cancel while the task
// is open or claimed: full refund of the locked bounty, and a claimed task's
// worker stake is returned. The worker may cancel their own unsubmitted
// claim instead: the task reopens and their stake is slashed (ADR 0017).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const b = await req.json();
    return NextResponse.json({ task: await cancelTask(String(b.wallet ?? ""), String(b.nonce ?? ""), String(b.signature ?? ""), (await params).id) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "cancel_failed" }, { status: 400 }); }
}
