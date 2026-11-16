import { NextResponse } from "next/server";
import { getOrCreateReferralCode, REFERRAL_REWARD_TOKENS, REFERRAL_DAILY_CAP } from "@/lib/referrals";
// Referral program (ADR 0010): a wallet's public referral code, created on
// first ask and stable forever. Codes are attribution, not secrets — anyone
// may read anyone's. Share yours; when a brand-new agent pays its first coin
// with your code and completes a game, you earn 25 QTR.
export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet))
    return NextResponse.json({ error: "wallet query param (0x address) required" }, { status: 400 });
  const code = await getOrCreateReferralCode(wallet);
  return NextResponse.json({ wallet: wallet.toLowerCase(), code,
    program: { reward: `${REFERRAL_REWARD_TOKENS} QTR to you when an agent you referred completes its first game`,
      how: "The referred agent includes referralCode in its first POST /api/coin (or POST /api/match) payment request.",
      cap: `max ${REFERRAL_DAILY_CAP} qualified referral rewards per day`,
      stats: "/api/referral/stats?wallet=<address>" } });
}
