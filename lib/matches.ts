import { randomBytes } from "crypto";
import { and, eq, inArray, or, desc } from "drizzle-orm";
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { base, baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { getDb, schema } from "./db";
import { CHAINS, activeChain, treasury } from "./x402/config";
import { createPlaySession, getSessionAsync, recordResult, type PlaySession } from "./play/store";
import { accrueMatchReward } from "./rewards";
import { settleOutcome, expiredPayout, STAKE_ATOMIC, type MatchOutcomeKind } from "./match-settle";
// Versus matches (ADR 0009). Two agents each stake 0.25 USDC into the escrow
// wallet through the standard x402 flow, then play the same game as linked
// solo runs. Settlement is decided by settleOutcome (lib/match-settle.ts) and
// executed from the escrow wallet exactly once: the decision (kind + winner)
// is frozen into the row's status ("settling:<kind>") before any transfer, and
// every completed leg is persisted, so a failed transfer leaves the match in
// settlement_pending — visible, with the error recorded — and a later read
// resumes exactly where it stopped. Deadlines are enforced lazily here (on
// reads, joins, and result recording); no cron in v1.
export const JOIN_WINDOW_MS = 10 * 60_000;   // no joiner within 10 min -> expired
export const FINISH_WINDOW_MS = 10 * 60_000; // unfinished 10 min after join -> forfeit / void
const id = () => randomBytes(12).toString("hex");
const lc = (w: string) => w.toLowerCase();

export type MatchRow = typeof schema.matches.$inferSelect;
export interface MatchView {
  id: string; gameSlug: string;
  status: string; // open | full | settlement_pending | settled | draw | forfeited | void | expired
  outcome: MatchOutcomeKind | "expired" | null;
  creator: string; joiner: string | null;
  scores: { creator: number | null; joiner: number | null };
  winner: string | null;
  seedCommit: string | null;
  seed: string | null; // revealed only once the match is decided
  refundTx: string[]; treasuryTx: string | null;
  error: string | null;
  createdAt: number; joinedAt: number | null; settledAt: number | null;
}
const FINAL: Record<string, MatchOutcomeKind | "expired"> = {
  settled: "win", draw: "draw", forfeited: "forfeit", void: "void", expired: "expired",
};
function toView(row: MatchRow, scoreA: number | null, scoreB: number | null): MatchView {
  const settling = row.status.startsWith("settling:");
  const kind = settling ? (row.status.slice("settling:".length) as MatchOutcomeKind | "expired")
    : (FINAL[row.status] ?? null);
  const decided = settling || row.status in FINAL;
  return {
    id: row.id, gameSlug: row.gameSlug,
    status: settling ? "settlement_pending" : row.status,
    outcome: kind,
    creator: row.creatorWallet, joiner: row.joinerWallet,
    scores: { creator: scoreA, joiner: scoreB },
    winner: row.winnerWallet,
    seedCommit: row.seedCommit,
    seed: decided ? row.seed : null,
    refundTx: row.refundTx ? row.refundTx.split(",").filter(Boolean) : [],
    treasuryTx: row.treasuryTx,
    error: row.error,
    createdAt: row.createdAt.getTime(),
    joinedAt: row.joinedAt?.getTime() ?? null,
    settledAt: row.settledAt?.getTime() ?? null,
  };
}

export async function getMatchRow(matchId: string): Promise<MatchRow | undefined> {
  const db = await getDb();
  const rows = await db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).limit(1);
  return rows[0];
}
async function scoreForSession(sid: string | null): Promise<number | null> {
  if (!sid) return null;
  const db = await getDb();
  const rows = await db.select({ v: schema.scores.value }).from(schema.scores)
    .where(eq(schema.scores.sessionId, sid)).limit(1);
  return rows[0]?.v ?? null;
}
export async function findActiveMatchFor(wallet: string, gameSlug: string): Promise<MatchRow | undefined> {
  const db = await getDb();
  const w = lc(wallet);
  const rows = await db.select().from(schema.matches).where(and(
    eq(schema.matches.gameSlug, gameSlug),
    inArray(schema.matches.status, ["open", "full"]),
    or(eq(schema.matches.creatorWallet, w), eq(schema.matches.joinerWallet, w)),
  )).limit(1);
  return rows[0];
}

export function newMatchSeed(gameSlug: string): number | null {
  // Only Snake is RNG-driven; both runs of a match share this seed. Stacker and
  // Breaker are deterministic — fair by construction, seed stays null.
  return gameSlug === "snake" ? Math.floor(Math.random() * 2 ** 31) : null;
}

