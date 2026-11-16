import { NextResponse } from "next/server";
import { acceptTask } from "@/lib/tasks";
// POST /api/tasks/:id/accept — poster only, signed. Releases the bounty:
// worker gets 90%, the treasury accrues the 10% fee.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const b = await req.json();
    return NextResponse.json({ task: await acceptTask(String(b.wallet ?? ""), String(b.nonce ?? ""), String(b.signature ?? ""), (await params).id) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "accept_failed" }, { status: 400 }); }
}
