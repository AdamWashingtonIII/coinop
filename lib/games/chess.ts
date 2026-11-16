// Chess — a full legal chess engine (ADR 0006 contract). The agent is White;
// the house (Black) replies inside the same act() call from a seeded
// alpha-beta search, so between calls it is always White to move. All rules:
// check/checkmate/stalemate, castling with full legality, en passant (incl.
// the pin case, via make-then-test king safety), promotion, fifty-move and
// threefold-repetition draws, insufficient material, and a 300-half-move cap
// adjudicated on material. Seeded RNG with a published commitment (same
// provable-fairness pattern as Snake) breaks ties between near-equal house
// moves. Correctness is anchored by perft tests in chess.test.ts.
import { createHash } from "crypto";
export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export const CHESS_WIN_BONUS = 150;
export const CHESS_DRAW_BONUS = 40;
export const CHESS_MAX_HALFMOVES = 300;
const HOUSE_DEPTH = 3;
const MATE = 100000;
// Captured-material points for the agent's score (spec: pawns x10 scale).
const SCORE_POINTS: Record<string, number> = { p: 10, n: 30, b: 30, r: 50, q: 90 };
// Search evaluation values (centipawns).
const VALUES: Record<string, number> = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
// Piece-square tables, published rank 8 first (simplified evaluation set).
const PST: Record<string, number[]> = {
  P: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  N: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  B: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  R: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  Q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  K: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};
