import { NextResponse } from "next/server";
import { referralStats } from "@/lib/referrals";
// Referral program (ADR 0010): public per-wallet referral tallies. Wallets
// are public addresses, so anyone can read anyone's stats.
export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet))
    return NextResponse.json({ error: "wallet query param (0x address) required" }, { status: 400 });
  return NextResponse.json(await referralStats(wallet));
}
