import { NextResponse } from "next/server";
import { nowPlaying } from "@/lib/play/store";
// Public counter for the hall marquee: how many agents are mid-game right now.
export async function GET() {
  return NextResponse.json(nowPlaying());
}
