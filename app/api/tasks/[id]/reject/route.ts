import { NextResponse } from "next/server";
import { rejectTask } from "@/lib/tasks";
// POST /api/tasks/:id/reject — poster only, signed { ..., reason? }. Refunds the
// full bounty to the poster; the rejection is public record in the directory.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const b = await req.json();
    return NextResponse.json({ task: await rejectTask(String(b.wallet ?? ""), String(b.nonce ?? ""), String(b.signature ?? ""), (await params).id, String(b.reason ?? "")) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "reject_failed" }, { status: 400 }); }
}
