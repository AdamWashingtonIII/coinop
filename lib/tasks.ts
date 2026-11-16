import { randomBytes } from "crypto";
import { and, desc, eq, lt, ne, sql } from "drizzle-orm";
import { verifyMessage, type Address } from "viem";
import { getDb, schema } from "./db";
import { availableToClaim, taskLedger } from "./rewards";
import { isLiveEngine } from "./games/engine";
// The Exchange (ADR 0013): an open agent-to-agent task market. Posters lock a
// QTR bounty in the rewards ledger; workers claim, submit, and are paid on
// acceptance (custom tasks) or on server verification (arcade_score tasks).
// Every mutation is wallet-signed with a one-time nonce, mirroring claims.
export const TASK_MESSAGE = (wallet: string, nonce: string) => `COINOP task:${wallet.toLowerCase()}:${nonce}`;
const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;
const id = () => randomBytes(12).toString("hex");
export const FEE_RATE = 0.10;
export const MIN_BOUNTY = 10, MAX_BOUNTY = 1000;
export const CLAIM_HOLD_MS = 2 * 3600_000;
export const MAX_ACTIVE_CLAIMS = 3;
const treasury = () => (process.env.TREASURY_ADDRESS ?? "").toLowerCase();

export type TaskType = "arcade_score" | "custom";
export type TaskStatus = "open" | "claimed" | "submitted" | "settled" | "refunded" | "expired";
export interface Task {
  id: string; poster: string; worker: string | null; type: TaskType; title: string; description: string;
  bounty: number; fee: number; status: TaskStatus; spec: Record<string, unknown>;
  submission: string | null; rejectReason: string | null;
  deadline: number; claimExpires: number | null; createdAt: number;
  claimedAt: number | null; submittedAt: number | null; settledAt: number | null;
}
type Row = typeof schema.tasks.$inferSelect;
const toTask = (r: Row): Task => ({
  id: r.id, poster: r.poster, worker: r.worker, type: r.type as TaskType, title: r.title, description: r.description,
  bounty: r.bounty, fee: Math.floor(r.bounty * FEE_RATE), status: r.status as TaskStatus,
  spec: (r.spec as Record<string, unknown>) ?? {}, submission: r.submission, rejectReason: r.rejectReason,
  deadline: r.deadline.getTime(), claimExpires: r.claimExpires?.getTime() ?? null, createdAt: r.createdAt.getTime(),
  claimedAt: r.claimedAt?.getTime() ?? null, submittedAt: r.submittedAt?.getTime() ?? null, settledAt: r.settledAt?.getTime() ?? null,
});

// ---------- wallet-signature auth (one-time nonces, same shape as claims) ----------
export async function issueTaskNonce(wallet: string): Promise<{ nonce: string; message: string; expiresAt: number }> {
  if (!WALLET_RE.test(wallet)) throw new Error("bad_wallet");
  const db = await getDb();
  const w = wallet.toLowerCase();
  await db.delete(schema.taskNonces).where(lt(schema.taskNonces.exp, new Date()));
  const nonce = randomBytes(16).toString("hex");
  const exp = new Date(Date.now() + 5 * 60_000);
  await db.insert(schema.taskNonces).values({ nonce, wallet: w, exp });
  return { nonce, message: TASK_MESSAGE(w, nonce), expiresAt: exp.getTime() };
}
async function verifyTaskAuth(wallet: string, nonce: string, signature: string): Promise<string> {
  if (!WALLET_RE.test(wallet)) throw new Error("bad_wallet");
  const db = await getDb();
  const w = wallet.toLowerCase();
  const rows = await db.select().from(schema.taskNonces).where(eq(schema.taskNonces.nonce, nonce)).limit(1);
  const row = rows[0];
  if (!row || row.wallet !== w) throw new Error("bad_nonce");
  if (row.exp.getTime() < Date.now()) { await db.delete(schema.taskNonces).where(eq(schema.taskNonces.nonce, nonce)); throw new Error("nonce_expired"); }
  const ok = await verifyMessage({ address: wallet as Address, message: TASK_MESSAGE(w, nonce), signature: signature as `0x${string}` }).catch(() => false);
  if (!ok) throw new Error("bad_signature");
  await db.delete(schema.taskNonces).where(eq(schema.taskNonces.nonce, nonce)); // single-use
  return w;
}

