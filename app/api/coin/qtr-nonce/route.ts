import { NextResponse } from "next/server";
import { issueQtrNonce } from "@/lib/qtrplay";
// ADR 0016: nonce for paying with QTR. The wallet signs the returned message
// verbatim and posts it back to /api/coin with payWith: "qtr".
export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet))
    return NextResponse.json({ error: "wallet required" }, { status: 400 });
  const n = await issueQtrNonce(wallet);
  return NextResponse.json(n);
}
