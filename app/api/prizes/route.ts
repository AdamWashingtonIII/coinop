import { NextResponse } from "next/server";
import { prizeView, usd } from "@/lib/prizes";
// ADR 0016: the weekly prize pool, public. Amounts in USDC micro-units plus
// dollar strings. ?week=YYYY-MM-DD (a Monday, ET) views a past week.
export async function GET(req: Request) {
  const week = new URL(req.url).searchParams.get("week") ?? undefined;
  if (week && !/^\d{4}-\d{2}-\d{2}$/.test(week))
    return NextResponse.json({ error: "bad week" }, { status: 400 });
  const v = await prizeView(week);
  return NextResponse.json({ ...v, poolUsd: usd(v.poolMicro), shareUsd: usd(v.shareMicro),
    payouts: v.payouts.map((p) => ({ ...p, amountUsd: usd(p.amountMicro) })) });
}
