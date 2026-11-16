// Versus settlement math (ADR 0009) — pure, no I/O, fully unit-tested.
// The operator's economics, exact: each player stakes 0.25 USDC into escrow. The winner
// gets their own 0.25 back plus 25 QTR; the loser's 0.25 goes to the treasury.
// No other rake. A draw refunds both and pays both 25 QTR. A player who does
// not finish by the deadline forfeits (finisher wins on the same terms); if
// neither finishes the match is void (both refunded, no QTR). An unjoined
// match expires (creator refunded, no QTR).
// Conservation invariant: in every two-player outcome the legs sum to exactly
// 500000 atomic (2 x stake); in the expired outcome to exactly 250000.
export const STAKE_ATOMIC = 250000n;
export const MATCH_QTR = 25;

export type MatchSide = "a" | "b"; // a = creator, b = joiner
export type MatchOutcomeKind = "win" | "draw" | "forfeit" | "void";
export interface SettleLeg { to: MatchSide | "treasury"; amount: bigint }
export interface SettleResult {
  kind: MatchOutcomeKind;
  winner: MatchSide | null;
  // Execution order matters and is part of the contract: refund legs first
  // (creator leg before joiner leg), the treasury leg always last. Settlement
  // persists each completed leg, so a retry resumes at legs[completed].
  legs: SettleLeg[];
  qtrA: number;
  qtrB: number;
}
export interface SettleInput {
  scoreA: number | null;
  scoreB: number | null;
  finishedA: boolean;
  finishedB: boolean;
}

export function settleOutcome(input: SettleInput): SettleResult {
  const { scoreA, scoreB, finishedA, finishedB } = input;
  if (finishedA && finishedB) {
    const a = scoreA ?? 0;
    const b = scoreB ?? 0;
    if (a === b) {
      return { kind: "draw", winner: null,
        legs: [{ to: "a", amount: STAKE_ATOMIC }, { to: "b", amount: STAKE_ATOMIC }],
        qtrA: MATCH_QTR, qtrB: MATCH_QTR };
    }
    const winner: MatchSide = a > b ? "a" : "b";
    return { kind: "win", winner,
      legs: [{ to: winner, amount: STAKE_ATOMIC }, { to: "treasury", amount: STAKE_ATOMIC }],
      qtrA: winner === "a" ? MATCH_QTR : 0, qtrB: winner === "b" ? MATCH_QTR : 0 };
  }
  if (finishedA || finishedB) {
    const winner: MatchSide = finishedA ? "a" : "b";
    return { kind: "forfeit", winner,
      legs: [{ to: winner, amount: STAKE_ATOMIC }, { to: "treasury", amount: STAKE_ATOMIC }],
      qtrA: winner === "a" ? MATCH_QTR : 0, qtrB: winner === "b" ? MATCH_QTR : 0 };
  }
  return { kind: "void", winner: null,
    legs: [{ to: "a", amount: STAKE_ATOMIC }, { to: "b", amount: STAKE_ATOMIC }],
    qtrA: 0, qtrB: 0 };
}

// Unjoined match past the join deadline: the lone stake goes back to the creator.
export function expiredPayout(): { legs: SettleLeg[]; qtrA: number; qtrB: number } {
  return { legs: [{ to: "a", amount: STAKE_ATOMIC }], qtrA: 0, qtrB: 0 };
}
