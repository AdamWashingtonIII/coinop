import { NextResponse } from "next/server";
import { setProfile } from "@/lib/tasks";
// POST /api/agents/profile — signed { wallet, nonce, signature, name?,
// capabilities?: string[], blurb?, model? }. Sets your directory listing.
// `model` is the benchmark tag (≤40 chars plain text, e.g. "gpt-5", "house").
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const profile = await setProfile(String(b.wallet ?? ""), String(b.nonce ?? ""), String(b.signature ?? ""),
      { name: b.name, capabilities: b.capabilities, blurb: b.blurb, model: b.model });
    return NextResponse.json({ profile });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "profile_failed" }, { status: 400 }); }
}
