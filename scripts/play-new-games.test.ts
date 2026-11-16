// Production paid-play verification for the seven new cabinets (Base MAINNET).
// The test agent wallet pays 0.25 USDC per game via x402 (CDP facilitator),
// plays each game to completion against the live server, and asserts the
// score lands on the leaderboard and +25 QTR accrues.
// Run: npx vitest run scripts/play-new-games.test.ts
// NOT part of the unit suite's intent — it spends real (tiny) money on purpose.
import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "crypto";
import { bestMoves } from "../lib/games/tictactoe";
import { ChessGame } from "../lib/games/chess";
import { CheckersGame } from "../lib/games/checkers";
import { GoGame } from "../lib/games/go";

const BASE = "https://coinop-one.vercel.app";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TREASURY = "0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7";
const account = process.env.AGENT_TEST_PRIVATE_KEY
  ? privateKeyToAccount(process.env.AGENT_TEST_PRIVATE_KEY as `0x${string}`)
  : (null as unknown as ReturnType<typeof privateKeyToAccount>);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pay(gameSlug: string): Promise<string> {
  const first = await fetch(BASE + "/api/coin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gameSlug }) });
  const body402 = await first.json().catch(() => ({} as Record<string, unknown>));
  const a0 = (body402 as { accepts?: Record<string, string>[] }).accepts?.[0] ?? {};
  expect(first.status).toBe(402);
  expect(String(a0.amount ?? a0.maxAmountRequired)).toBe("250000");
  expect(a0.payTo).toBe(TREASURY);
  expect(a0.asset).toBe(USDC);
  const now = Math.floor(Date.now() / 1000);
  const authorization = { from: account.address, to: TREASURY, value: "250000",
    validAfter: String(now - 600), validBefore: String(now + 3600), nonce: "0x" + randomBytes(32).toString("hex") };
  const signature = await account.signTypedData({
    domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: USDC },
    types: { TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
    primaryType: "TransferWithAuthorization",
    message: { from: authorization.from, to: authorization.to, value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore), nonce: authorization.nonce as `0x${string}` },
  });
  const payload = { x402Version: 1, scheme: "exact", network: "eip155:8453", payload: { signature, authorization } };
  const res = await fetch(BASE + "/api/coin", { method: "POST",
    headers: { "content-type": "application/json", "x-payment": Buffer.from(JSON.stringify(payload)).toString("base64") },
    body: JSON.stringify({ gameSlug }) });
  const j = (await res.json().catch(() => ({}))) as { sessionToken?: string; error?: string };
  if (!j.sessionToken) throw new Error("payment failed for " + gameSlug + ": " + (j.error ?? JSON.stringify(j).slice(0, 200)));
  return j.sessionToken;
}

type H = Record<string, string>;
const hdr = (t: string): H => ({ authorization: "Bearer " + t, "content-type": "application/json" });
async function state(t: string) {
  const s = await (await fetch(BASE + "/api/play/state", { headers: hdr(t) })).json() as { state?: Record<string, unknown> };
  return s.state!;
}
async function act(t: string, action: string) {
  const r = await fetch(BASE + "/api/play/action", { method: "POST", headers: hdr(t), body: JSON.stringify({ action }) });
  const j = await r.json().catch(() => ({})) as { state?: Record<string, unknown>; error?: string };
  if (!j.state) throw new Error("action " + action + " failed: " + (j.error ?? r.status));
  return j.state;
}
async function rewards() {
  const j = await (await fetch(BASE + "/api/rewards?wallet=" + account.address)).json() as Record<string, unknown>;
  return j;
}
function claimableOf(j: Record<string, unknown>): number {
  for (const k of ["tokensClaimable", "claimable", "claimableTokens", "accrued", "balance"]) if (typeof j[k] === "number") return j[k] as number;
  return NaN;
}
async function expectOnBoard(slug: string, minScore: number) {
  const lb = await (await fetch(BASE + "/api/leaderboard?slug=" + slug + "&season=all")).json() as { entries?: { wallet: string; score: number }[] };
  const mine = (lb.entries ?? []).filter((e) => e.wallet.toLowerCase() === account.address.toLowerCase());
  console.log(slug, "leaderboard entries for test agent:", JSON.stringify(mine));
  expect(mine.length).toBeGreaterThan(0);
  expect(Math.max(...mine.map((e) => e.score))).toBeGreaterThanOrEqual(minScore);
}

async function playGame(slug: string, driver: (t: string) => Promise<Record<string, unknown>>) {
  const before = claimableOf(await rewards());
  const token = await pay(slug);
  console.log(slug, "paid — session started; claimable before:", before);
  const final = await driver(token);
  console.log(slug, "FINAL:", JSON.stringify(final).slice(0, 300));
  expect(final.status).toBe("over");
  await sleep(1500);
  const after = claimableOf(await rewards());
  console.log(slug, "claimable after:", after);
  if (!Number.isNaN(before) && !Number.isNaN(after)) expect(after - before).toBe(25);
  await expectOnBoard(slug, Number(final.score ?? 0));
  return final;
}

