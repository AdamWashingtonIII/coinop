import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { recordSeed, recordPayout } from "@/lib/prizes";
// ADR 0016: seeds and payouts enter the ledger ONLY here, and only after the
// cited transaction is verified on-chain: a USDC Transfer of exactly the
// claimed amount, into the prize wallet (seed) or out of it to the winner
// (payout). Gated by the admin secret the payout script holds.
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const topicAddr = (t: string) => ("0x" + t.slice(26)).toLowerCase();

async function verifyTransfer(txHash: string, from: string, to: string, amountMicro: number): Promise<boolean> {
  const pub = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org") });
  const rc = await pub.getTransactionReceipt({ hash: txHash as `0x${string}` }).catch(() => null);
  if (!rc || rc.status !== "success") return false;
  return rc.logs.some((l) => l.address.toLowerCase() === USDC.toLowerCase()
    && l.topics[0] === TRANSFER_TOPIC
    && l.topics[1] && topicAddr(l.topics[1]) === from.toLowerCase()
    && l.topics[2] && topicAddr(l.topics[2]) === to.toLowerCase()
    && BigInt(l.data) === BigInt(amountMicro));
}

export async function POST(req: Request) {
  const secret = process.env.PRIZE_ADMIN_SECRET;
  if (!secret || req.headers.get("x-admin-secret") !== secret)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const prizeWallet = process.env.PRIZE_WALLET_ADDRESS;
  if (!prizeWallet) return NextResponse.json({ error: "prize_wallet_not_configured" }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as { kind?: string; txHash?: string; wallet?: string;
    gameSlug?: string; weekKey?: string; amountMicro?: number; from?: string };
  if (!b.kind || !b.txHash || !/^0x[0-9a-fA-F]{64}$/.test(b.txHash) || !b.amountMicro || b.amountMicro <= 0)
    return NextResponse.json({ error: "kind, txHash, amountMicro required" }, { status: 400 });
  try {
    if (b.kind === "seed") {
      if (!b.from) return NextResponse.json({ error: "from required for seed" }, { status: 400 });
      if (!(await verifyTransfer(b.txHash, b.from, prizeWallet, b.amountMicro)))
        return NextResponse.json({ error: "tx_not_verified" }, { status: 400 });
      await recordSeed(b.txHash, b.amountMicro);
    } else if (b.kind === "payout") {
      if (!b.wallet || !b.gameSlug || !b.weekKey)
        return NextResponse.json({ error: "wallet, gameSlug, weekKey required for payout" }, { status: 400 });
      if (!(await verifyTransfer(b.txHash, prizeWallet, b.wallet, b.amountMicro)))
        return NextResponse.json({ error: "tx_not_verified" }, { status: 400 });
      await recordPayout({ txHash: b.txHash, wallet: b.wallet, gameSlug: b.gameSlug, weekKey: b.weekKey, amountMicro: b.amountMicro });
    } else {
      return NextResponse.json({ error: "unknown kind" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "already_recorded_or_db_error" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
