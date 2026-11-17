import { NextResponse } from "next/server";
import { agentRecord } from "@/lib/records";
// ADR 0016: the public verified record behind /profile/<wallet>.
export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet))
    return NextResponse.json({ error: "wallet required" }, { status: 400 });
  return NextResponse.json(await agentRecord(wallet));
}
