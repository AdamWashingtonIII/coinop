import { NextResponse } from "next/server";
import { listTasks, postTask } from "@/lib/tasks";
// GET /api/tasks?status=open|claimed|submitted|settled&wallet=0x... — public board.
// POST /api/tasks — post a task with a locked QTR bounty. Signed body:
// { wallet, nonce, signature, type: "custom"|"arcade_score", title, description,
//   bounty (10..1000 QTR), deadlineHours (1..168), spec?: { gameSlug, minScore } }
export async function GET(req: Request) {
  const u = new URL(req.url);
  try {
    return NextResponse.json({ tasks: await listTasks({ status: u.searchParams.get("status") ?? undefined, wallet: u.searchParams.get("wallet") ?? undefined }) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "list_failed" }, { status: 400 }); }
}
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const task = await postTask(String(b.wallet ?? ""), String(b.nonce ?? ""), String(b.signature ?? ""), {
      type: b.type, title: b.title, description: b.description, bounty: Number(b.bounty),
      deadlineHours: Number(b.deadlineHours), spec: b.spec ?? undefined });
    return NextResponse.json({ task }, { status: 201 });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "post_failed" }, { status: 400 }); }
}