// ---------- expiry: money never sits in a dead task ----------
// Runs at the top of reads and mutations. An unclaimed task past its deadline
// refunds the poster; a claimed task whose 2h hold lapses reopens (or expires
// if the deadline has also passed); a claimed task past deadline refunds.
export async function settleExpired(now = Date.now()): Promise<void> {
  const db = await getDb();
  const rows = await db.select().from(schema.tasks).where(inArrayStatus());
  for (const r of rows) {
    const deadline = r.deadline.getTime();
    if (r.status === "open" && deadline <= now) {
      await refund(r, "expired");
    } else if (r.status === "claimed") {
      const holdLapsed = r.claimExpires !== null && r.claimExpires.getTime() <= now;
      if (deadline <= now) await refund(r, "expired");
      else if (holdLapsed) {
        await db.update(schema.tasks).set({ status: "open", worker: null, claimedAt: null, claimExpires: null })
          .where(and(eq(schema.tasks.id, r.id), eq(schema.tasks.status, "claimed")));
      }
    }
  }
}
function inArrayStatus() {
  return sql`${schema.tasks.status} in ('open','claimed')`;
}
async function refund(r: Row, status: "refunded" | "expired"): Promise<void> {
  const db = await getDb();
  const upd = await db.update(schema.tasks).set({ status, settledAt: new Date() })
    .where(and(eq(schema.tasks.id, r.id), sql`${schema.tasks.status} in ('open','claimed')`)).returning();
  if (upd.length) await taskLedger(r.poster, r.bounty, "task_refund", r.id);
}
async function payOut(r: Row): Promise<void> {
  const fee = Math.floor(r.bounty * FEE_RATE);
  await taskLedger(r.worker!, r.bounty - fee, "task_pay", r.id);
  const t = treasury();
  if (t && fee > 0) await taskLedger(t, fee, "task_fee", r.id);
}

// ---------- mutations ----------
export interface PostInput { type: TaskType; title: string; description: string; bounty: number; deadlineHours: number; spec?: Record<string, unknown> }
export async function postTask(wallet: string, nonce: string, signature: string, input: PostInput): Promise<Task> {
  const w = await verifyTaskAuth(wallet, nonce, signature);
  await settleExpired();
  const title = String(input.title ?? "").trim().slice(0, 120);
  const description = String(input.description ?? "").trim().slice(0, 2000);
  if (!title || !description) throw new Error("missing_fields");
  if (input.type !== "arcade_score" && input.type !== "custom") throw new Error("bad_type");
  const bounty = Math.floor(Number(input.bounty));
  if (!Number.isFinite(bounty) || bounty < MIN_BOUNTY || bounty > MAX_BOUNTY) throw new Error("bad_bounty");
  const hours = Number(input.deadlineHours);
  if (!Number.isFinite(hours) || hours < 1 || hours > 168) throw new Error("bad_deadline");
  const spec: Record<string, unknown> = {};
  if (input.type === "arcade_score") {
    const slug = String(input.spec?.gameSlug ?? "");
    const minScore = Math.floor(Number(input.spec?.minScore));
    if (!isLiveEngine(slug)) throw new Error("bad_game");
    if (!Number.isFinite(minScore) || minScore < 1 || minScore > 100000) throw new Error("bad_min_score");
    spec.gameSlug = slug; spec.minScore = minScore;
  }
  if ((await availableToClaim(w)) < bounty) throw new Error("insufficient_qtr");
  const db = await getDb();
  const t: Row = { id: id(), poster: w, worker: null, type: input.type, title, description, bounty,
    status: "open", spec, submission: null, rejectReason: null,
    deadline: new Date(Date.now() + hours * 3600_000), claimExpires: null,
    createdAt: new Date(), claimedAt: null, submittedAt: null, settledAt: null } as Row;
  await db.insert(schema.tasks).values(t);
  await taskLedger(w, -bounty, "task_lock", t.id);
  return toTask(t);
}

async function getRow(taskId: string): Promise<Row> {
  const db = await getDb();
  const rows = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
  if (!rows[0]) throw new Error("task_not_found");
  return rows[0];
}

export async function claimTask(wallet: string, nonce: string, signature: string, taskId: string): Promise<Task> {
  const w = await verifyTaskAuth(wallet, nonce, signature);
  await settleExpired();
  const r = await getRow(taskId);
  if (r.status !== "open") throw new Error("not_open");
  if (r.poster === w) throw new Error("self_claim");
  const db = await getDb();
  const active = await db.select({ id: schema.tasks.id }).from(schema.tasks)
    .where(and(eq(schema.tasks.worker, w), eq(schema.tasks.status, "claimed")));
  if (active.length >= MAX_ACTIVE_CLAIMS) throw new Error("too_many_claims");
  const upd = await db.update(schema.tasks)
    .set({ status: "claimed", worker: w, claimedAt: new Date(), claimExpires: new Date(Date.now() + CLAIM_HOLD_MS) })
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.status, "open"))).returning();
  if (!upd.length) throw new Error("not_open");
  return toTask(upd[0]);
}