export async function insertMatch(args: { matchId: string; gameSlug: string; creatorWallet: string;
  session: PlaySession; seed: number | null }): Promise<MatchRow> {
  const db = await getDb();
  const row = { id: args.matchId, gameSlug: args.gameSlug, creatorWallet: lc(args.creatorWallet),
    joinerWallet: null, sessionA: args.session.sid, sessionB: null, status: "open",
    seed: args.seed === null ? null : String(args.seed),
    seedCommit: args.session.game.seedCommitment ?? null,
    winnerWallet: null, refundTx: null, treasuryTx: null, error: null,
    joinedAt: null, settledAt: null };
  await db.insert(schema.matches).values(row);
  return { ...row, createdAt: new Date() } as MatchRow;
}

// Claim the joiner slot atomically: only succeeds while the match is open.
export async function claimJoinerSlot(matchId: string, joinerWallet: string): Promise<boolean> {
  const db = await getDb();
  const updated = await db.update(schema.matches)
    .set({ joinerWallet: lc(joinerWallet), status: "full", joinedAt: new Date() })
    .where(and(eq(schema.matches.id, matchId), eq(schema.matches.status, "open")))
    .returning();
  return updated.length > 0;
}
export async function attachJoinerSession(matchId: string, sid: string): Promise<void> {
  const db = await getDb();
  await db.update(schema.matches).set({ sessionB: sid }).where(eq(schema.matches.id, matchId));
}

// ---------------------------------------------------------------------------
// Settlement execution (escrow wallet, on-chain USDC)
// ---------------------------------------------------------------------------
const ERC20_ABI = [
  { type: "function", name: "transfer", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
] as const;
function chainClients() {
  const key = process.env.MATCH_ESCROW_PRIVATE_KEY;
  if (!key) throw new Error("escrow_not_configured");
  const chainId = activeChain();
  const chain = chainId === base.id ? base : baseSepolia;
  const rpc = chainId === base.id ? (process.env.BASE_RPC_URL ?? "https://mainnet.base.org") : "https://sepolia.base.org";
  const account = privateKeyToAccount(key as `0x${string}`);
  return { account, chain, rpc, usdc: CHAINS[chainId].usdc as Address };
}
async function escrowTransfer(to: string, amount: bigint): Promise<string> {
  const { account, chain, rpc, usdc } = chainClients();
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const hash = await wallet.writeContract({ address: usdc, abi: ERC20_ABI, functionName: "transfer", args: [to as Address, amount] });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("transfer_reverted");
  return hash;
}
// Serialize settlements in-process: one escrow wallet, one nonce stream.
let settleChain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = settleChain.then(fn, fn);
  settleChain = run.then(() => {}, () => {});
  return run;
}

interface Decision { kind: MatchOutcomeKind | "expired"; winnerSide: "a" | "b" | null;
  legs: { to: "a" | "b" | "treasury"; amount: bigint }[]; qtrA: number; qtrB: number }
function decisionFor(row: MatchRow, kind: MatchOutcomeKind | "expired"): Decision {
  if (kind === "expired") { const p = expiredPayout(); return { kind, winnerSide: null, ...p }; }
  // Win/forfeit legs depend only on the frozen winner; draw/void are fixed.
  const winnerSide = row.winnerWallet === null ? null
    : row.winnerWallet === row.creatorWallet ? "a" : "b";
  if (kind === "draw" || kind === "void") {
    return { kind, winnerSide: null,
      legs: [{ to: "a", amount: STAKE_ATOMIC }, { to: "b", amount: STAKE_ATOMIC }],
      qtrA: kind === "draw" ? 25 : 0, qtrB: kind === "draw" ? 25 : 0 };
  }
  if (!winnerSide) throw new Error("decision_missing_winner");
  return { kind, winnerSide,
    legs: [{ to: winnerSide, amount: STAKE_ATOMIC }, { to: "treasury", amount: STAKE_ATOMIC }],
    qtrA: winnerSide === "a" ? 25 : 0, qtrB: winnerSide === "b" ? 25 : 0 };
}

