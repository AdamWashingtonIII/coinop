"use client";
import { useEffect, useRef } from "react";
import { StackerGame, type StackerState } from "@/lib/games/stacker";
import { SnakeGame } from "@/lib/games/snake";
import { BreakerGame } from "@/lib/games/breaker";
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
      const cw = 32, ch = 20; ctx!.fillStyle = "#000"; ctx!.fillRect(0, 0, CW, CH);
      ctx!.fillStyle = color;
      st.spans.forEach((span, row) => { const y = (15 - 1 - row) * ch; ctx!.fillRect(span.start * cw + 1, y + 1, (span.end - span.start) * cw - 2, ch - 2); });
      if (st.status === "playing") { ctx!.fillStyle = "#39ffdc"; const y = (15 - 1 - st.spans.length) * ch;
        ctx!.fillRect(st.moving.start * cw + 1, y + 1, (st.moving.end - st.moving.start) * cw - 2, ch - 2); }
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
    const sims: Record<string, () => void> = { asteroids: simAsteroids, runner: simRunner, whack: simWhack };
    let last = 0;
    function frame(ts: number) { if (stopped) return;
      const step = slug === "stacker" ? 250 : 90;
      if (ts - last >= step) { last = ts;
        if (slug === "stacker") stepStacker();
        else if (slug === "snake") stepSnake();
        else if (slug === "breaker") stepBreaker();
        else sims[slug]?.(); }
      raf = requestAnimationFrame(frame); }
    raf = requestAnimationFrame(frame);
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }, [slug, color, live]);
  if (live) return null;
  return <canvas ref={canvas} width={CW} height={CH} aria-label="Demo (attract mode)" className="block" />;
}
