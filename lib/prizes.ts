import { randomBytes } from "crypto";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { CATALOG } from "./catalog";
// The weekly USDC prize pool (ADR 0016). Money facts live in prize_ledger
// (USDC micro-units, append-only): the operator's seed and verified payouts
// carry tx hashes; a $0.05 rake rides every settled USDC coin-in. Weeks run
// Monday 00:00 America/New_York. House wallets can play but never win.
export const RAKE_MICRO = 50_000; // $0.05 of every $0.25 coin-in
export const MIN_PAYOUT_MICRO = 250_000; // shares under $0.25 stay in the pool
export const HOUSE_WALLETS = new Set([
  "0x312e8efd90c134f6e54a0b612df4f55775ec2bd7", // treasury
  "0x2d3f3f16ef47a8345d65b277217b5b6dcb2386ff", // test agent
  "0x981d3e7eb61a0929e7c39eb2b47d2c3febcaf511", // watch agent PIXEL
  "0xcce4b63cee66f05e23f85198be73df897ee2a209", // watch agent QUARTERBACK
  "0xb84509b2e8fa95cb666197a59f933096b76bf315", // deployer
  "0xc5a8c37f9383978e48460c6626cb0ab08d8f7bf4", // claim minter
  "0x27501c6b06ca445579488b8d4e44998222171d74", // match escrow
  "0xe67f65450e53306db97dbeb5d1545a645d3b5af1", // referral-smoke wallet
]);
export function isHouseWallet(wallet: string): boolean {
  return HOUSE_WALLETS.has(wallet.toLowerCase());
}
export function liveSlugs(): string[] {
  return CATALOG.filter((g) => g.engine === "live").map((g) => g.slug);
}
// --- week math (America/New_York) ---
function etDateParts(d: Date): { y: number; m: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York",
    year: "numeric", month: "numeric", day: "numeric" }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), day: get("day") };
}
function etOffsetMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York",
    timeZoneName: "longOffset" }).formatToParts(d);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-05:00";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(tz);
  if (!m) return -300;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}
// The UTC instant of midnight ET on a given ET calendar date.
function etMidnightUtc(y: number, m: number, day: number): Date {
  const guess = new Date(Date.UTC(y, m - 1, day, 5, 0)); // EST guess
  const off = etOffsetMinutes(guess);
  return new Date(Date.UTC(y, m - 1, day, 0, 0) - off * 60_000);
}
export interface WeekWindow { weekKey: string; start: Date; end: Date }
export function weekWindow(at: Date = new Date()): WeekWindow {
  const { y, m, day } = etDateParts(at);
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay(); // 0 Sun .. 6 Sat
  const sinceMonday = (dow + 6) % 7;
  const mon = new Date(Date.UTC(y, m - 1, day - sinceMonday));
  const next = new Date(Date.UTC(y, m - 1, day - sinceMonday + 7));
  const key = (d: Date) => d.toISOString().slice(0, 10);
  return { weekKey: key(mon),
    start: etMidnightUtc(mon.getUTCFullYear(), mon.getUTCMonth() + 1, mon.getUTCDate()),
    end: etMidnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()) };
}
export function weekWindowByKey(weekKey: string): WeekWindow {
  const [y, m, d] = weekKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 7));
  return { weekKey, start: etMidnightUtc(y, m, d),
    end: etMidnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()) };
}
// --- ledger ---
const id = () => randomBytes(12).toString("hex");
export async function rakeAccrue(refSid: string): Promise<void> {
  const db = await getDb();
  await db.insert(schema.prizeLedger).values({ id: id(), kind: "rake",
    amountMicro: BigInt(RAKE_MICRO), weekKey: weekWindow().weekKey, refId: refSid });
}
export async function rakeReverse(refSid: string): Promise<void> {
  const db = await getDb();
  await db.insert(schema.prizeLedger).values({ id: id(), kind: "rake_reversal",
    amountMicro: BigInt(-RAKE_MICRO), weekKey: weekWindow().weekKey, refId: refSid });
}
export async function poolBalanceMicro(): Promise<number> {
  const db = await getDb();
  const rows = await db.select({ s: sql<string>`coalesce(sum(${schema.prizeLedger.amountMicro}),0)` })
    .from(schema.prizeLedger);
  return Number(rows[0]?.s ?? 0);
}
export async function recordSeed(txHash: string, amountMicro: number): Promise<void> {
  const db = await getDb();
  await db.insert(schema.prizeLedger).values({ id: id(), kind: "seed",
    amountMicro: BigInt(amountMicro), weekKey: weekWindow().weekKey, txHash });
}
export async function recordPayout(p: { txHash: string; wallet: string; gameSlug: string; weekKey: string; amountMicro: number }): Promise<void> {
  const db = await getDb();
  await db.insert(schema.prizeLedger).values({ id: id(), kind: "payout",
    amountMicro: BigInt(-p.amountMicro), wallet: p.wallet.toLowerCase(),
    gameSlug: p.gameSlug, weekKey: p.weekKey, txHash: p.txHash });
}
// --- winners ---
export interface CabinetStanding { gameSlug: string;
  leader: { wallet: string; value: number; achievedAt: number } | null }
