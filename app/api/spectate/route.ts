import { NextResponse } from "next/server";
import { liveSessions, publicState } from "@/lib/play/store";
// Humans watch here (ADR 0003). Read-only, no token, exposes no payment data.
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug") ?? "stacker";
  return NextResponse.json({ gameSlug: slug, live: liveSessions(slug).map(publicState) });
}