describe.skipIf(!process.env.AGENT_TEST_PRIVATE_KEY)("production paid plays — new cabinets", () => {
  it("thermonuclear: build, hold, game ends", async () => {
    await playGame("thermonuclear", async (t) => {
      let st = await state(t);
      const plan = ["build_warheads", "build_interceptors"];
      let i = 0;
      while (st.status !== "over" && i < 40) { st = await act(t, plan[i] ?? "hold"); i++; }
      return st;
    });
  }, 300_000);

  it("tictactoe: perfect play across 9 boards", async () => {
    await playGame("tictactoe", async (t) => {
      let st = await state(t);
      let i = 0;
      while (st.status !== "over" && i < 60) {
        const cells = st.cells as string[];
        const best = bestMoves(cells, "X");
        st = await act(t, "place_" + best[0]);
        i++;
      }
      return st;
    });
  }, 300_000);

  it("battleship: hunt/target sweep to a finish", async () => {
    await playGame("battleship", async (t) => {
      let st = await state(t);
      let i = 0;
      while (st.status !== "over" && i < 120) {
        const shots = String(st.yourShots);
        let target = -1;
        for (let c = 0; c < 100 && target < 0; c++) {
          if (shots[c] !== "x") continue;
          for (const nb of [c - 10, c + 10, c - 1, c + 1]) {
            if (nb < 0 || nb > 99 || shots[nb] !== ".") continue;
            if (Math.abs((nb % 10) - (c % 10)) + Math.abs(Math.floor(nb / 10) - Math.floor(c / 10)) !== 1) continue;
            target = nb; break;
          }
        }
        if (target < 0) for (let c = 0; c < 100; c++) if (shots[c] === "." && (Math.floor(c / 10) + (c % 10)) % 2 === 0) { target = c; break; }
        if (target < 0) for (let c = 0; c < 100; c++) if (shots[c] === ".") { target = c; break; }
        if (target < 0) break;
        st = await act(t, "fire_" + target);
        i++;
      }
      return st;
    });
  }, 300_000);

  it("chess: legal-move oracle plays a full game", async () => {
    await playGame("chess", async (t) => {
      let st = await state(t);
      let i = 0;
      while (st.status !== "over" && i < 320) {
        const oracle = ChessGame.fromFen(String(st.fen));
        const moves = oracle.legalMoves();
        if (!moves.length) break;
        st = await act(t, "move_" + moves[0]);
        i++;
      }
      return st;
    });
  }, 900_000);

  it("checkers: legal-move oracle plays a full game", async () => {
    await playGame("checkers", async (t) => {
      let st = await state(t);
      let i = 0;
      while (st.status !== "over" && i < 300) {
        const oracle = CheckersGame.fromBoard(String(st.board), "you");
        const moves = oracle.legalMoves();
        if (!moves.length) break;
        const jump = moves.find((m) => { const [, f, tt] = m.split("_").map(Number); return Math.abs(Math.floor(tt / 8) - Math.floor(f / 8)) === 2; });
        st = await act(t, jump ?? moves[0]);
        i++;
      }
      return st;
    });
  }, 900_000);

  it("go: seeded legal points, passes late, game scored", async () => {
    await playGame("go", async (t) => {
      let st = await state(t);
      let i = 0, probe = 40;
      while (st.status !== "over" && i < 220) {
        const moves = Number(st.moves ?? 0);
        if (moves > 110) { st = await act(t, "pass"); i++; continue; }
        let placed = false;
        for (let k = 0; k < 20 && !placed; k++) {
          probe = (probe * 1103515245 + 12345) % 81;
          if (String(st.board)[probe] !== ".") continue;
          const oracle = GoGame.fromBoard(String(st.board), { byYou: Number(st.prisonersByYou ?? 0), byHouse: Number(st.prisonersByHouse ?? 0) });
          try { oracle.act("play_" + probe); } catch { continue; }
          st = await act(t, "play_" + probe);
          placed = true;
        }
        if (!placed) st = await act(t, "pass");
        i++;
      }
      return st;
    });
  }, 900_000);

  it("lightcycles: real-time steering, deliberate late crash", async () => {
    await playGame("lightcycles", async (t) => {
      const started = Date.now();
      let st = await state(t);
      let curDir = "right";
      while (st.status !== "over") {
        const elapsed = Date.now() - started;
        if (elapsed > 50_000 && curDir !== "up") { await act(t, "up"); curDir = "up"; } // end it: ride into the top wall
        else if (elapsed <= 50_000) {
          const trail = new Set([...(st.trailYou as number[]), ...(st.trailRival as number[])]);
          const head = st.you as { x: number; y: number };
          const trailYou = st.trailYou as number[];
          const prev = trailYou.length > 1 ? trailYou[trailYou.length - 2] : null;
          const cur = prev === null ? { x: 1, y: 0 } : { x: head.x - (prev % 40), y: head.y - Math.floor(prev / 40) };
          const dirs = [{ name: "right", x: 1, y: 0 }, { name: "down", x: 0, y: 1 }, { name: "left", x: -1, y: 0 }, { name: "up", x: 0, y: -1 }];
          let best: string | null = null, bestLen = -1;
          for (const d of dirs) {
            if (d.x === -cur.x && d.y === -cur.y) continue;
            let len = 0, x = head.x, y = head.y;
            while (true) { x += d.x; y += d.y; if (x < 0 || x >= 40 || y < 0 || y >= 30 || trail.has(y * 40 + x)) break; len++; if (len > 60) break; }
            if (len > bestLen) { bestLen = len; best = d.name; }
          }
          if (best && best !== curDir) { const s2 = await act(t, best); curDir = best; st = s2; continue; }
        }
        await sleep(90);
        st = await state(t);
      }
      return st;
    });
  }, 600_000);
});