export async function submitTask(wallet: string, nonce: string, signature: string, taskId: string, submission: string): Promise<Task> {
  const w = await verifyTaskAuth(wallet, nonce, signature);
  await settleExpired();
  const r = await getRow(taskId);
  if (r.status !== "claimed" || r.worker !== w) throw new Error("not_your_claim");
  if (r.deadline.getTime() <= Date.now()) throw new Error("past_deadline");
  const db = await getDb();
  if (r.type === "arcade_score") {
    const sid = String(submission ?? "").trim();
    const spec = (r.spec as Record<string, unknown>) ?? {};
    // scores.wallet is stored as the payment authorization spelled it
    // (checksummed) — compare case-insensitively or real runs never match.
    const rows = await db.select().from(schema.scores).where(and(
      eq(schema.scores.sessionId, sid), sql`lower(${schema.scores.wallet}) = ${w}`,
      eq(schema.scores.gameSlug, String(spec.gameSlug ?? "")), eq(schema.scores.verified, true))).limit(1);
    const s = rows[0];
    // 15s of grace on the claim-time comparison: claimedAt is written from an
    // app instance's clock while scores.created_at is the database's, and the
    // two can skew by seconds on a fast claim-and-play. Far too small a window
    // to pre-play a run in, large enough to absorb the skew.
    if (!s || s.value < Number(spec.minScore ?? 0) || s.createdAt.getTime() < (r.claimedAt?.getTime() ?? 0) - 15_000)
      throw new Error("verification_failed");
    const upd = await db.update(schema.tasks)
      .set({ status: "settled", submission: sid, submittedAt: new Date(), settledAt: new Date() })
      .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.status, "claimed"))).returning();
    if (!upd.length) throw new Error("not_your_claim");
    await payOut(upd[0]);
    return toTask(upd[0]);
  }
  const text = String(submission ?? "").trim().slice(0, 4000);
  if (!text) throw new Error("empty_submission");
  const upd = await db.update(schema.tasks).set({ status: "submitted", submission: text, submittedAt: new Date() })
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.status, "claimed"))).returning();
  if (!upd.length) throw new Error("not_your_claim");
  return toTask(upd[0]);
}

export async function acceptTask(wallet: string, nonce: string, signature: string, taskId: string): Promise<Task> {
  const w = await verifyTaskAuth(wallet, nonce, signature);
  await settleExpired();
  const r = await getRow(taskId);
  if (r.poster !== w) throw new Error("not_poster");
  if (r.status !== "submitted") throw new Error("not_submitted");
  const db = await getDb();
  const upd = await db.update(schema.tasks).set({ status: "settled", settledAt: new Date() })
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.status, "submitted"))).returning();
  if (!upd.length) throw new Error("not_submitted");
  await payOut(upd[0]);
  return toTask(upd[0]);
}

export async function rejectTask(wallet: string, nonce: string, signature: string, taskId: string, reason: string): Promise<Task> {
  const w = await verifyTaskAuth(wallet, nonce, signature);
  await settleExpired();
  const r = await getRow(taskId);
  if (r.poster !== w) throw new Error("not_poster");
  if (r.status !== "submitted") throw new Error("not_submitted");
  const db = await getDb();
  const upd = await db.update(schema.tasks)
    .set({ status: "refunded", rejectReason: String(reason ?? "").trim().slice(0, 300) || null, settledAt: new Date() })
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.status, "submitted"))).returning();
  if (!upd.length) throw new Error("not_submitted");
  await taskLedger(w, r.bounty, "task_refund", taskId);
  return toTask(upd[0]);
}

export async function cancelTask(wallet: string, nonce: string, signature: string, taskId: string): Promise<Task> {
  const w = await verifyTaskAuth(wallet, nonce, signature);
  await settleExpired();
  const r = await getRow(taskId);
  if (r.poster !== w) throw new Error("not_poster");
  if (r.status !== "open") throw new Error("not_open");
  await refund(r, "refunded");
  return toTask(await getRow(taskId));
}

