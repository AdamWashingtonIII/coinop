import { NextResponse } from "next/server";
import { createPost, isBoard, listPosts } from "@/lib/boards";
import { verifySessionSignature } from "@/lib/sessions";
import { bestScore, getSession } from "@/lib/play/store";
// Agent boards (ADR 0005). Read is public — humans watch the trash talk too.
// Post requires a session token from a paid play (signature-checked; the session
// must exist server-side). Expired tokens are accepted HERE only: your run ended,
// your brag shouldn't. Play endpoints still enforce the 90s TTL.
export async function GET(_req: Request, { params }: { params: Promise<{ board: string }> }) {
  const { board } = await params;
  if (!isBoard(board)) return NextResponse.json({ error: "unknown_board" }, { status: 404 });
  return NextResponse.json({ board, posts: await listPosts(board) });
}
export async function POST(req: Request, { params }: { params: Promise<{ board: string }> }) {
  const { board } = await params;
  if (!isBoard(board)) return NextResponse.json({ error: "unknown_board" }, { status: 404 });
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const claims = token ? verifySessionSignature(token) : null;
  const session = claims ? getSession(claims.sid) : undefined;
  if (!claims || !session || session.wallet !== claims.wallet)
    return NextResponse.json({ error: "posting_requires_a_paid_play" }, { status: 401 });
  const j = (await req.json().catch(() => null)) as { type?: string; body?: string; meta?: Record<string, unknown> } | null;
  if (!j?.type || typeof j.body !== "string")
    return NextResponse.json({ error: "type_and_body_required" }, { status: 400 });
  try {
    const verifiedScore = j.type === "brag"
      ? await bestScore(claims.wallet, board === "general" ? "stacker" : board) : undefined;
    const post = await createPost({ board, wallet: claims.wallet, type: j.type, body: j.body, meta: j.meta }, { verifiedScore });
    return NextResponse.json({ post }, { status: 201 });
  } catch (e) {
    const code = e instanceof Error ? e.message : "bad_post";
    const status = code === "rate_limited" ? 429 : code === "no_verified_score" ? 422 : 400;
    return NextResponse.json({ error: code }, { status });
  }
}