export interface ChessState {
  slug: "chess"; status: "playing" | "over";
  fen: string;
  score: number;
  capturedByYou: string[]; // black piece letters the agent captured ("p", "n", ...)
  capturedByHouse: string[]; // white piece letters the house captured ("P", "N", ...)
  lastMove: string | null; // UCI of the house's last move
  outcome?: "win" | "draw" | "loss";
  seedCommit: string;
}
interface Pos {
  board: (string | null)[]; // 64 squares, a1 = 0 ... h8 = 63; "P".."K" white, "p".."k" black
  turn: "w" | "b";
  castling: string; // subset of "KQkq", "" if none
  ep: number; // en-passant target square, -1 if none
  halfmove: number;
  fullmove: number;
}
interface Move { from: number; to: number; promo?: string }
const KNIGHT_OFFS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_OFFS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const isWhitePiece = (p: string) => p === p.toUpperCase();
const sqName = (sq: number) => "abcdefgh"[sq % 8] + String(((sq / 8) | 0) + 1);
const sqFromName = (s: string) => (s.charCodeAt(1) - 49) * 8 + (s.charCodeAt(0) - 97);
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// ---------- FEN ----------
export function parseFen(fen: string): Pos {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) throw new Error("invalid_fen");
  const rows = parts[0].split("/");
  if (rows.length !== 8) throw new Error("invalid_fen");
  const board: (string | null)[] = Array(64).fill(null);
  rows.forEach((row, i) => {
    const rank = 7 - i; // FEN lists rank 8 first; our rank 0 is rank 1
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) file += Number(ch);
      else { board[rank * 8 + file] = ch; file++; }
    }
    if (file !== 8) throw new Error("invalid_fen");
  });
  if (parts[1] !== "w" && parts[1] !== "b") throw new Error("invalid_fen");
  return {
    board,
    turn: parts[1],
    castling: parts[2] === "-" ? "" : parts[2],
    ep: parts[3] === "-" ? -1 : sqFromName(parts[3]),
    halfmove: parts.length > 4 ? Number(parts[4]) : 0,
    fullmove: parts.length > 5 ? Number(parts[5]) : 1,
  };
}
function placementFen(pos: Pos): string {
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = "", empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = pos.board[rank * 8 + file];
      if (!p) empty++;
      else { if (empty) { row += String(empty); empty = 0; } row += p; }
    }
    if (empty) row += String(empty);
    rows.push(row);
  }
  return rows.join("/");
}
export function toFen(pos: Pos): string {
  return [placementFen(pos), pos.turn, pos.castling || "-", pos.ep >= 0 ? sqName(pos.ep) : "-",
    String(pos.halfmove), String(pos.fullmove)].join(" ");
}
// ---------- Attacks & move generation ----------
export function isAttacked(board: (string | null)[], sq: number, byWhite: boolean): boolean {
  const f = sq % 8, r = (sq / 8) | 0;
  const pr = byWhite ? r - 1 : r + 1; // a pawn that attacks sq stands one rank behind it
  if (pr >= 0 && pr < 8) for (const df of [-1, 1]) {
    const pf = f + df;
    if (pf >= 0 && pf < 8 && board[pr * 8 + pf] === (byWhite ? "P" : "p")) return true;
  }
  for (const [df, dr] of KNIGHT_OFFS) {
    const nf = f + df, nr = r + dr;
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8 && board[nr * 8 + nf] === (byWhite ? "N" : "n")) return true;
  }
  for (const [df, dr] of KING_OFFS) {
    const nf = f + df, nr = r + dr;
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8 && board[nr * 8 + nf] === (byWhite ? "K" : "k")) return true;
  }
  const scan = (dirs: number[][], kinds: string[]) => {
    for (const [df, dr] of dirs) {
      let nf = f + df, nr = r + dr;
      while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
        const p = board[nr * 8 + nf];
        if (p) { if (kinds.includes(p)) return true; break; }
        nf += df; nr += dr;
      }
    }
    return false;
  };
  return scan(DIAG, byWhite ? ["B", "Q"] : ["b", "q"]) || scan(ORTHO, byWhite ? ["R", "Q"] : ["r", "q"]);
}
export function isInCheck(pos: Pos, color: "w" | "b"): boolean {
  const ksq = pos.board.indexOf(color === "w" ? "K" : "k");
  return ksq >= 0 && isAttacked(pos.board, ksq, color !== "w");
}
function genPseudo(pos: Pos): Move[] {
  const moves: Move[] = [];
  const { board, turn } = pos;
  const white = turn === "w";
  for (let sq = 0; sq < 64; sq++) {
    const piece = board[sq];
    if (!piece || isWhitePiece(piece) !== white) continue;
    const f = sq % 8, r = (sq / 8) | 0;
    const kind = piece.toUpperCase();
    if (kind === "P") {
      const dir = white ? 8 : -8;
      const startRank = white ? 1 : 6;
      const promoRank = white ? 7 : 0;
      const one = sq + dir;
      if (!board[one]) {
        if (((one / 8) | 0) === promoRank) for (const pr of ["q", "r", "b", "n"]) moves.push({ from: sq, to: one, promo: pr });
        else {
          moves.push({ from: sq, to: one });
          const two = sq + 2 * dir;
          if (r === startRank && !board[two]) moves.push({ from: sq, to: two });
        }
      }
      for (const df of [-1, 1]) {
        const nf = f + df;
        if (nf < 0 || nf > 7) continue;
        const to = sq + dir + df;
        const target = board[to];
        if (target && isWhitePiece(target) !== white) {
          if (((to / 8) | 0) === promoRank) for (const pr of ["q", "r", "b", "n"]) moves.push({ from: sq, to, promo: pr });
          else moves.push({ from: sq, to });
        } else if (!target && to === pos.ep) moves.push({ from: sq, to }); // en passant
      }
    } else if (kind === "N" || kind === "K") {
      for (const [df, dr] of kind === "N" ? KNIGHT_OFFS : KING_OFFS) {
        const nf = f + df, nr = r + dr;
        if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
        const to = nr * 8 + nf, t = board[to];
        if (!t || isWhitePiece(t) !== white) moves.push({ from: sq, to });
      }
      if (kind === "K") { // castling: rights + rook + empty path + unattacked king path
        const home = white ? 4 : 60;
        if (sq === home) {
          const foe = !white;
          const safe = (s: number) => !isAttacked(board, s, foe);
          if (pos.castling.includes(white ? "K" : "k") && board[home + 3] === (white ? "R" : "r")
            && !board[home + 1] && !board[home + 2] && safe(home) && safe(home + 1) && safe(home + 2))
            moves.push({ from: sq, to: home + 2 });
          if (pos.castling.includes(white ? "Q" : "q") && board[home - 4] === (white ? "R" : "r")
            && !board[home - 1] && !board[home - 2] && !board[home - 3] && safe(home) && safe(home - 1) && safe(home - 2))
            moves.push({ from: sq, to: home - 2 });
        }
      }
    } else {
      const dirs = kind === "B" ? DIAG : kind === "R" ? ORTHO : [...DIAG, ...ORTHO];
      for (const [df, dr] of dirs) {
        let nf = f + df, nr = r + dr;
        while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
          const to = nr * 8 + nf, t = board[to];
          if (!t) moves.push({ from: sq, to });
          else { if (isWhitePiece(t) !== white) moves.push({ from: sq, to }); break; }
          nf += df; nr += dr;
        }
      }
    }
  }
  return moves;
}
export function makeMove(pos: Pos, m: Move): Pos {
  const board = pos.board.slice();
  const piece = board[m.from]!;
  const white = pos.turn === "w";
  let captured = board[m.to];
  if ((piece === "P" || piece === "p") && pos.ep >= 0 && m.to === pos.ep && !captured && (m.from % 8) !== (m.to % 8)) {
    const capSq = m.to + (white ? -8 : 8); // the pawn that double-pushed stands behind the ep square
    captured = board[capSq];
    board[capSq] = null;
  }
  board[m.from] = null;
  board[m.to] = m.promo ? (white ? m.promo.toUpperCase() : m.promo) : piece;
  if ((piece === "K" || piece === "k") && Math.abs(m.to - m.from) === 2) { // castling: bring the rook over
    if (m.to > m.from) { board[m.from + 1] = board[m.from + 3]; board[m.from + 3] = null; }
    else { board[m.from - 1] = board[m.from - 4]; board[m.from - 4] = null; }
  }
  let castling = pos.castling;
  const strip = (ch: string) => { castling = castling.replace(ch, ""); };
  if (piece === "K") { strip("K"); strip("Q"); }
  if (piece === "k") { strip("k"); strip("q"); }
  if (m.from === 0 || m.to === 0) strip("Q"); // rook leaves / is captured on a1
  if (m.from === 7 || m.to === 7) strip("K");
  if (m.from === 56 || m.to === 56) strip("q");
  if (m.from === 63 || m.to === 63) strip("k");
  const ep = (piece === "P" || piece === "p") && Math.abs(m.to - m.from) === 16 ? (m.to + m.from) / 2 : -1;
  return {
    board, turn: white ? "b" : "w", castling, ep,
    halfmove: piece === "P" || piece === "p" || captured ? 0 : pos.halfmove + 1,
    fullmove: pos.fullmove + (white ? 0 : 1),
  };
}
export function legalMovesPos(pos: Pos): Move[] {
  return genPseudo(pos).filter((m) => !isInCheck(makeMove(pos, m), pos.turn));
}
export const toUci = (m: Move): string => sqName(m.from) + sqName(m.to) + (m.promo ?? "");
export function perft(fen: string, depth: number): number {
  const rec = (pos: Pos, d: number): number => {
    if (d === 0) return 1;
    const moves = legalMovesPos(pos);
    if (d === 1) return moves.length;
    let nodes = 0;
    for (const m of moves) nodes += rec(makeMove(pos, m), d - 1);
    return nodes;
  };
  return rec(parseFen(fen), depth);
}
// ---------- Draw rules & evaluation ----------
export function insufficientMaterial(pos: Pos): boolean {
  const minors: { kind: string; colorBit: number }[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.board[sq];
    if (!p) continue;
    const kind = p.toUpperCase();
    if (kind === "P" || kind === "R" || kind === "Q") return false;
    if (kind === "B" || kind === "N") minors.push({ kind, colorBit: (sq % 8 + ((sq / 8) | 0)) % 2 });
  }
  if (minors.length <= 1) return true; // bare kings, or one lone minor piece
  // K+B vs K+B (or more bishops) with every bishop on the same square color can never mate.
  return minors.every((m) => m.kind === "B") && minors.every((m) => m.colorBit === minors[0].colorBit);
}
function materialBalance(pos: Pos): number { // white minus black, search values, kings excluded
  let s = 0;
  for (const p of pos.board) if (p && p.toUpperCase() !== "K") s += isWhitePiece(p) ? VALUES[p.toUpperCase()] : -VALUES[p.toUpperCase()];
  return s;
}
function evaluate(pos: Pos): number { // centipawns from White's perspective
  let s = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.board[sq];
    if (!p) continue;
    const kind = p.toUpperCase();
    const f = sq % 8, r = (sq / 8) | 0;
    const v = VALUES[kind] + PST[kind][isWhitePiece(p) ? (7 - r) * 8 + f : r * 8 + f];
    s += isWhitePiece(p) ? v : -v;
  }
  return s;
}
function orderMoves(pos: Pos, moves: Move[]): Move[] {
  const score = (m: Move) => {
    let s = 0;
    const victim = pos.board[m.to];
    if (victim) s += 10 * VALUES[victim.toUpperCase()] - VALUES[(pos.board[m.from] ?? "P").toUpperCase()] / 10;
    else if (m.to === pos.ep && (pos.board[m.from] ?? "").toUpperCase() === "P") s += 10 * VALUES.P;
    if (m.promo) s += VALUES[m.promo.toUpperCase()];
    return s;
  };
  return [...moves].sort((a, b) => score(b) - score(a));
}
function negamax(pos: Pos, depth: number, alpha: number, beta: number, ply: number): number {
  if (pos.halfmove >= 100) return 0;
  if (depth === 0) return (pos.turn === "w" ? 1 : -1) * evaluate(pos);
  const moves = legalMovesPos(pos);
  if (moves.length === 0) return isInCheck(pos, pos.turn) ? -MATE + ply : 0; // mated (prefer fast mate) or stalemate
  let best = -Infinity;
  for (const m of orderMoves(pos, moves)) {
    const v = -negamax(makeMove(pos, m), depth - 1, -beta, -alpha, ply + 1);
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}
function houseChoose(pos: Pos, rng: () => number): Move | null {
  const moves = legalMovesPos(pos);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];
  let best = -Infinity;
  const scored: { m: Move; v: number }[] = [];
  for (const m of orderMoves(pos, moves)) {
    const v = -negamax(makeMove(pos, m), HOUSE_DEPTH - 1, -Infinity, Infinity, 1);
    scored.push({ m, v });
    if (v > best) best = v;
  }
  const near = scored.filter((s) => s.v >= best - 15); // seeded pick among near-equal best moves
  return near[Math.floor(rng() * near.length)].m;
}
// Repetition key: same placement/turn/rights; the ep square only counts when a
// pawn of the side to move actually stands where it could capture en passant.
function repKey(pos: Pos): string {
  let epPart = "-";
  if (pos.ep >= 0) {
    const ef = pos.ep % 8;
    const pawnRank = pos.turn === "w" ? 4 : 3;
    const pawn = pos.turn === "w" ? "P" : "p";
    for (const df of [-1, 1]) {
      const f = ef + df;
      if (f >= 0 && f < 8 && pos.board[pawnRank * 8 + f] === pawn) { epPart = sqName(pos.ep); break; }
    }
  }
  return placementFen(pos) + " " + pos.turn + " " + (pos.castling || "-") + " " + epPart;
}
const pliesTotal = (pos: Pos) => (pos.fullmove - 1) * 2 + (pos.turn === "b" ? 1 : 0);
// ---------- The game ----------
export class ChessGame {
  readonly slug = "chess" as const;
  private pos: Pos = parseFen(START_FEN);
  private capturedByYou: string[] = [];
  private capturedByHouse: string[] = [];
  private lastMove: string | null = null;
  private outcome: "win" | "draw" | "loss" | undefined;
  private bonus = 0;
  private over = false;
  private rep = new Map<string, number>();
  private rng: () => number;
  private seedValue: number;
  readonly seedCommitment: string;
  private bornAt: number;
  private snaps: ChessState[] = [];
  private log: { atMs: number; action: string }[] = [];
  constructor(private now: () => number = Date.now, seed = Math.floor(Math.random() * 2 ** 31)) {
    this.seedValue = seed;
    this.seedCommitment = createHash("sha256").update("coinop-chess-seed:" + seed).digest("hex");
    this.rng = mulberry32(seed);
    this.bornAt = now();
    this.rep.set(repKey(this.pos), 1);
    this.settle();
    this.snaps.push(this.snapshot());
  }
  static fromFen(fen: string, now: () => number = Date.now, seed = Math.floor(Math.random() * 2 ** 31)): ChessGame {
    const g = new ChessGame(now, seed);
    g.pos = parseFen(fen);
    g.capturedByYou = []; g.capturedByHouse = [];
    g.lastMove = null; g.outcome = undefined; g.bonus = 0; g.over = false;
    g.rep = new Map([[repKey(g.pos), 1]]);
    g.log = []; g.snaps = [];
    if (!g.settle() && g.pos.turn === "b") { g.houseReply(); g.settle(); } // keep the White-to-move invariant
    g.snaps.push(g.snapshot());
    return g;
  }
  legalMoves(): string[] { return legalMovesPos(this.pos).map(toUci); }
  private finish(outcome: "win" | "draw" | "loss", bonus: number): boolean {
    this.outcome = outcome; this.bonus = bonus; this.over = true;
    return true;
  }
  // Terminal / draw adjudication for the current position. Returns true if over.
  private settle(): boolean {
    if (this.over) return true;
    if (legalMovesPos(this.pos).length === 0) {
      if (isInCheck(this.pos, this.pos.turn)) // side to move is checkmated
        return this.pos.turn === "b" ? this.finish("win", CHESS_WIN_BONUS) : this.finish("loss", 0);
      return this.finish("draw", CHESS_DRAW_BONUS); // stalemate
    }
    if (insufficientMaterial(this.pos)) return this.finish("draw", CHESS_DRAW_BONUS);
    if (this.pos.halfmove >= 100) return this.finish("draw", CHESS_DRAW_BONUS); // fifty-move rule
    if ((this.rep.get(repKey(this.pos)) ?? 0) >= 3) return this.finish("draw", CHESS_DRAW_BONUS); // threefold
    if (pliesTotal(this.pos) >= CHESS_MAX_HALFMOVES) { // move cap: adjudicate on material, no mate bonus
      const diff = materialBalance(this.pos);
      return diff > 0 ? this.finish("win", 0) : diff < 0 ? this.finish("loss", 0) : this.finish("draw", CHESS_DRAW_BONUS);
    }
    return false;
  }
  private applyMove(m: Move): void {
    const piece = this.pos.board[m.from];
    let captured = this.pos.board[m.to];
    if (!captured && (piece === "P" || piece === "p") && m.to === this.pos.ep && this.pos.ep >= 0 && (m.from % 8) !== (m.to % 8))
      captured = this.pos.board[m.to + (this.pos.turn === "w" ? -8 : 8)];
    if (captured) (this.pos.turn === "w" ? this.capturedByYou : this.capturedByHouse).push(captured);
    this.pos = makeMove(this.pos, m);
    const k = repKey(this.pos);
    this.rep.set(k, (this.rep.get(k) ?? 0) + 1);
  }
  private houseReply(): void {
    const m = houseChoose(this.pos, this.rng);
    if (!m) return;
    this.applyMove(m);
    this.lastMove = toUci(m);
  }
  private currentScore(): number {
    return this.capturedByYou.reduce((a, c) => a + (SCORE_POINTS[c] ?? 0), 0) + this.bonus;
  }
  private snapshot(): ChessState {
    return { slug: "chess", status: this.over ? "over" : "playing",
      fen: toFen(this.pos), score: this.currentScore(),
      capturedByYou: [...this.capturedByYou], capturedByHouse: [...this.capturedByHouse],
      lastMove: this.lastMove,
      ...(this.outcome ? { outcome: this.outcome } : {}),
      seedCommit: this.seedCommitment };
  }
  state(): ChessState { return this.snapshot(); }
  act(action: string): ChessState {
    if (!/^move_[a-h][1-8][a-h][1-8][qrbn]?$/.test(action)) throw new Error("unknown_action");
    if (this.over) throw new Error("game_over");
    const uci = action.slice(5);
    const mv = legalMovesPos(this.pos).find((x) => toUci(x) === uci);
    if (!mv) throw new Error("illegal_move");
    this.log.push({ atMs: this.now() - this.bornAt, action });
    this.applyMove(mv);
    if (!this.settle()) { this.houseReply(); this.settle(); }
    const st = this.snapshot();
    this.snaps.push(st);
    return st;
  }
  revealSeed(): string { return String(this.seedValue); }
  snapshots(): ChessState[] { return this.snaps; }
  actionLog(): { atMs: number; action: string }[] { return this.log; }
  get isOver() { return this.over; }
  get finalScore() { return this.currentScore(); }
}
export const CHESS_MANIFEST = {
  slug: "chess", title: "CHESS", priceAtomic: "250000", asset: "USDC",
  tickMs: 0, maxDurationSeconds: 600,
  actions: ["move_<uci> — e.g. move_e2e4, promotion move_e7e8q"],
  stateDescription: "fen: full FEN of the position after the house's reply (always White to move while playing); you are White, the house is Black and answers every move. score: captured black material (pawn 10, knight 30, bishop 30, rook 50, queen 90) + 150 for checkmate, +40 for a draw. Draws: stalemate, fifty-move, threefold repetition, insufficient material. At 300 half-moves the game is adjudicated on material (win = ahead, no mate bonus). lastMove: the house's last move in UCI; capturedByYou/capturedByHouse list captured piece letters",
  license: "Original — COINOP",
};