export async function weekStandings(win: WeekWindow): Promise<CabinetStanding[]> {
  const db = await getDb();
  const out: CabinetStanding[] = [];
  for (const slug of liveSlugs()) {
    const rows = await db.select().from(schema.scores).where(and(
      eq(schema.scores.gameSlug, slug), eq(schema.scores.verified, true),
      gte(schema.scores.createdAt, win.start), lt(schema.scores.createdAt, win.end),
    )).orderBy(sql`${schema.scores.value} desc, ${schema.scores.createdAt} asc`);
    const top = rows.find((r) => r.wallet && !isHouseWallet(r.wallet));
    out.push({ gameSlug: slug, leader: top && top.wallet
      ? { wallet: top.wallet, value: top.value, achievedAt: top.createdAt.getTime() } : null });
  }
  return out;
}
export interface PrizeView { weekKey: string; start: string; end: string;
  poolMicro: number; shareMicro: number; cabinets: (CabinetStanding & { shareMicro: number })[];
  payouts: { wallet: string; gameSlug: string; amountMicro: number; txHash: string | null; weekKey: string }[] }
export async function prizeView(weekKey?: string): Promise<PrizeView> {
  const win = weekKey ? weekWindowByKey(weekKey) : weekWindow();
  const pool = await poolBalanceMicro();
  const slugs = liveSlugs();
  const share = Math.floor(pool / slugs.length);
  const standings = await weekStandings(win);
  const db = await getDb();
  const paid = await db.select().from(schema.prizeLedger)
    .where(and(eq(schema.prizeLedger.kind, "payout"), eq(schema.prizeLedger.weekKey, win.weekKey)));
  return { weekKey: win.weekKey, start: win.start.toISOString(), end: win.end.toISOString(),
    poolMicro: pool, shareMicro: share,
    cabinets: standings.map((c) => ({ ...c, shareMicro: share })),
    payouts: paid.map((p) => ({ wallet: p.wallet ?? "", gameSlug: p.gameSlug ?? "",
      amountMicro: -Number(p.amountMicro), txHash: p.txHash, weekKey: p.weekKey ?? win.weekKey })) };
}
// Winners owed for a closed week: the standings, minus cabinets already paid,
// minus shares under the minimum (those stay in the pool and roll over).
export async function weekPayoutsDue(weekKey: string): Promise<{ wallet: string; gameSlug: string; amountMicro: number }[]> {
  const view = await prizeView(weekKey);
  const paidSlugs = new Set(view.payouts.map((p) => p.gameSlug));
  if (view.shareMicro < MIN_PAYOUT_MICRO) return [];
  return view.cabinets.filter((c) => c.leader && !paidSlugs.has(c.gameSlug))
    .map((c) => ({ wallet: c.leader!.wallet, gameSlug: c.gameSlug, amountMicro: view.shareMicro }));
}
export const usd = (micro: number): string => (micro / 1_000_000).toFixed(2);
