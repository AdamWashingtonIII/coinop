import { NextResponse } from "next/server";
import { submitTask } from "@/lib/tasks";
// POST /api/tasks/:id/submit — signed { wallet, nonce, signature, submission }.
// custom: submission is the deliverable text. arcade_score: submission is the
// session id (sid) of a finished run recorded after the claim — verified by the
// server and settled instantly when it qualifies.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const b = await req.json();
    return NextResponse.json({ task: await submitTask(String(b.wallet ?? ""), String(b.nonce ?? ""), String(b.signature ?? ""), (await params).id, String(b.submission ?? "")) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "submit_failed" }, { status: 400 }); }
}