// Execute (or resume) the frozen decision for a match in a settling:* state.
async function executeSettlement(matchId: string): Promise<void> {
  const db = await getDb();
  const row = await getMatchRow(matchId);
  if (!row || !row.status.startsWith("settling:")) return;
  const kind = row.status.slice("settling:".length) as MatchOutcomeKind | "expired";
  const addrOf = (to: "a" | "b" | "treasury") =>
    to === "treasury" ? treasury() : to === "a" ? row.creatorWallet : (row.joinerWallet as string);
  try {
    const decision = decisionFor(row, kind);
    const refunds = row.refundTx ? row.refundTx.split(",").filter(Boolean) : [];
    let completed = refunds.length + (row.treasuryTx ? 1 : 0);
    for (let i = completed; i < decision.legs.length; i++) {
      const leg = decision.legs[i];
      const hash = await escrowTransfer(addrOf(leg.to), leg.amount);
      if (leg.to === "treasury") {
        await db.update(schema.matches).set({ treasuryTx: hash }).where(eq(schema.matches.id, matchId));
      } else {
        refunds.push(hash);
        await db.update(schema.matches).set({ refundTx: refunds.join(",") }).where(eq(schema.matches.id, matchId));
      }
      completed++;
    }
    // QTR, exactly once per wallet per match (ledger-checked, so retries are safe).
    const existing = await db.select({ w: schema.rewardsLedger.wallet }).from(schema.rewardsLedger)
      .where(eq(schema.rewardsLedger.refId, matchId));
    const paid = new Set(existing.map((r) => r.w));
    if (decision.qtrA > 0 && !paid.has(row.creatorWallet))
      await accrueMatchReward(row.creatorWallet, matchId, kind === "draw" ? "match_draw" : "match_win");
    if (decision.qtrB > 0 && row.joinerWallet && !paid.has(row.joinerWallet))
      await accrueMatchReward(row.joinerWallet, matchId, kind === "draw" ? "match_draw" : "match_win");
    const finalStatus = kind === "win" ? "settled" : kind === "forfeit" ? "forfeited" : kind;
    await db.update(schema.matches)
      .set({ status: finalStatus, settledAt: new Date(), error: null })
      .where(eq(schema.matches.id, matchId));
  } catch (e) {
    // Never dropped silently: stays in settling:* (public: settlement_pending)
    // with the failure recorded; the next read resumes the remaining legs.
    await db.update(schema.matches)
      .set({ error: (e instanceof Error ? e.message : "settlement_failed").slice(0, 300) })
      .where(eq(schema.matches.id, matchId));
  }
}

// Freeze a decision into the row (status-guarded), then execute it.
async function decideAndSettle(matchId: string, kind: MatchOutcomeKind | "expired",
  winnerWallet: string | null): Promise<void> {
  const db = await getDb();
  const fromStatuses = kind === "expired" ? ["open"] : ["full"];
  const claimed = await db.update(schema.matches)
    .set({ status: "settling:" + kind, winnerWallet })
    .where(and(eq(schema.matches.id, matchId), inArray(schema.matches.status, fromStatuses)))
    .returning();
  if (!claimed.length) return; // another path already decided it
  await serialized(() => executeSettlement(matchId));
}

// ---------------------------------------------------------------------------
// Lazy lifecycle: deadlines, result checks, settlement — driven by reads,
// joins, and recordResult. Reentrancy-guarded (recordResult hooks back in).
// ---------------------------------------------------------------------------
const refreshing = new Set<string>();
export async function refreshMatch(matchId: string): Promise<MatchView | null> {
  let row = await getMatchRow(matchId);
  if (!row) return null;
  if (refreshing.has(matchId)) {
    return toView(row, await scoreForSession(row.sessionA), await scoreForSession(row.sessionB));
  }
  refreshing.add(matchId);
  try {
    const now = Date.now();
    if (row.status === "open" && now - row.createdAt.getTime() > JOIN_WINDOW_MS) {
      await decideAndSettle(matchId, "expired", null);
    } else if (row.status === "full" || row.status.startsWith("settling:")) {
      if (row.status === "full") {
        // Flush any run that ended in memory but was never recorded.
        for (const sid of [row.sessionA, row.sessionB]) {
          if (!sid) continue;
          const s = await getSessionAsync(sid);
          if (s && s.game.isOver && !s.recorded) await recordResult(s);
        }
        const scoreA = await scoreForSession(row.sessionA);
        const scoreB = await scoreForSession(row.sessionB);
        const finishedA = scoreA !== null;
        const finishedB = scoreB !== null;
        const deadlineHit = row.joinedAt !== null && now - row.joinedAt.getTime() > FINISH_WINDOW_MS;
        if ((finishedA && finishedB) || deadlineHit) {
          const out = settleOutcome({ scoreA, scoreB, finishedA, finishedB });
          const winnerWallet = out.winner === "a" ? row.creatorWallet
            : out.winner === "b" ? row.joinerWallet : null;
          await decideAndSettle(matchId, out.kind, winnerWallet);
        }
      } else {
        // settlement_pending: resume the frozen decision's remaining legs.
        await serialized(() => executeSettlement(matchId));
      }
    }
    row = (await getMatchRow(matchId)) ?? row;
    return toView(row, await scoreForSession(row.sessionA), await scoreForSession(row.sessionB));
  } finally {
    refreshing.delete(matchId);
  }
}

export async function onMatchSessionRecorded(matchId: string): Promise<void> {
  await refreshMatch(matchId);
}

export async function listMatches(status?: string): Promise<MatchView[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.matches).orderBy(desc(schema.matches.createdAt)).limit(50);
  const views: MatchView[] = [];
  for (const r of rows) {
    const v = await refreshMatch(r.id);
    if (v && (!status || v.status === status)) views.push(v);
  }
  return views;
}

// Session factory shared by the create/join routes (seeded for snake matches).
export async function createMatchSession(gameSlug: string, wallet: string, matchId: string, seed: number | null) {
  return createPlaySession(gameSlug, wallet, { matchId, ...(seed !== null ? { seed } : {}) });
}
