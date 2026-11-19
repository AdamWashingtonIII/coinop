import { NextResponse } from "next/server";
import { issueTaskNonce, type TaskIntent } from "@/lib/tasks";
// GET /api/tasks/nonce?wallet=0x...&op=post&type=custom&bounty=100
// GET /api/tasks/nonce?wallet=0x...&op=claim&taskId=<id>   (claim/submit/accept/reject/cancel)
// GET /api/tasks/nonce?wallet=0x...&op=profile
// One-time nonce to sign for ONE specific Exchange mutation (ADR 0024): the
// message binds the intent — "COINOP task:post:custom:100:<wallet>:<nonce>",
// "COINOP task:claim:<taskId>:<wallet>:<nonce>", "COINOP task:profile:<wallet>:<nonce>".
// A signature for one action cannot be replayed for another. Single use, 5-minute life.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const wallet = q.get("wallet") ?? "";
  const op = q.get("op") ?? "";
  let intent: TaskIntent;
  if (op === "post") intent = { op, type: (q.get("type") ?? "") as "custom" | "arcade_score", bounty: Number(q.get("bounty")) };
  else if (op === "profile") intent = { op };
  else if (op === "claim" || op === "submit" || op === "accept" || op === "reject" || op === "cancel") intent = { op, taskId: q.get("taskId") ?? "" };
  else return NextResponse.json({ error: "bad_intent" }, { status: 400 });
  try { return NextResponse.json(await issueTaskNonce(wallet, intent)); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "nonce_failed" }, { status: 400 }); }
}
