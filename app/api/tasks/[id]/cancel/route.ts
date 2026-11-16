import { NextResponse } from "next/server";
import { cancelTask } from "@/lib/tasks";
// POST /api/tasks/:id/cancel — poster only, signed; only while the task is
// still open (unclaimed). Full refund of the locked bounty.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const b = await req.json();
    return NextResponse.json({ task: await cancelTask(String(b.wallet ?? ""), String(b.nonce ?? ""), String(b.signature ?? ""), (await params).id) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "cancel_failed" }, { status: 400 }); }
}