// ---------- reads ----------
export async function listTasks(filter: { status?: string; wallet?: string } = {}): Promise<Task[]> {
  await settleExpired();
  const db = await getDb();
  const conds = [];
  if (filter.status) conds.push(eq(schema.tasks.status, filter.status));
  if (filter.wallet) { const w = filter.wallet.toLowerCase(); conds.push(sql`(${schema.tasks.poster} = ${w} or ${schema.tasks.worker} = ${w})`); }
  const rows = await db.select().from(schema.tasks)
    .where(conds.length ? and(...conds) : undefined).orderBy(desc(schema.tasks.createdAt)).limit(200);
  return rows.map(toTask);
}
export async function getTask(taskId: string): Promise<Task> {
  await settleExpired();
  return toTask(await getRow(taskId));
}
export async function taskStats(): Promise<{ posted: number; settled: number; openNow: number; qtrVolume: number; feesEarned: number }> {
  await settleExpired();
  const db = await getDb();
  const all = await db.select({ status: schema.tasks.status, bounty: schema.tasks.bounty }).from(schema.tasks);
  const settled = all.filter((t) => t.status === "settled");
  return { posted: all.length, settled: settled.length, openNow: all.filter((t) => t.status === "open").length,
    qtrVolume: settled.reduce((a, t) => a + t.bounty, 0), feesEarned: settled.reduce((a, t) => a + Math.floor(t.bounty * FEE_RATE), 0) };
}

// ---------- agent directory + profiles ----------
export interface AgentProfile { wallet: string; name: string | null; capabilities: string[]; blurb: string | null }
export interface DirectoryEntry extends AgentProfile {
  tasksPosted: number; tasksCompleted: number; tasksRejected: number; qtrEarned: number; playsRecorded: number; firstSeen: number | null;
}
export async function setProfile(wallet: string, nonce: string, signature: string, input: { name?: string; capabilities?: string[]; blurb?: string }): Promise<AgentProfile> {
  const w = await verifyTaskAuth(wallet, nonce, signature);
  const name = String(input.name ?? "").trim().slice(0, 40) || null;
  const blurb = String(input.blurb ?? "").trim().slice(0, 280) || null;
  const capabilities = Array.isArray(input.capabilities)
    ? input.capabilities.map((c) => String(c).trim().slice(0, 40)).filter(Boolean).slice(0, 12) : [];
  const db = await getDb();
  await db.insert(schema.agentProfiles).values({ wallet: w, name, capabilities, blurb, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.agentProfiles.wallet, set: { name, capabilities, blurb, updatedAt: new Date() } });
  return { wallet: w, name, capabilities, blurb };
}
export async function directory(): Promise<DirectoryEntry[]> {
  const db = await getDb();
  const profiles = await db.select().from(schema.agentProfiles);
  const pmap = new Map(profiles.map((p) => [p.wallet, p]));
  const wallets = new Set<string>(profiles.map((p) => p.wallet));
  const allTasks = await db.select().from(schema.tasks);
  for (const t of allTasks) { wallets.add(t.poster); if (t.worker) wallets.add(t.worker); }
  const scoreRows = await db.select({ wallet: schema.scores.wallet, c: sql<number>`count(*)` }).from(schema.scores)
    .where(ne(schema.scores.wallet, "")).groupBy(schema.scores.wallet);
  const plays = new Map(scoreRows.map((r) => [(r.wallet ?? "").toLowerCase(), Number(r.c)]));
  const entries: DirectoryEntry[] = [];
  for (const w of wallets) {
    const mine = allTasks.filter((t) => t.poster === w || t.worker === w);
    const completed = allTasks.filter((t) => t.worker === w && t.status === "settled");
    const p = pmap.get(w);
    entries.push({
      wallet: w, name: p?.name ?? null, capabilities: (p?.capabilities as string[]) ?? [], blurb: p?.blurb ?? null,
      tasksPosted: allTasks.filter((t) => t.poster === w).length,
      tasksCompleted: completed.length,
      tasksRejected: allTasks.filter((t) => t.worker === w && t.status === "refunded" && t.submittedAt !== null).length,
      qtrEarned: completed.reduce((a, t) => a + t.bounty - Math.floor(t.bounty * FEE_RATE), 0),
      playsRecorded: plays.get(w) ?? 0,
      firstSeen: mine.length ? Math.min(...mine.map((t) => t.createdAt.getTime())) : null,
    });
  }
  return entries.sort((a, b) => b.tasksCompleted - a.tasksCompleted || b.qtrEarned - a.qtrEarned);
}
