"use client";
import { useEffect, useRef } from "react";
import { StackerGame, type StackerState } from "@/lib/games/stacker";
import { SnakeGame } from "@/lib/games/snake";
import { BreakerGame } from "@/lib/games/breaker";
import { ThermonuclearGame } from "@/lib/games/thermonuclear";
import { TicTacToeGame, bestMoves } from "@/lib/games/tictactoe";
import { LightCyclesGame } from "@/lib/games/lightcycles";
import { BattleshipGame } from "@/lib/games/battleship";
import { ChessGame } from "@/lib/games/chess";
import { CheckersGame } from "@/lib/games/checkers";
import { GoGame } from "@/lib/games/go";
import { drawGameState } from "./render";
// Attract mode (ADR 0006): when no agent is playing, the cabinet screen runs a demo.
// Stacker, Snake and Breaker demos are the REAL engines driven by simple bots on a
// virtual clock. The remaining three are visual attract simulations — their engines
// are still in build, and the label on screen says so. Canvas is 320x300 for every cabinet.
const CW = 320, CH = 300;
export default function AttractDemo({ slug, color, live }: { slug: string; color: string; live: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (live) return; // a real agent session owns the screen
    const ctx = canvas.current?.getContext("2d"); if (!ctx) return;
    let raf = 0; let stopped = false;
    // --- stacker: real engine + bot ---
    let vnow = 0, lastOverlap = 0, overTicks = 0;
    let game = new StackerGame(() => vnow);
    function drawStacker(st: StackerState) {
      drawGameState(ctx!, st, color); // shared futuristic renderer (ADR: one kit for all cabinets)
      ctx!.fillStyle = "#fff"; ctx!.font = "bold 12px monospace";
      ctx!.fillText("DEMO — SIMULATED AGENT · SCORE " + st.score, 8, 16);
    }
    function stepStacker() {
      vnow += 250; const st = game.state();
      if (st.status === "over") { overTicks++; if (overTicks > 6) { game = new StackerGame(() => vnow); overTicks = 0; lastOverlap = 0; } drawStacker(game.state()); return; }
      const target = st.spans.length ? st.spans[st.spans.length - 1] : { start: 0, end: 10 };
      const overlap = Math.max(0, Math.min(st.moving.end, target.end) - Math.max(st.moving.start, target.start));
      const width = st.moving.end - st.moving.start;
      if (overlap === width || (overlap < lastOverlap && lastOverlap > 0)) { game.drop(); lastOverlap = 0; }
      else lastOverlap = overlap;
      drawStacker(game.state());
    }
    // --- snake + breaker: real engines + bots ---
    let snow = 0, snakeOverTicks = 0, seed = 1234;
    let snake = new SnakeGame(() => snow, seed);
    function stepSnake() {
      snow += 200; const st = snake.state();
      if (st.status === "over") { snakeOverTicks++;
        if (snakeOverTicks > 8) { seed = (seed * 1103515245 + 12345) % 2147483648; snake = new SnakeGame(() => snow, seed); snakeOverTicks = 0; }
        drawGameState(ctx!, snake.state(), color); label("DEMO — SIMULATED AGENT · SCORE " + st.score); return; }
      const head = st.segments[0];
      const cur = { x: head.x - st.segments[1].x, y: head.y - st.segments[1].y };
      const target = st.bonus ?? st.orb;
      const prefs: { name: string; x: number; y: number }[] = [];
      if (target) {
        if (target.x > head.x) prefs.push({ name: "right", x: 1, y: 0 });
        if (target.x < head.x) prefs.push({ name: "left", x: -1, y: 0 });
        if (target.y > head.y) prefs.push({ name: "down", x: 0, y: 1 });
        if (target.y < head.y) prefs.push({ name: "up", x: 0, y: -1 });
      }
      prefs.push({ name: "right", x: 1, y: 0 }, { name: "down", x: 0, y: 1 }, { name: "left", x: -1, y: 0 }, { name: "up", x: 0, y: -1 });
      for (const p of prefs) {
        if (p.x === -cur.x && p.y === -cur.y) continue; // no reversing
        const nx = head.x + p.x, ny = head.y + p.y;
        if (nx < 0 || nx >= 20 || ny < 0 || ny >= 20) continue;
        if (st.segments.slice(0, -1).some((s) => s.x === nx && s.y === ny)) continue;
        snake.act(p.name); break;
      }
      drawGameState(ctx!, snake.state(), color); label("DEMO — SIMULATED AGENT · SCORE " + snake.state().score);
    }
    let bnow = 0, breakerOverTicks = 0;
    let breaker = new BreakerGame(() => bnow);
    function stepBreaker() {
      bnow += 100; const st = breaker.state();
      if (st.status === "over") { breakerOverTicks++;
        if (breakerOverTicks > 8) { breaker = new BreakerGame(() => bnow); breakerOverTicks = 0; }
        drawGameState(ctx!, breaker.state(), color); label("DEMO — SIMULATED AGENT · SCORE " + st.score); return; }
      const center = st.paddle.start + st.paddle.width / 2;
      if (st.ball.x < center - 0.5) breaker.act("left");
      else if (st.ball.x > center + 0.5) breaker.act("right");
      drawGameState(ctx!, breaker.state(), color); label("DEMO — SIMULATED AGENT · SCORE " + breaker.state().score);
    }
    // --- generic sims for pending engines ---
    const S: Record<string, number[]> = { t: [0] };
    function label(text: string) { ctx!.fillStyle = "#fff"; ctx!.font = "bold 12px monospace"; ctx!.fillText(text, 8, 16); }
    function simAsteroids() { const t = S.t[0]++; ctx!.fillStyle = "#000"; ctx!.fillRect(0, 0, CW, CH);
      ctx!.fillStyle = color; for (let i = 0; i < 7; i++) { const x = (i * 47 + 20) % CW, y = (t * (1 + i % 3) + i * 60) % (CH + 40) - 20;
        ctx!.beginPath(); ctx!.arc(x, y, 9 + (i % 3) * 4, 0, 7); ctx!.fill(); }
      const sx = 160 + Math.sin(t / 11) * 90; ctx!.fillStyle = "#39ffdc";
      ctx!.beginPath(); ctx!.moveTo(sx, 258); ctx!.lineTo(sx - 10, 276); ctx!.lineTo(sx + 10, 276); ctx!.closePath(); ctx!.fill();
      if (t % 14 < 7) { ctx!.fillRect(sx - 1, 200 - (t % 14) * 8, 2, 12); } label("ATTRACT DEMO — ENGINE IN BUILD"); }
    function simRunner() { const t = S.t[0]++; ctx!.fillStyle = "#000"; ctx!.fillRect(0, 0, CW, CH);
      ctx!.strokeStyle = "rgba(255,255,255,.25)"; for (const lx of [96, 192]) { ctx!.beginPath(); ctx!.moveTo(160 + (lx - 160) * 0.2, 40); ctx!.lineTo(lx + (lx - 160) * 0.4, CH); ctx!.stroke(); }
      for (let i = 0; i < 4; i++) { const y = ((t * 6 + i * 90) % 280) + 30; const lane = (i + ((t / 30) | 0)) % 3;
        ctx!.fillStyle = "#ff2e63"; ctx!.fillRect(70 + lane * 80, y, 44, 14); }
      const px = 70 + ((t / 22) % 3 | 0) * 80 + 12; ctx!.fillStyle = color; ctx!.fillRect(px, 248, 20, 20); label("ATTRACT DEMO — ENGINE IN BUILD"); }
    function simWhack() { const t = S.t[0]++; ctx!.fillStyle = "#000"; ctx!.fillRect(0, 0, CW, CH);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { const x = 45 + c * 85, y = 55 + r * 80;
        ctx!.fillStyle = "#23233a"; ctx!.beginPath(); ctx!.ellipse(x + 30, y + 34, 34, 12, 0, 0, 7); ctx!.fill();
        if ((r * 3 + c) === ((t / 6 | 0) % 9)) { ctx!.fillStyle = color; ctx!.beginPath(); ctx!.arc(x + 30, y + 16, 15, 0, 7); ctx!.fill();
          ctx!.fillStyle = "#000"; ctx!.fillRect(x + 22, y + 12, 4, 4); ctx!.fillRect(x + 36, y + 12, 4, 4); } }
      label("ATTRACT DEMO — ENGINE IN BUILD"); }
        function bottomLabel(score: number) { ctx!.fillStyle = "#000"; ctx!.fillRect(0, 286, CW, 14);
      ctx!.fillStyle = "#fff"; ctx!.font = "bold 10px monospace";
      ctx!.fillText("DEMO — SIMULATED AGENT · SCORE " + score, 8, 297); }
// --- thermonuclear + tic-tac-toe: real engines + bots (turn-based) ---
    let tnSeed = 2026, tnOverTicks = 0, tnGames = 0;
    let tn = new ThermonuclearGame(() => 0, tnSeed);
    function stepThermo() {
      const st = tn.state();
      if (st.status === "over") { tnOverTicks++;
        if (tnOverTicks > 10) { tnSeed = (tnSeed * 1103515245 + 12345) % 2147483648; tn = new ThermonuclearGame(() => 0, tnSeed); tnOverTicks = 0; tnGames++; }
        drawGameState(ctx!, tn.state(), color); bottomLabel(st.score); return; }
      // Every fourth demo war, the bot learns the film's lesson on turn 1.
      if (st.turn === 0 && tnGames % 4 === 3) { tn.act("stand_down"); drawGameState(ctx!, tn.state(), color); return; }
      const foeBig = st.foe.cities.reduce((b, c, i) => (c.alive && (b < 0 || c.pop > st.foe.cities[b].pop) ? i : b), -1);
      const youBig = st.you.cities.reduce((b, c, i) => (c.alive && (b < 0 || c.pop > st.you.cities[b].pop) ? i : b), -1);
      const r = (tnSeed + st.turn * 2654435761) % 100 / 100;
      if (st.you.warheads > 2 && foeBig >= 0 && r < 0.55) tn.act("launch_city_" + foeBig);
      else if (st.you.warheads > 0 && st.foe.silos > 0 && r < 0.7) tn.act("launch_silo");
      else if (st.you.interceptors > 0 && youBig >= 0 && st.foe.warheads > 4) tn.act("defend_city_" + youBig);
      else if (st.you.warheads <= 4) tn.act("build_warheads");
      else tn.act(st.turn % 3 === 0 ? "build_interceptors" : "hold");
      drawGameState(ctx!, tn.state(), color); bottomLabel(tn.state().score);
    }
    let ttSeed = 555, ttOverTicks = 0;
    let ttt = new TicTacToeGame(() => 0, ttSeed);
    function stepTtt() {
      const st = ttt.state();
      if (st.status === "over") { ttOverTicks++;
        if (ttOverTicks > 10) { ttSeed = (ttSeed * 1103515245 + 12345) % 2147483648; ttt = new TicTacToeGame(() => 0, ttSeed); ttOverTicks = 0; }
        drawGameState(ctx!, ttt.state(), color); bottomLabel(st.score); return; }
      const mv = bestMoves([...st.cells], "X")[0];
      ttt.act("place_" + mv);
      drawGameState(ctx!, ttt.state(), color); bottomLabel(ttt.state().score);
    }
    // --- light cycles: real engine on a virtual clock + ray bot ---
    let lnow = 0, lcOverTicks = 0, lcSeed = 6;
    let lc = new LightCyclesGame(() => lnow, lcSeed);
    function stepCycles() {
      const st0 = lc.state();
      lnow += st0.tickMs;
      const st = lc.state();
      if (st.status === "over") { lcOverTicks++;
        if (lcOverTicks > 10) { lcSeed = (lcSeed * 1103515245 + 12345) % 2147483648; lc = new LightCyclesGame(() => lnow, lcSeed); lcOverTicks = 0; }
        drawGameState(ctx!, lc.state(), color); return; }
      const trail = new Set([...st.trailYou, ...st.trailRival]);
      const head = st.you;
      const prev = st.trailYou.length > 1 ? st.trailYou[st.trailYou.length - 2] : null;
      const cur = prev === null ? { x: 1, y: 0 } : { x: head.x - (prev % 40), y: head.y - Math.floor(prev / 40) };
      const dirs = [{ name: "right", x: 1, y: 0 }, { name: "down", x: 0, y: 1 }, { name: "left", x: -1, y: 0 }, { name: "up", x: 0, y: -1 }];
      let best: string | null = null, bestLen = -1;
      for (const d of dirs) {
        if (d.x === -cur.x && d.y === -cur.y) continue;
        let len = 0, x = head.x, y = head.y;
        while (true) { x += d.x; y += d.y; if (x < 0 || x >= 40 || y < 0 || y >= 30 || trail.has(y * 40 + x)) break; len++; if (len > 60) break; }
        if (len > bestLen) { bestLen = len; best = d.name; }
      }
      if (best) lc.act(best);
      drawGameState(ctx!, lc.state(), color); bottomLabel(lc.state().score);
    }
    // --- fleet battle: turn-based, hunt/target bot ---
    let bsOverTicks = 0, bsSeed = 31;
    let bs = new BattleshipGame(() => 0, bsSeed);
    function stepBattleship() {
      const st = bs.state();
      if (st.status === "over") { bsOverTicks++;
        if (bsOverTicks > 10) { bsSeed = (bsSeed * 1103515245 + 12345) % 2147483648; bs = new BattleshipGame(() => 0, bsSeed); bsOverTicks = 0; }
        drawGameState(ctx!, bs.state(), color); bottomLabel(st.score); return; }
      const shots = st.yourShots;
      let target = -1;
      for (let i = 0; i < 100 && target < 0; i++) {
        if (shots[i] !== "x") continue;
        for (const nb of [i - 10, i + 10, i - 1, i + 1]) {
          if (nb < 0 || nb > 99 || shots[nb] !== ".") continue;
          if (Math.abs((nb % 10) - (i % 10)) + Math.abs(Math.floor(nb / 10) - Math.floor(i / 10)) !== 1) continue;
          target = nb; break;
        }
      }
      if (target < 0) for (let i = 0; i < 100; i++) if (shots[i] === "." && (Math.floor(i / 10) + (i % 10)) % 2 === 0) { target = i; break; }
      if (target < 0) for (let i = 0; i < 100; i++) if (shots[i] === ".") { target = i; break; }
      if (target >= 0) bs.act("fire_" + target);
      drawGameState(ctx!, bs.state(), color); bottomLabel(bs.state().score);
    }
    // --- chess: real engine, bot takes captures first ---
    let chOverTicks = 0, chSeed = 17;
    let chess = new ChessGame(() => 0, chSeed);
    function stepChess() {
      const st = chess.state();
      if (st.status === "over") { chOverTicks++;
        if (chOverTicks > 12) { chSeed = (chSeed * 1103515245 + 12345) % 2147483648; chess = new ChessGame(() => 0, chSeed); chOverTicks = 0; }
        drawGameState(ctx!, chess.state(), color); return; }
      const moves = chess.legalMoves();
      if (moves.length) {
        const boardPart = st.fen.split(" ")[0];
        const sq: Record<string, string> = {};
        boardPart.split("/").forEach((rowStr, r) => { let c = 0;
          for (const ch of rowStr) { if (/\d/.test(ch)) c += Number(ch); else { sq["abcdefgh"[c] + (8 - r)] = ch; c++; } } });
        const capture = moves.find((m) => { const t = sq[m.slice(2, 4)]; return t && t === t.toLowerCase(); });
        chess.act("move_" + (capture ?? moves[(st.fen.length + moves.length) % moves.length]));
      }
      drawGameState(ctx!, chess.state(), color);
    }
    // --- checkers: real engine, bot takes jumps first ---
    let ckOverTicks = 0, ckSeed = 23;
    let checkers = new CheckersGame(() => 0, ckSeed);
    function stepCheckers() {
      const st = checkers.state();
      if (st.status === "over") { ckOverTicks++;
        if (ckOverTicks > 12) { ckSeed = (ckSeed * 1103515245 + 12345) % 2147483648; checkers = new CheckersGame(() => 0, ckSeed); ckOverTicks = 0; }
        drawGameState(ctx!, checkers.state(), color); return; }
      const moves = checkers.legalMoves();
      if (moves.length) {
        const jump = moves.find((m) => { const [, f, t] = m.split("_").map(Number); return Math.abs(Math.floor(t / 8) - Math.floor(f / 8)) === 2; });
        checkers.act(jump ?? moves[0]);
      }
      drawGameState(ctx!, checkers.state(), color);
    }
    // --- go: real engine, bot plays seeded legal points ---
    let goOverTicks = 0, goSeed = 41, goTry = 0;
    let go = new GoGame(() => 0, goSeed);
    function stepGo() {
      const st = go.state();
      if (st.status === "over") { goOverTicks++;
        if (goOverTicks > 12) { goSeed = (goSeed * 1103515245 + 12345) % 2147483648; go = new GoGame(() => 0, goSeed); goOverTicks = 0; }
        drawGameState(ctx!, go.state(), color); return; }
      const stones = st.board.split("").filter((c) => c !== ".").length;
      if (stones > 62) { go.act("pass"); }
      else {
        let placed = false;
        for (let k = 0; k < 12 && !placed; k++) {
          goTry = (goTry * 1103515245 + 12345) % 81;
          if (st.board[goTry] !== ".") continue;
          try { go.act("play_" + goTry); placed = true; } catch { /* illegal point — try another */ }
        }
        if (!placed) go.act("pass");
      }
      drawGameState(ctx!, go.state(), color);
    }
    const sims: Record<string, () => void> = { asteroids: simAsteroids, runner: simRunner, whack: simWhack };
    let last = 0;
    function frame(ts: number) { if (stopped) return;
      const step = slug === "stacker" ? 250 : slug === "thermonuclear" ? 900 : slug === "tictactoe" ? 650
        : slug === "lightcycles" ? 120 : slug === "battleship" ? 700 : slug === "chess" ? 900
        : slug === "checkers" ? 700 : slug === "go" ? 500 : 90;
      if (ts - last >= step) { last = ts;
        if (slug === "stacker") stepStacker();
        else if (slug === "snake") stepSnake();
        else if (slug === "breaker") stepBreaker();
        else if (slug === "thermonuclear") stepThermo();
        else if (slug === "tictactoe") stepTtt();
        else if (slug === "lightcycles") stepCycles();
        else if (slug === "battleship") stepBattleship();
        else if (slug === "chess") stepChess();
        else if (slug === "checkers") stepCheckers();
        else if (slug === "go") stepGo();
        else sims[slug]?.(); }
      raf = requestAnimationFrame(frame); }
    raf = requestAnimationFrame(frame);
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }, [slug, color, live]);
  if (live) return null;
  return <canvas ref={canvas} width={CW} height={CH} aria-label="Demo (attract mode)" className="block" />;
}
