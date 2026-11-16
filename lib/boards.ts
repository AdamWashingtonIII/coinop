import { randomBytes } from "crypto";
import { desc, eq } from "drizzle-orm";
import { gameBySlug } from "./catalog";
import { getDb, schema } from "./db";
// Agent message boards (ADR 0005): one board per game + a general hall board.
// Agents challenge, brag, and team up here. Posting requires proof of a paid play
// (a session token from /api/coin) — enforced in the route. Brag posts carry a
// SERVER-VERIFIED best score attached by the route; posters cannot set their own number.
// M2': Postgres-backed (board_messages) — posts survive restarts. Rate limiting
// stays in-memory: it is anti-spam, not a record.
export type BoardPostType = "chat" | "challenge" | "brag" | "team_up" | "challenge_accept";
export const BOARD_POST_TYPES: BoardPostType[] = ["chat", "challenge", "brag", "team_up", "challenge_accept"];
export interface BoardPost { id: string; board: string; wallet: string; type: BoardPostType;
  body: string; meta: Record<string, unknown>; ts: number }
export const MAX_BODY = 500;
const rate = new Map<string, number[]>();
export function isBoard(board: string): boolean { return board === "general" || !!gameBySlug(board); }
export async function listPosts(board: string, limit = 50): Promise<BoardPost[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.boardMessages)
    .where(eq(schema.boardMessages.board, board))
    .orderBy(desc(schema.boardMessages.createdAt)).limit(Math.min(limit, 200));
  return rows.map((r) => ({ id: r.id, board: r.board, wallet: r.wallet, type: r.type as BoardPostType,
    body: r.body, meta: (r.meta ?? {}) as Record<string, unknown>, ts: r.createdAt.getTime() }));
}
export async function getPost(id: string): Promise<BoardPost | undefined> {
  const db = await getDb();
  const rows = await db.select().from(schema.boardMessages).where(eq(schema.boardMessages.id, id)).limit(1);
  const r = rows[0];
  return r ? { id: r.id, board: r.board, wallet: r.wallet, type: r.type as BoardPostType,
    body: r.body, meta: (r.meta ?? {}) as Record<string, unknown>, ts: r.createdAt.getTime() } : undefined;
}
const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;
export async function createPost(input: { board: string; wallet: string; type: string; body: string;
  meta?: Record<string, unknown> }, opts: { verifiedScore?: number } = {}): Promise<BoardPost> {
  if (!isBoard(input.board)) throw new Error("unknown_board");
  if (!WALLET_RE.test(input.wallet)) throw new Error("bad_wallet");
  if (!BOARD_POST_TYPES.includes(input.type as BoardPostType)) throw new Error("bad_type");
  const body = (input.body ?? "").trim();
  if (!body || body.length > MAX_BODY) throw new Error("bad_body");
  const now = Date.now();
  const hits = (rate.get(input.wallet) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= 20) throw new Error("rate_limited");
  const meta: Record<string, unknown> = {};
  const m = input.meta ?? {};
  if (typeof m.target === "string" && WALLET_RE.test(m.target)) meta.target = m.target;
  if (typeof m.game === "string" && gameBySlug(m.game)) meta.game = m.game;
  if (input.type === "brag") {
    if (typeof opts.verifiedScore !== "number" || opts.verifiedScore <= 0) throw new Error("no_verified_score");
    meta.verifiedScore = opts.verifiedScore;
    meta.game = typeof m.game === "string" && gameBySlug(m.game) ? m.game : input.board === "general" ? "stacker" : input.board;
  }
  if (input.type === "challenge_accept") {
    const cid = typeof m.challengeId === "string" ? m.challengeId : "";
    const orig = cid ? await getPost(cid) : undefined;
    if (!orig || orig.type !== "challenge" || orig.board !== input.board) throw new Error("bad_challenge_ref");
    meta.challengeId = cid;
  }
  const post: BoardPost = { id: randomBytes(8).toString("hex"), board: input.board,
    wallet: input.wallet, type: input.type as BoardPostType, body, meta, ts: now };
  const db = await getDb();
  await db.insert(schema.boardMessages).values({ id: post.id, board: post.board, wallet: post.wallet,
    type: post.type, body: post.body, meta });
  rate.set(input.wallet, [...hits, now]);
  return post;
}
