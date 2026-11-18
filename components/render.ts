// Shared canvas renderer for live spectating, replays, and attract demos:
// draws any cabinet's server state onto a 320x300 logical stage, scaled up
// to the canvas backing store (ADR 0018 — see SCREEN_* / fitScreenCanvas).
// Visual language
// (2026-11-16 futuristic pass): deep-space glass, neon glow, rounded forms —
// one kit under all ten cabinets so the hall reads as a single machine.
// Glow discipline: shadowBlur is spent only on hero elements (heads, orbs,
// the ball); everything else fakes glow with layered alpha strokes/gradients
// so a 400-segment snake still draws at full frame rate.
export interface AnyStateLike { slug: string; status: string; score: number }
const ROW_COLORS = ["#2e9bff", "#7dff2e", "#39ffdc", "#ffb02e", "#ff2ea6"]; // breaker rows, top (50) to bottom (10)

// The stage is authored once at 320x300 logical units for every cabinet.
// Canvases mount a much larger backing store (ADR 0018: screens enlarged to
// fill the cabinet page, ~960px wide on desktop) and drawGameState scales
// the logical stage onto the real pixels, so enlarging the screen never
// re-tunes a game's internal coordinates — it just gets sharper.
export const SCREEN_W = 320;
export const SCREEN_H = 300;
export const SCREEN_SCALE = 3; // default backing store = 960x900
// Size a canvas backing store to its CSS size x devicePixelRatio (capped at
// 2) so the enlarged screens stay crisp on retina and desktop alike. Call
// before drawing; a no-op when the size is already right.
export function fitScreenCanvas(canvas: HTMLCanvasElement): void {
  const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  const cssW = canvas.clientWidth;
  if (!cssW) return;
  const w = Math.max(SCREEN_W, Math.round(cssW * dpr));
  const h = Math.round((w * SCREEN_H) / SCREEN_W);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const q = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + q, y);
  ctx.arcTo(x + w, y, x + w, y + h, q); ctx.arcTo(x + w, y + h, x, y + h, q);
  ctx.arcTo(x, y + h, x, y, q); ctx.arcTo(x, y, x + w, y, q);
  ctx.closePath();
}
function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
// Grand Prix scenery odometer: the GP state carries no distance
// counter, so the renderer integrates one from speed x race-clock,
// keyed by the race's seed commitment (engine distance advances at
// exactly speed metres per second). Live play, attract demos and
// replay playback all step through states in order, so the integral
// tracks the engine's own distance to within a sample; it resets when
// the clock runs backwards (new race, replay restart). Only scrubbing
// a replay to an arbitrary point can shift the scenery phase —
// cosmetic, and it re-anchors at the next reset.
const gpOdo = new Map<string, { ms: number; dist: number }>();
function gpDistance(seedCommit: string, raceMs: number, speed: number): number {
  let e = gpOdo.get(seedCommit);
  if (!e || raceMs < e.ms) {
    // First sight of this race, or the clock ran backwards (new race /
    // replay restart). A genuine start sits at distance ~0; a mid-race
    // first sight (a scrubbed replay, a composed snapshot) gets a
    // pace-based estimate instead, so place-anchored scenery — the
    // start/finish gantry — never pops up mid-lap. It re-anchors
    // exactly at the next true reset, per the odometer's contract.
    e = { ms: raceMs, dist: raceMs > 2000 ? (speed * raceMs) / 1000 : 0 };
    gpOdo.set(seedCommit, e);
  }
  else if (raceMs > e.ms) { e.dist += (speed * (raceMs - e.ms)) / 1000; e.ms = raceMs; }
  return e.dist;
}
// Multiply a hex colour's channels by f (f < 1 darker, f > 1 lighter) —
// the shading ladder the Grand Prix car routine builds its parts from.
function shade(hex: string, f: number): string {
  const [r, g, b] = hexRgb(hex);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}
// A contrasting accent for a rival's livery: the body colour's hue
// rotated ~150° and lifted to a bright, readable lightness, so each
// car on the grid pairs its paint with a stripe colour that pops
// against it — distinct teams, not one car recoloured.
function accentOf(hex: string): string {
  const [r, g, b] = hexRgb(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const mx = Math.max(rn, gn, bn), mn = Math.min(rn, gn, bn), d = mx - mn;
  let hd = 0;
  if (d > 0) hd = mx === rn ? 60 * (((gn - bn) / d) % 6) : mx === gn ? 60 * ((bn - rn) / d + 2) : 60 * ((rn - gn) / d + 4);
  hd = (hd + 150 + 360) % 360;
  const L = 0.64, S = 0.72, C = (1 - Math.abs(2 * L - 1)) * S, X = C * (1 - Math.abs(((hd / 60) % 2) - 1)), m = L - C / 2;
  let ro = 0, go = 0, bo = 0;
  if (hd < 60) { ro = C; go = X; } else if (hd < 120) { ro = X; go = C; }
  else if (hd < 180) { go = C; bo = X; } else if (hd < 240) { go = X; bo = C; }
  else if (hd < 300) { ro = X; bo = C; } else { ro = C; bo = X; }
  return `rgb(${Math.round((ro + m) * 255)},${Math.round((go + m) * 255)},${Math.round((bo + m) * 255)})`;
}
function vgrad(ctx: CanvasRenderingContext2D, y0: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}
// The shared stage: deep-space gradient, faint perspective grid tinted with
// the cabinet accent, and a soft vignette.
function stage(ctx: CanvasRenderingContext2D, W: number, H: number, accent: string): void {
  ctx.fillStyle = vgrad(ctx, 0, H, [[0, "#070b16"], [0.55, "#05070f"], [1, "#03040a"]]);
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = rgba(accent, 0.05); ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 20; x < W; x += 20) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
  for (let y = 20; y < H; y += 20) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
  ctx.stroke();
  const glow = ctx.createRadialGradient(W / 2, H * 0.42, 10, W / 2, H * 0.42, W * 0.75);
  glow.addColorStop(0, rgba(accent, 0.10)); glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
}
function glowDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, hex: string): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
  g.addColorStop(0, rgba(hex, 0.55)); g.addColorStop(1, rgba(hex, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r * 3.2, y - r * 3.2, r * 6.4, r * 6.4);
  ctx.fillStyle = hex;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
}
function hud(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, hex = "#e8f4ff", size = 11): void {
  ctx.font = `bold ${size}px monospace`;
  ctx.fillStyle = hex;
  ctx.fillText(text, x, y);
}

export function drawGameState(ctx: CanvasRenderingContext2D, state: AnyStateLike, color: string, W = 320, H = 300): void {
  const s = state as unknown as Record<string, unknown> & AnyStateLike;
  const t = Date.now();
  // Map the logical stage onto the canvas backing store (ADR 0018). Every
  // branch below draws in W x H units; the transform does the enlarging.
  if (ctx.canvas) ctx.setTransform(ctx.canvas.width / W, 0, 0, ctx.canvas.height / H, 0, 0);
  stage(ctx, W, H, color);

  if (s.slug === "stacker") {
    const spans = s.spans as { start: number; end: number }[];
    const moving = s.moving as { start: number; end: number };
    const cw = 32, ch = 20;
    // guide rails
    ctx.strokeStyle = rgba(color, 0.14);
    ctx.beginPath();
    for (let c = 0; c <= 10; c++) { ctx.moveTo(c * cw + 0.5, 0); ctx.lineTo(c * cw + 0.5, H); }
    ctx.stroke();
    const slab = (start: number, end: number, row: number, hot: boolean) => {
      const y = (15 - 1 - row) * ch;
      const x = start * cw + 1.5, w = (end - start) * cw - 3;
      if (hot) glowDot(ctx, x + w / 2, y + ch / 2, 7, "#39ffdc");
      ctx.fillStyle = vgrad(ctx, y, y + ch, hot ? [[0, "#a7fff2"], [0.5, "#39ffdc"], [1, "#0e9b85"]] : [[0, rgba(color, 0.95)], [0.5, rgba(color, 0.75)], [1, rgba(color, 0.45)]]);
      rr(ctx, x, y + 1.5, w, ch - 3, 4); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.fillRect(x + 3, y + 2.5, w - 6, 1.6);
    };
    spans.forEach((span, row) => slab(span.start, span.end, row, false));
    if (s.status === "playing" && moving) slab(moving.start, moving.end, spans.length, true);
    return;
  }

  if (s.slug === "snake") {
    const cell = 15, ox = (W - 20 * cell) / 2;
    const segments = s.segments as { x: number; y: number }[];
    const orb = s.orb as { x: number; y: number } | null;
    const bonus = s.bonus as { x: number; y: number } | null;
    ctx.strokeStyle = rgba(color, 0.28); ctx.lineWidth = 1.4;
    rr(ctx, ox - 3, -3, 20 * cell + 6, 20 * cell + 6, 8); ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = rgba(color, 0.10);
    for (let gy = 0; gy < 20; gy++) for (let gx = 0; gx < 20; gx++) ctx.fillRect(ox + gx * cell + cell / 2 - 0.5, gy * cell + cell / 2 - 0.5, 1, 1);
    const pulse = 1 + 0.18 * Math.sin(t / 240);
    if (orb) glowDot(ctx, ox + orb.x * cell + cell / 2, orb.y * cell + cell / 2, 4.4 * pulse, "#ffb02e");
    if (bonus) {
      const bx = ox + bonus.x * cell + cell / 2, by = bonus.y * cell + cell / 2;
      glowDot(ctx, bx, by, 5, "#ffe600");
      ctx.fillStyle = "#fff7ae";
      ctx.beginPath();
      ctx.moveTo(bx, by - 6); ctx.lineTo(bx + 4.4, by); ctx.lineTo(bx, by + 6); ctx.lineTo(bx - 4.4, by);
      ctx.closePath(); ctx.fill();
    }
    const n = segments.length;
    segments.forEach((seg, i) => {
      const f = n <= 1 ? 1 : 1 - i / n; // head bright, tail deep
      const x = ox + seg.x * cell + 1.2, y = seg.y * cell + 1.2, w = cell - 2.4;
      if (i === 0) glowDot(ctx, x + w / 2, y + w / 2, 6, color);
      ctx.fillStyle = i === 0 ? "#ffffff" : rgba(color, 0.35 + 0.65 * f);
      rr(ctx, x, y, w, w, 4.5); ctx.fill();
      if (i === 0) { // eyes, looking along the body
        const nx = segments[1] ? Math.sign(seg.x - segments[1].x) : 1, ny = segments[1] ? Math.sign(seg.y - segments[1].y) : 0;
        ctx.fillStyle = "#0a0f1e";
        const ex = x + w / 2 + nx * 2.6, ey = y + w / 2 + ny * 2.6;
        ctx.beginPath(); ctx.arc(ex - ny * 3, ey - nx * 3, 1.5, 0, 7); ctx.arc(ex + ny * 3, ey + nx * 3, 1.5, 0, 7); ctx.fill();
      }
    });
    return;
  }

  if (s.slug === "breaker") {
    const sx = W / 20, sy = H / 24;
    const bricks = s.bricks as number[];
    bricks.forEach((mask, r) => {
      const colr = ROW_COLORS[r] ?? color;
      for (let c = 0; c < 10; c++) {
        if (!((mask >> c) & 1)) continue;
        const x = c * 2 * sx + 1.5, y = (2 + r) * sy + 1.5, w = 2 * sx - 3, h = sy - 3;
        ctx.fillStyle = vgrad(ctx, y, y + h, [[0, rgba(colr, 1)], [0.55, rgba(colr, 0.8)], [1, rgba(colr, 0.5)]]);
        rr(ctx, x, y, w, h, 3); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.45)"; ctx.fillRect(x + 3, y + 1.6, w - 6, 1.5);
      }
    });
    const paddle = s.paddle as { start: number; width: number };
    const px = paddle.start * sx, pw = paddle.width * sx;
    glowDot(ctx, px + pw / 2, 22 * sy + sy / 2, 6, color);
    ctx.fillStyle = vgrad(ctx, 22 * sy, 23 * sy, [[0, "#eafffb"], [0.5, color], [1, rgba(color, 0.55)]]);
    rr(ctx, px, 22 * sy + 1, pw, sy - 3, (sy - 3) / 2); ctx.fill();
    const ball = s.ball as { x: number; y: number };
    glowDot(ctx, ball.x * sx, ball.y * sy, 4.2, "#ffffff");
    return;
  }

  if (s.slug === "thermonuclear") {
    interface City { name: string; pop: number; alive: boolean }
    interface Side { cities: City[]; silos: number; warheads: number; interceptors: number }
    const you = s.you as Side, foe = s.foe as Side;
    const defcon = s.defcon as number, turn = s.turn as number, maxTurns = s.maxTurns as number;
    const dcol = defcon <= 2 ? "#ff4444" : "#ffb02e";
    ctx.fillStyle = rgba(dcol, 0.16); rr(ctx, 8, 4, 92, 17, 5); ctx.fill();
    ctx.strokeStyle = rgba(dcol, 0.65); rr(ctx, 8, 4, 92, 17, 5); ctx.stroke();
    hud(ctx, "DEFCON " + defcon, 15, 16.5, dcol, 12);
    hud(ctx, "TURN " + turn + "/" + maxTurns, 122, 16.5);
    hud(ctx, "SCORE " + s.score, 240, 16.5);
    hud(ctx, "YOU", 10, 37, "#57b6ff", 10);
    hud(ctx, "RED", 284, 37, "#ff6b6b", 10);
    const rowY = (i: number) => 56 + i * 27;
    const drawSide = (side: Side, x: number, colr: string) => {
      side.cities.forEach((c, i) => {
        const y = rowY(i);
        if (c.alive) {
          glowDot(ctx, x + 5, y - 3, 3.6, colr);
          ctx.strokeStyle = rgba(colr, 0.35 + 0.2 * Math.sin(t / 500 + i));
          ctx.beginPath(); ctx.arc(x + 5, y - 3, 7, 0, 7); ctx.stroke();
        } else {
          ctx.fillStyle = "#3a3a4a";
          ctx.beginPath(); ctx.arc(x + 5, y - 3, 3.4, 0, 7); ctx.fill();
        }
        ctx.font = "10px monospace";
        ctx.fillStyle = c.alive ? "#e6eefc" : "#5d6478";
        ctx.fillText(c.name.toUpperCase().slice(0, 11), x + 14, y);
        ctx.fillText(c.alive ? c.pop + "M" : "XX", x + 108, y);
        if (!c.alive) { ctx.strokeStyle = rgba("#ff4444", 0.7); ctx.beginPath(); ctx.moveTo(x + 12, y - 8); ctx.lineTo(x + 104, y + 2); ctx.stroke(); }
      });
    };
    drawSide(you, 4, "#2e9bff");
    drawSide(foe, 168, "#ff4444");
    const launches = (s.lastLaunches as { side: string; target: string; kind: string; result: string }[]) ?? [];
    for (const l of launches) {
      const fromYou = l.side === "you";
      const defSide = fromYou ? foe : you;
      const idx = l.kind === "city" ? defSide.cities.findIndex((c) => c.name === l.target) : 2;
      const x0 = fromYou ? 30 : 290, x1 = fromYou ? 290 : 30;
      const y1 = rowY(Math.max(0, idx)) - 3;
      const ac = l.result === "intercepted" ? "#39ffdc" : "#ffb02e";
      ctx.strokeStyle = rgba(ac, 0.28); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x0, 150); ctx.quadraticCurveTo(160, 30, x1, y1); ctx.stroke();
      ctx.strokeStyle = ac; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(x0, 150); ctx.quadraticCurveTo(160, 30, x1, y1); ctx.stroke();
      glowDot(ctx, x1, y1, 3, l.result === "destroyed" ? "#ff4444" : "#ffffff");
      ctx.lineWidth = 1;
    }
    ctx.font = "10px monospace"; ctx.fillStyle = "#93a4c4";
    ctx.fillText(`YOU W${you.warheads} I${you.interceptors} S${you.silos}   RED W${foe.warheads} I${foe.interceptors} S${foe.silos}`, 8, 232);
    const events = (s.lastEvents as string[]) ?? [];
    ctx.fillStyle = "#7dff2e"; ctx.font = "9.5px monospace";
    events.slice(-3).forEach((e, i) => ctx.fillText(e.slice(0, 52), 8, 254 + i * 14));
    if (s.status === "over") {
      ctx.fillStyle = "#ffe600"; ctx.font = "bold 12px monospace";
      const label = s.outcome === "the_only_winning_move" ? "WINNER: NONE" : "OUTCOME: " + String(s.outcome ?? "").replace(/_/g, " ").toUpperCase();
      ctx.fillText(label, 8, 296 - 14);
    }
    return;
  }

  if (s.slug === "tictactoe") {
    const cells = s.cells as string[];
    const cell = 58, ox = (W - 3 * cell) / 2, oy = 44;
    hud(ctx, "BOARD " + (s.boardNumber as number) + "/9", 10, 18);
    hud(ctx, "SCORE " + s.score, 130, 18);
    hud(ctx, `W${s.won as number} D${s.drawn as number} L${s.lost as number}`, 238, 18);
    ctx.fillStyle = "rgba(255,255,255,.045)";
    rr(ctx, ox - 8, oy - 8, 3 * cell + 16, 3 * cell + 16, 14); ctx.fill();
    ctx.strokeStyle = rgba(color, 0.22); rr(ctx, ox - 8, oy - 8, 3 * cell + 16, 3 * cell + 16, 14); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.lineWidth = 2; ctx.lineCap = "round";
    for (let i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(ox + i * cell, oy + 5); ctx.lineTo(ox + i * cell, oy + 3 * cell - 5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox + 5, oy + i * cell); ctx.lineTo(ox + 3 * cell - 5, oy + i * cell); ctx.stroke();
    }
    ctx.lineWidth = 1;
    cells.forEach((c, i) => {
      if (!c) return;
      const cx = ox + (i % 3) * cell + cell / 2, cy = oy + Math.floor(i / 3) * cell + cell / 2;
      if (c === "X") {
        glowDot(ctx, cx, cy, 12, color);
        ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.lineCap = "round";
        const d = 13;
        ctx.beginPath(); ctx.moveTo(cx - d, cy - d); ctx.lineTo(cx + d, cy + d); ctx.moveTo(cx + d, cy - d); ctx.lineTo(cx - d, cy + d); ctx.stroke();
      } else {
        glowDot(ctx, cx, cy, 12, "#ff2e63");
        ctx.strokeStyle = "#ff2e63"; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(cx, cy, 13.5, 0, 7); ctx.stroke();
      }
      ctx.lineWidth = 1;
    });
    ctx.font = "10px monospace"; ctx.fillStyle = "#93a4c4";
    if (s.status === "over" && s.verdict) {
      const v = String(s.verdict);
      ctx.fillStyle = "#ffe600";
      ctx.fillText(v.slice(0, 44), 10, oy + 3 * cell + 26);
      if (v.length > 44) ctx.fillText(v.slice(44), 10, oy + 3 * cell + 40);
    } else if (s.lastResult) {
      ctx.fillText("LAST BOARD: " + String(s.lastResult).toUpperCase(), 10, oy + 3 * cell + 26);
    }
    return;
  }

  if (s.slug === "lightcycles") {
    const cell = 8, oy = 34;
    hud(ctx, "SCORE " + s.score, 10, 18);
    hud(ctx, "DEREZZED " + (s.derezzed as number), 130, 18);
    hud(ctx, ((s.tickMs as number) / 1000).toFixed(2) + "s/TICK", 238, 18);
    ctx.fillStyle = "rgba(0,0,10,.35)"; ctx.fillRect(0, oy - 6, 40 * cell, 30 * cell);
    ctx.strokeStyle = rgba(color, 0.16);
    ctx.beginPath();
    for (let gx = 0; gx <= 40; gx += 4) { ctx.moveTo(gx * cell + 0.5, oy - 6); ctx.lineTo(gx * cell + 0.5, oy - 6 + 30 * cell); }
    for (let gy = 0; gy <= 30; gy += 4) { ctx.moveTo(0, oy - 6 + gy * cell + 0.5); ctx.lineTo(40 * cell, oy - 6 + gy * cell + 0.5); }
    ctx.stroke();
    ctx.strokeStyle = rgba(color, 0.5); ctx.lineWidth = 1.6;
    ctx.strokeRect(0.5, oy - 6.5, 40 * cell - 1, 30 * cell - 1); ctx.lineWidth = 1;
    const paint = (trail: number[], colr: string, head: { x: number; y: number } | null) => {
      ctx.fillStyle = rgba(colr, 0.30);
      for (const c of trail) ctx.fillRect((c % 40) * cell - 0.5, oy - 6 + Math.floor(c / 40) * cell - 0.5, cell + 1, cell + 1);
      ctx.fillStyle = colr;
      for (const c of trail) ctx.fillRect((c % 40) * cell + 1, oy - 6 + Math.floor(c / 40) * cell + 1, cell - 2, cell - 2);
      if (head) glowDot(ctx, head.x * cell + cell / 2, oy - 6 + head.y * cell + cell / 2, 4.6, "#ffffff");
    };
    paint(s.trailRival as number[], "#ff5252", s.rival as { x: number; y: number } | null);
    paint(s.trailYou as number[], color, s.you as { x: number; y: number });
    if (s.status === "over") { ctx.fillStyle = "#ffe600"; ctx.font = "bold 12px monospace"; ctx.fillText("CRASHED — FINAL SCORE " + s.score, 8, 294); }
    return;
  }

  if (s.slug === "battleship") {
    const cell = 13, gy = 44;
    const grid = (str: string, ox: number, mode: "shots" | "fleet") => {
      ctx.strokeStyle = rgba("#4da3ff", 0.35); rr(ctx, ox - 3, gy - 3, 10 * cell + 5, 10 * cell + 5, 6); ctx.stroke();
      for (let i = 0; i < 100; i++) {
        const x = ox + (i % 10) * cell, y = gy + Math.floor(i / 10) * cell, ch = str[i];
        ctx.fillStyle = "rgba(77,163,255,.07)"; rr(ctx, x, y, cell - 1.5, cell - 1.5, 2.5); ctx.fill();
        if (ch === "o") { ctx.fillStyle = "#9db8dd"; ctx.beginPath(); ctx.arc(x + cell / 2, y + cell / 2, 1.8, 0, 7); ctx.fill(); }
        else if (ch === "x") { glowDot(ctx, x + cell / 2, y + cell / 2, 3.4, "#ffb02e"); }
        else if (ch === "#") {
          glowDot(ctx, x + cell / 2, y + cell / 2, 4.2, "#ff4444");
          ctx.strokeStyle = "#ffd7d7"; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(x + 3, y + 3); ctx.lineTo(x + cell - 4, y + cell - 4); ctx.moveTo(x + cell - 4, y + 3); ctx.lineTo(x + 3, y + cell - 4); ctx.stroke(); ctx.lineWidth = 1;
        }
        else if (ch === "s" && mode === "fleet") { ctx.fillStyle = vgrad(ctx, y, y + cell, [[0, "#7db9ff"], [1, "#2e6fd8"]]); rr(ctx, x + 0.5, y + 0.5, cell - 2.5, cell - 2.5, 2.5); ctx.fill(); }
      }
    };
    hud(ctx, "SCORE " + s.score, 10, 18);
    hud(ctx, "SHOTS " + (s.shotsFired as number), 130, 18);
    ctx.font = "bold 10px monospace"; ctx.fillStyle = "#9db8dd";
    ctx.fillText("THEIR WATERS — AFLOAT " + (s.enemyAfloat as number[]).join(","), 14, 36);
    ctx.fillText("YOUR FLEET — AFLOAT " + (s.yourAfloat as number[]).join(","), 168, 36);
    grid(s.yourShots as string, 14, "shots");
    grid(s.yourFleet as string, 168, "fleet");
    ctx.font = "9.5px monospace"; ctx.fillStyle = "#7dff2e";
    ((s.lastEvents as string[]) ?? []).slice(-3).forEach((e, i) => ctx.fillText(e.slice(0, 52), 10, 196 + i * 14));
    if (s.status === "over") { ctx.fillStyle = "#ffe600"; ctx.font = "bold 12px monospace"; ctx.fillText("OUTCOME: " + String(s.outcome ?? "").toUpperCase(), 10, 246); }
    return;
  }

  if (s.slug === "chess") {
    const fen = String(s.fen ?? "");
    const rows = fen.split(" ")[0].split("/");
    const cell = 29, ox = (W - 8 * cell) / 2, oy = 30;
    hud(ctx, "SCORE " + s.score, 10, 18);
    hud(ctx, "LAST: " + (s.lastMove ? String(s.lastMove) : "—"), 200, 18);
    ctx.strokeStyle = rgba(color, 0.4); ctx.lineWidth = 1.6;
    rr(ctx, ox - 4, oy - 4, 8 * cell + 8, 8 * cell + 8, 8); ctx.stroke(); ctx.lineWidth = 1;
    const GLYPH: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
    rows.forEach((rowStr, r) => {
      let c = 0;
      for (const ch of rowStr) {
        if (/\d/.test(ch)) {
          for (let k = 0; k < Number(ch); k++) { ctx.fillStyle = (r + c) % 2 ? "#232a44" : "#39406b"; ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell); c++; }
          continue;
        }
        ctx.fillStyle = (r + c) % 2 ? "#232a44" : "#39406b"; ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
        const white = ch === ch.toUpperCase();
        ctx.font = "21px serif"; ctx.textAlign = "center";
        ctx.shadowColor = white ? "rgba(160,220,255,.9)" : "rgba(255,90,120,.55)";
        ctx.shadowBlur = 7;
        ctx.fillStyle = white ? "#eaf6ff" : "#14101f";
        if (!white) { ctx.strokeStyle = "#ff8fa8"; ctx.lineWidth = 0.7; ctx.strokeText(GLYPH[ch.toLowerCase()], ox + c * cell + cell / 2, oy + r * cell + 22); }
        ctx.fillText(GLYPH[ch.toLowerCase()], ox + c * cell + cell / 2, oy + r * cell + 22);
        ctx.shadowBlur = 0; ctx.lineWidth = 1;
        ctx.textAlign = "left";
        c++;
      }
    });
    ctx.font = "10px monospace"; ctx.fillStyle = "#93a4c4";
    ctx.fillText("CAPTURED BY YOU: " + ((s.capturedByYou as string[]) ?? []).join(" ").toUpperCase(), 10, oy + 8 * cell + 18);
    ctx.fillText("CAPTURED BY HOUSE: " + ((s.capturedByHouse as string[]) ?? []).join(" ").toUpperCase(), 10, oy + 8 * cell + 32);
    if (s.status === "over") { ctx.fillStyle = "#ffe600"; ctx.font = "bold 12px monospace"; ctx.fillText("OUTCOME: " + String(s.outcome ?? "").toUpperCase(), 10, oy + 8 * cell + 50); }
    return;
  }

  if (s.slug === "checkers") {
    const board = String(s.board ?? "");
    const cell = 29, ox = (W - 8 * cell) / 2, oy = 30;
    hud(ctx, "SCORE " + s.score, 10, 18);
    hud(ctx, `TAKEN ${s.capturedByYou as number} · LOST ${s.capturedByHouse as number}`, 150, 18);
    ctx.strokeStyle = rgba(color, 0.4); ctx.lineWidth = 1.6;
    rr(ctx, ox - 4, oy - 4, 8 * cell + 8, 8 * cell + 8, 8); ctx.stroke(); ctx.lineWidth = 1;
    for (let i = 0; i < 64; i++) {
      const r = Math.floor(i / 8), c = i % 8;
      ctx.fillStyle = board[i] === "-" ? "#39406b" : "#232a44";
      ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
      if (s.mustContinueFrom === i) {
        ctx.strokeStyle = `rgba(255,230,0,${0.55 + 0.35 * Math.sin(t / 200)})`; ctx.lineWidth = 2;
        rr(ctx, ox + c * cell + 1.5, oy + r * cell + 1.5, cell - 3, cell - 3, 5); ctx.stroke(); ctx.lineWidth = 1;
      }
      const p = board[i];
      if (p === "a" || p === "A" || p === "h" || p === "H") {
        const mine = p === "a" || p === "A";
        const cx = ox + c * cell + cell / 2, cy = oy + r * cell + cell / 2, rad = cell / 2 - 3;
        const g = ctx.createRadialGradient(cx - rad / 3, cy - rad / 3, 1, cx, cy, rad);
        if (mine) { g.addColorStop(0, "#ffb3c2"); g.addColorStop(0.45, "#ff2e63"); g.addColorStop(1, "#a11236"); }
        else { g.addColorStop(0, "#ffffff"); g.addColorStop(0.45, "#cfd8ea"); g.addColorStop(1, "#7c8db0"); }
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.fill();
        ctx.strokeStyle = mine ? "rgba(255,160,180,.8)" : "rgba(20,30,60,.55)"; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(cx, cy, rad - 2.6, 0, 7); ctx.stroke(); ctx.lineWidth = 1;
        if (p === "A" || p === "H") {
          ctx.fillStyle = "#ffd94d";
          ctx.font = "bold 12px serif"; ctx.textAlign = "center";
          ctx.fillText("♛", cx, cy + 4.5);
          ctx.textAlign = "left";
        }
      }
    }
    ctx.font = "10px monospace"; ctx.fillStyle = "#93a4c4";
    if (s.mustContinueFrom !== undefined && s.mustContinueFrom !== null) ctx.fillText("JUMP AGAIN FROM SQUARE " + (s.mustContinueFrom as number), 10, oy + 8 * cell + 18);
    if (s.status === "over") { ctx.fillStyle = "#ffe600"; ctx.font = "bold 12px monospace"; ctx.fillText("OUTCOME: " + String(s.outcome ?? "").toUpperCase(), 10, oy + 8 * cell + 36); }
    return;
  }

  if (s.slug === "go") {
    const board = String(s.board ?? "");
    const cell = 26, ox = (W - 8 * cell) / 2, oy = 36;
    hud(ctx, "SCORE " + s.score, 10, 18);
    hud(ctx, `PRISONERS ${s.prisonersByYou as number} · MOVES ${s.moves as number}`, 130, 18);
    ctx.fillStyle = vgrad(ctx, oy - 14, oy + 8 * cell + 14, [[0, "#0b1226"], [1, "#060a18"]]);
    rr(ctx, ox - 13, oy - 13, 8 * cell + 26, 8 * cell + 26, 10); ctx.fill();
    ctx.strokeStyle = rgba("#39ffdc", 0.4); rr(ctx, ox - 13, oy - 13, 8 * cell + 26, 8 * cell + 26, 10); ctx.stroke();
    ctx.strokeStyle = "rgba(120,200,255,.34)";
    for (let i = 0; i < 9; i++) {
      ctx.beginPath(); ctx.moveTo(ox + i * cell, oy); ctx.lineTo(ox + i * cell, oy + 8 * cell); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox, oy + i * cell); ctx.lineTo(ox + 8 * cell, oy + i * cell); ctx.stroke();
    }
    ctx.fillStyle = "rgba(160,220,255,.5)";
    for (const [hx, hy] of [[2, 2], [6, 2], [4, 4], [2, 6], [6, 6]]) {
      ctx.beginPath(); ctx.arc(ox + hx * cell, oy + hy * cell, 2.2, 0, 7); ctx.fill();
    }
    for (let i = 0; i < 81; i++) {
      const p = board[i]; if (p === ".") continue;
      const cx = ox + (i % 9) * cell, cy = oy + Math.floor(i / 9) * cell, rad = cell / 2 - 1.6;
      const g = ctx.createRadialGradient(cx - rad / 3, cy - rad / 3, 1, cx, cy, rad);
      if (p === "B") { g.addColorStop(0, "#8fa5cf"); g.addColorStop(0.45, "#2c3c66"); g.addColorStop(1, "#0a1122"); }
      else { g.addColorStop(0, "#ffffff"); g.addColorStop(0.55, "#dfe9fa"); g.addColorStop(1, "#93a7c9"); }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.fill();
      if (p === "B") { // obsidian needs a hard rim light to read on the dark board
        ctx.strokeStyle = "rgba(185,215,255,.9)"; ctx.lineWidth = 1.3; ctx.stroke(); ctx.lineWidth = 1;
        ctx.fillStyle = "rgba(255,255,255,.75)";
        ctx.beginPath(); ctx.arc(cx - rad / 3, cy - rad / 3, rad / 5.2, 0, 7); ctx.fill();
      }
    }
    ctx.font = "10px monospace"; ctx.fillStyle = "#93a4c4";
    ctx.fillText("HOUSE LAST: " + (s.lastMove ? String(s.lastMove) : "—"), 10, oy + 8 * cell + 30);
    if (s.status === "over") { ctx.fillStyle = "#ffe600"; ctx.font = "bold 12px monospace";
      ctx.fillText("OUTCOME: " + String(s.outcome ?? "").toUpperCase() + " · MARGIN " + (s.finalMargin as number), 10, oy + 8 * cell + 48); }
    return;
  }
  if (s.slug === "grandprix") {
    // Grand Prix — pseudo-3D racer (ADR 0018; daylight rebuild to the
    // reference screenshots of 90s F1 games). The state was shaped for
    // this view: road[k] is the circuit sample 10k metres ahead (dx =
    // centre-line offset in metres from the player's own centre line,
    // curve = bend strength) and rivals carry relS (metres ahead) + lat.
    // A pinhole camera rides at the player's lateral position; the world
    // is projected and painted far-to-near: day sky, skyline, grass,
    // kerbs, asphalt, trackside scenery, sprite-style cars scaled by
    // distance, hero car, period HUD. The SCENE is bright like the
    // reference — blue sky, green grass, light grey asphalt, broad
    // red/white kerbs — while the COINOP identity lives in the branding
    // layer: teal hero livery with the QTR roundel, COINOP / QTR / BASE /
    // x402 / INSERT COIN billboards, the grandstand banner, and the
    // unchanged dark HUD. Rendering only — no state touched.
    const road = s.road as { dx: number; curve: number }[];
    const rivals = s.rivals as { id: number; relS: number; lat: number; kmh: number; color: string }[];
    const lat = s.lat as number;
    const steer = (s.steer as number) || 0;
    const throttle = (s.throttle as number) || 0;
    const raceMs = (s.raceMs as number) || 0;
    const speedFrac = Math.max(0, Math.min(1, ((s.speed as number) || 0) / 118));
    const fmtMs = (ms: number) => { const m = Math.floor(ms / 60000), sec = Math.floor((ms % 60000) / 1000), th = Math.floor(ms % 1000);
      return m + ":" + String(sec).padStart(2, "0") + "." + String(th).padStart(3, "0"); };
    const SEG_M = 10, ROAD_HALF = 6, CAM_H = 8, CAM_D = 1.0, Z0 = 6.7;
    const DRAW_N = Math.max(4, Math.min(30, road.length - 1));
    const horizon = Math.round(H * 0.40);
    const camX = lat * ROAD_HALF; // camera follows the car; the road moves
    const zAt = (k: number) => Z0 + k * SEG_M;
    const scAt = (k: number) => CAM_D / zAt(k);
    const dxAt = (k: number) => road[Math.max(0, Math.min(road.length - 1, Math.round(k)))]?.dx ?? 0;
    const cxAt = (k: number) => W / 2 + scAt(k) * (dxAt(k) - camX) * (W / 2);
    const yAt = (k: number) => horizon + scAt(k) * CAM_H * (H / 2);
    const hwAt = (k: number) => scAt(k) * ROAD_HALF * (W / 2);
    const ppmAt = (k: number) => scAt(k) * (W / 2); // screen px per world metre at segment k
    // The start/finish window: the stretch just after a lap crossing IS
    // the opening of the lap (lapMs is the only clock that knows), so
    // the grandstand and the city skyline live in its first seconds,
    // fading as the lap gets going.
    const lt = Math.min(raceMs, (s.lapMs as number) || 0);
    const standAlpha = lt >= 3200 ? 0 : lt <= 2300 ? 1 : 1 - (lt - 2300) / 900;

    // --- day sky: bright gradient, flat cloud shapes, a hazy skyline and
    // a tree-line ridge, all parallaxing gently against the far bend.
    ctx.fillStyle = vgrad(ctx, 0, horizon + 2, [[0, "#2b6fd6"], [0.55, "#6db1ef"], [1, "#d9efff"]]);
    ctx.fillRect(0, 0, W, horizon + 2);
    const farDx = Math.max(-60, Math.min(60, dxAt(DRAW_N)));
    const cloud = (x: number, y: number, sc: number) => {
      // Puffy clusters: a shaded underside, a broad lit base, and two
      // overlapping top puffs — flat 90s sky furniture, never bare.
      ctx.fillStyle = "rgba(176,200,228,.75)";
      ctx.beginPath(); ctx.ellipse(x, y + sc * 0.34, sc * 3.2, sc * 0.80, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x - sc * 1.6, y + sc * 0.30, sc * 1.7, sc * 0.55, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.95)";
      ctx.beginPath(); ctx.ellipse(x, y, sc * 2.6, sc * 0.95, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x - sc * 1.9, y + sc * 0.22, sc * 1.5, sc * 0.62, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + sc * 2.0, y + sc * 0.18, sc * 1.7, sc * 0.7, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + sc * 0.35, y - sc * 0.52, sc * 1.55, sc * 0.72, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x - sc * 0.75, y - sc * 0.34, sc * 1.15, sc * 0.55, 0, 0, 7); ctx.fill();
    };
    cloud(W * 0.16 + farDx * 0.22, horizon * 0.30, 6.4);
    cloud(W * 0.52 + farDx * 0.16, horizon * 0.16, 4.4);
    cloud(W * 0.83 + farDx * 0.26, horizon * 0.38, 7.2);
    cloud(W * 0.36 + farDx * 0.20, horizon * 0.52, 3.4);
    cloud(W * 0.64 + farDx * 0.18, horizon * 0.58, 2.7);
    cloud(W * 0.05 + farDx * 0.24, horizon * 0.62, 2.4);
    // City skyline behind the hills — only on the start/finish
    // stretch, fading with the grandstand window; pure hills
    // elsewhere. Two hazy rows (pale far, deeper near), a couple of
    // landmark towers with spires, a few lit windows. The tree-line
    // ridges drawn next bury the blocks' feet.
    if (standAlpha > 0) {
      ctx.save(); ctx.globalAlpha = standAlpha;
      const bw2 = W / 30;
      ctx.fillStyle = "rgba(168,198,232,.55)"; // far row, paler
      for (let i = 0; i < 30; i++) {
        const bh = 4 + ((i * 41) % 10) + (i % 5 === 3 ? 4 : 0);
        ctx.fillRect(i * bw2 + farDx * 0.45, horizon - bh, bw2 * 0.8, bh + 1);
      }
      ctx.fillStyle = "rgba(112,146,196,.85)"; // near row, deeper blue-grey
      for (let i = 0; i < 30; i++) {
        let bh = 6 + ((i * 67) % 13) + (i % 7 === 2 ? 6 : 0);
        if (i === 6 || i === 21) bh += 9; // landmark towers
        const bx = i * bw2 + farDx * 0.5, bwid = bw2 * 0.84;
        ctx.fillRect(bx, horizon - bh, bwid, bh + 1);
        if (i === 6 || i === 21) ctx.fillRect(bx + bwid * 0.42, horizon - bh - 2.5, bwid * 0.16, 2.5); // spires
        if (bwid > 5 && bh > 9) { // a few lit windows
          ctx.fillStyle = "rgba(255,217,160,.85)";
          const wn = 1 + ((i * 13) % 3);
          for (let q = 0; q < wn; q++) {
            const wx = bx + 1 + ((i * 29 + q * 7) % Math.max(2, Math.floor(bwid - 2)));
            const wy = horizon - bh + 2 + ((i * 17 + q * 5) % Math.max(2, Math.floor(bh - 4)));
            ctx.fillRect(wx, wy, 1.1, 1.4);
          }
          ctx.fillStyle = "rgba(112,146,196,.85)";
        }
      }
      ctx.restore();
    }
    ctx.fillStyle = "rgba(126,160,205,.7)"; // distant stand silhouettes
    for (const fx of [0.13, 0.68]) {
      const sx = W * fx + farDx * 0.6, sw = W * 0.17, sh = H * 0.052;
      ctx.fillRect(sx, horizon - sh, sw, sh);
      ctx.fillRect(sx - 2, horizon - sh - 3, sw + 4, 3); // roof line
    }
    // A whisper of low city blocks along the horizon on EVERY stretch
    // (the full skyline above is a start/finish extra) — very faint,
    // blue-grey, so the distance is never bare hills alone. The
    // tree-line ridges drawn next bury the blocks' feet.
    ctx.fillStyle = "rgba(148,178,214,.30)";
    for (let i = 0; i < 26; i++) {
      const bh = 3 + ((i * 53) % 7) + (i % 6 === 4 ? 2.5 : 0);
      ctx.fillRect(i * (W / 26) + farDx * 0.35, horizon - bh, (W / 26) * 0.7, bh + 1);
    }
    const ridge = (base: number, amp: number, f1: number, f2: number, shift: number, fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.moveTo(-4, horizon + 2);
      for (let x = -70; x <= W + 70; x += 7) {
        const y = horizon - base - amp * (0.55 + 0.45 * Math.sin((x + shift) * f1 + 1.7)) - amp * 0.4 * Math.sin((x + shift) * f2 + 0.4);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W + 4, horizon + 2); ctx.closePath(); ctx.fill();
    };
    ridge(H * 0.052, H * 0.030, 0.020, 0.047, farDx * 0.5, "#86b877");
    ridge(H * 0.026, H * 0.020, 0.031, 0.083, farDx * 1.15, "#679c5c");

    // --- trackside scenery, anchored to ABSOLUTE circuit segments. The
    // segment index comes from the renderer odometer (gpDistance: the
    // road samples alone can't supply it — on a dead-flat straight the
    // samples are bit-identical for hundreds of metres), hashed with
    // the segment's local fingerprint (curve + centre-line step) so the
    // same run replays with the same billboards in the same places and
    // they approach and pass with the road.
    const cvAt = (i: number) => road[Math.max(0, Math.min(road.length - 1, i))]?.curve ?? 0;
    const dxv = (i: number) => road[Math.max(0, Math.min(road.length - 1, i))]?.dx ?? 0;
    const shash = (a: number, b: number, c: number, d: number) => {
      let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1442695041) + Math.imul(d, 3266489917)) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return (h ^ (h >>> 16)) >>> 0;
    };
    const distNow = gpDistance(String(s.seedCommit ?? ""), raceMs, (s.speed as number) || 0);
    const baseSeg = Math.floor(distNow / SEG_M);
    // The start/finish gantry stands a short setback past the line
    // (lap distance GP_START_M, so the grid forms up just behind it):
    // visible while it sits inside the draw window ahead, looming as
    // the car closes on it, gone once passed. Position comes from the
    // same odometer as the rest of the scenery.
    const LAP_M = 480 * SEG_M, GP_START_M = 45;
    const lapDist = ((distNow % LAP_M) + LAP_M) % LAP_M;
    let gantryAhead = (GP_START_M - lapDist + LAP_M) % LAP_M;
    if (gantryAhead > DRAW_N * SEG_M || gantryAhead < SEG_M * 1.2) gantryAhead = -1;
    const gantryK = gantryAhead > 0 ? gantryAhead / SEG_M : -1;
    const BRANDS = [
      { text: "COINOP", bg: "#06231f", fg: "#39ffdc" },
      { text: "QTR", bg: "#39ffdc", fg: "#07332b" },
      { text: "BASE", bg: "#eef4ff", fg: "#0a1e3c" },
      { text: "x402", bg: "#0b0f16", fg: "#ffffff" },
      { text: "INSERT COIN", bg: "#170e02", fg: "#ffb02e" },
    ];
    const drawBillboard = (cx: number, baseY: number, ppm: number, brand: number, big = false) => {
      const b = BRANDS[brand];
      const bs = big ? 1.35 : 1;
      const bw = 12.5 * ppm * bs * (b.text.length > 5 ? 1.5 : 1), bh = 4.1 * ppm * bs, postH = 2.7 * ppm;
      const x0 = cx - bw / 2, yTop = baseY - postH - bh;
      ctx.fillStyle = "#3a3f45"; // posts
      const pw = Math.max(0.7, 0.32 * ppm);
      ctx.fillRect(cx - bw * 0.30 - pw / 2, baseY - postH, pw, postH);
      ctx.fillRect(cx + bw * 0.30 - pw / 2, baseY - postH, pw, postH);
      ctx.fillStyle = b.bg;
      ctx.fillRect(x0, yTop, bw, bh);
      ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = Math.max(0.6, ppm * 0.14);
      ctx.strokeRect(x0, yTop, bw, bh); ctx.lineWidth = 1;
      ctx.strokeStyle = b.fg; ctx.globalAlpha = 0.4;
      ctx.strokeRect(x0 + 1, yTop + 1, Math.max(0, bw - 2), Math.max(0, bh - 2));
      ctx.globalAlpha = 1;
      if (bw >= 15) {
        // The QTR board carries the coin mark — a gold Q coin beside
        // the word — once the board is big enough to hold it.
        const coin = brand === 1 && bw >= 26;
        let tx = cx;
        if (coin) {
          const cr = bh * 0.30, ccx = x0 + bh * 0.50, ccy = yTop + bh / 2;
          ctx.fillStyle = "#ffb02e";
          ctx.beginPath(); ctx.arc(ccx, ccy, cr, 0, 7); ctx.fill();
          ctx.strokeStyle = b.fg; ctx.lineWidth = Math.max(0.6, cr * 0.15);
          ctx.beginPath(); ctx.arc(ccx, ccy, cr * 0.80, 0, 7); ctx.stroke(); ctx.lineWidth = 1;
          ctx.fillStyle = "#07332b";
          ctx.font = `bold ${cr * 1.02}px Arial, sans-serif`;
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText("Q", ccx, ccy + 0.5);
          tx = cx + bh * 0.44;
        }
        ctx.fillStyle = b.fg;
        ctx.font = `bold ${Math.max(2.5, Math.min(bh * 0.52, (bw * 0.92) / (b.text.length * 0.66)))}px Arial, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(b.text, tx, yTop + bh / 2 + 0.5);
        ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      }
    };
    const drawTree = (cx: number, baseY: number, ppm: number, v: number, sv = 1) => {
      const one = (ox: number, s: number) => {
        const th = 5.6 * ppm * s;
        ctx.fillStyle = "#6b4a2f";
        ctx.fillRect(cx + ox - 0.22 * ppm * s, baseY - th * 0.34, 0.44 * ppm * s, th * 0.34);
        const blob = (bx: number, by: number, r: number, fill: string) => {
          ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(cx + ox + bx, baseY - th * 0.34 - by, r, 0, 7); ctx.fill();
        };
        blob(0, th * 0.30, th * 0.30, "#3e7d32");
        blob(-th * 0.20, th * 0.16, th * 0.22, "#4c8a3c");
        blob(th * 0.20, th * 0.18, th * 0.23, "#5da24a");
      };
      one(0, sv);
      if (v) one(2.6 * ppm, 0.62 * sv);
    };
    const drawPole = (cx: number, baseY: number, ppm: number, side: number) => {
      const ph2 = 7.2 * ppm;
      ctx.strokeStyle = "#2c3138"; ctx.lineWidth = Math.max(0.7, 0.16 * ppm);
      ctx.beginPath(); ctx.moveTo(cx, baseY); ctx.lineTo(cx, baseY - ph2);
      ctx.lineTo(cx - side * 1.7 * ppm, baseY - ph2); ctx.stroke(); ctx.lineWidth = 1;
      ctx.fillStyle = "#ffd9a0";
      ctx.fillRect(cx - side * 1.7 * ppm - 0.3 * ppm, baseY - ph2 - 0.18 * ppm, 0.6 * ppm, 0.36 * ppm);
    };
    // Corner-apex tyre stacks: two piles of three torus-ish tyres at
    // the inside kerb, in the classic red / white / dark-teal
    // rotation — sized boldly so they read from mid-distance.
    const drawTyreStack = (cx: number, baseY: number, ppm: number, v: number, side: number) => {
      const cols = ["#c9332c", "#e8ecf0", "#123f38"];
      const pile = (px: number, vv: number) => {
        const tw = 2.6 * ppm, th = 0.60 * ppm;
        for (let i = 0; i < 3; i++) {
          const y = baseY - (i + 1) * th;
          ctx.fillStyle = cols[(i + vv) % 3];
          rr(ctx, px - tw / 2, y, tw, th, th * 0.32); ctx.fill();
          ctx.strokeStyle = "rgba(0,0,0,.4)"; ctx.lineWidth = Math.max(0.5, ppm * 0.08); ctx.stroke(); ctx.lineWidth = 1;
          ctx.fillStyle = "#0b0c0f";
          ctx.beginPath(); ctx.ellipse(px, y + th / 2, tw * 0.20, th * 0.24, 0, 0, 7); ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,.20)";
          ctx.fillRect(px - tw * 0.36, y + th * 0.14, tw * 0.72, Math.max(0.5, th * 0.13));
        }
      };
      pile(cx, v);
      pile(cx + side * 3.0 * ppm, v + 1);
    };
    // A pit-box canopy on the pit lane: a dark back panel with a
    // team-colour band, a slanted awning on two posts — simple shapes
    // in the billboards' kit, read as the pit complex behind the wall.
    const PIT_COLS = ["#c9332c", "#3f6fb5", "#e0a83c", "#39ffdc", "#e8e4da", "#7a4fd0"];
    const drawPitBox = (cx: number, baseY: number, ppm: number, idx: number, alpha: number) => {
      const pw2 = 8.4 * ppm, ph2 = 3.6 * ppm, x0 = cx - pw2 / 2, topY = baseY - ph2;
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.fillStyle = "#3a3f45"; // posts
      const postW = Math.max(0.6, 0.3 * ppm);
      ctx.fillRect(x0 + 0.5 * ppm, topY + 0.7 * ppm, postW, ph2 - 0.7 * ppm);
      ctx.fillRect(x0 + pw2 - 0.5 * ppm - postW, topY + 0.7 * ppm, postW, ph2 - 0.7 * ppm);
      ctx.fillStyle = "#20262d"; // back panel
      ctx.fillRect(x0, topY + 0.9 * ppm, pw2, ph2 - 0.9 * ppm);
      ctx.fillStyle = PIT_COLS[idx % PIT_COLS.length]; // team band
      ctx.fillRect(x0, topY + 0.9 * ppm, pw2, 1.15 * ppm);
      ctx.fillStyle = "rgba(255,255,255,.16)"; // panel sheen + a dark bay opening
      ctx.fillRect(x0, topY + 2.05 * ppm, pw2, 0.28 * ppm);
      ctx.fillStyle = "rgba(0,0,0,.5)";
      ctx.fillRect(x0 + pw2 * 0.30, topY + 2.4 * ppm, pw2 * 0.4, ph2 - 2.4 * ppm);
      // awning: a slanted slab overhanging the panel, team colour
      // with a pale front edge
      ctx.fillStyle = PIT_COLS[idx % PIT_COLS.length];
      ctx.beginPath();
      ctx.moveTo(x0 - 0.7 * ppm, topY + 0.95 * ppm); ctx.lineTo(x0 + pw2 + 0.7 * ppm, topY + 0.95 * ppm);
      ctx.lineTo(x0 + pw2 + 0.2 * ppm, topY); ctx.lineTo(x0 - 0.2 * ppm, topY);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.4)"; ctx.lineWidth = Math.max(0.5, ppm * 0.08); ctx.stroke(); ctx.lineWidth = 1;
      ctx.fillStyle = "rgba(255,255,255,.55)";
      ctx.fillRect(x0 - 0.7 * ppm, topY + 0.82 * ppm, pw2 + 1.4 * ppm, Math.max(0.4, 0.16 * ppm));
      ctx.restore();
    };
    // The start/finish grandstand stands on the right inside the
    // start/finish window (standAlpha, computed with the projection
    // helpers above), fading as the lap gets going.
    const GS_K = 12;
    const drawGrandstand = (k: number, alpha: number) => {
      const baseY = yAt(k), ppm = ppmAt(k);
      const sw = 62 * ppm, sh = 15 * ppm;
      const x0 = cxAt(k) + hwAt(k) * 1.5;
      const topY = baseY - sh;
      ctx.save(); ctx.globalAlpha = alpha;
      // Timing tower on the road side of the stand: a slim block with
      // lit window slits and a teal cap.
      const tw = 6.5 * ppm, th2 = 21 * ppm, tx0 = x0 - tw - 2.4 * ppm;
      ctx.fillStyle = "#5d6d7d";
      ctx.fillRect(tx0, baseY - th2, tw, th2);
      ctx.fillStyle = "#39ffdc";
      ctx.fillRect(tx0, baseY - th2, tw, 0.9 * ppm);
      ctx.fillStyle = "#2c3947";
      ctx.fillRect(tx0, baseY - th2 + 0.9 * ppm, tw, 0.5 * ppm);
      ctx.fillStyle = "rgba(255,217,160,.92)";
      for (let q = 0; q < 3; q++) ctx.fillRect(tx0 + tw * 0.22, baseY - th2 + (2.4 + q * 5.6) * ppm, tw * 0.56, 1.5 * ppm);
      ctx.fillStyle = "rgba(16,22,30,.85)"; // clock face
      ctx.fillRect(tx0 + tw * 0.16, baseY - 7.6 * ppm, tw * 0.68, tw * 0.68);
      ctx.fillStyle = "#e8f4ff";
      ctx.fillRect(tx0 + tw * 0.44, baseY - 7.6 * ppm + tw * 0.10, tw * 0.09, tw * 0.26);
      ctx.fillRect(tx0 + tw * 0.44, baseY - 7.6 * ppm + tw * 0.32, tw * 0.30, tw * 0.09);
      // Seating: three stepped tiers with railing lines, dense crowd
      // speckle, and two stair aisles cutting the rows.
      const bh2 = 3.1 * ppm, seatTop = topY + sh * 0.15, seatBot = baseY - bh2;
      const tierH = (seatBot - seatTop) / 3;
      ctx.fillStyle = "#8d9aa7"; // base block behind the tiers
      ctx.fillRect(x0, seatTop, sw, seatBot - seatTop);
      const crowdCols = ["#c94f43", "#e8e4da", "#3f6fb5", "#e0a83c", "#5da24a", "#7a4fd0"];
      for (let r = 0; r < 3; r++) {
        const by = seatTop + r * tierH;
        ctx.fillStyle = r % 2 ? "#a3aeba" : "#98a5b3";
        ctx.fillRect(x0, by, sw, tierH);
        ctx.fillStyle = "rgba(240,246,255,.75)"; // railing along the tier front
        ctx.fillRect(x0, by + tierH - Math.max(0.6, ppm * 0.22), sw, Math.max(0.5, ppm * 0.16));
        ctx.fillStyle = "rgba(24,32,44,.35)"; // step shadow under the railing
        ctx.fillRect(x0, by + tierH, sw, Math.max(0.5, ppm * 0.14));
        if (ppm > 0.42) { // crowd speckle, jittered within the tier
          const n = Math.floor(sw / 1.05);
          for (let i = 0; i < n; i++) {
            const hh = ((i * 31 + r * 101) * 2654435761) >>> 0;
            if (hh % 6 === 0) continue;
            ctx.fillStyle = crowdCols[hh % 6];
            ctx.fillRect(x0 + 0.6 + (hh % Math.max(2, Math.floor(sw - 1.2))), by + 0.5 + ((hh >>> 7) % 40) / 40 * Math.max(0.6, tierH - 1.2), 1.05, 1.05);
          }
        }
      }
      for (const fx of [0.34, 0.67]) { // stair aisles: pale steps, no crowd
        const ax = x0 + sw * fx - ppm * 0.8;
        ctx.fillStyle = "#c3ccd4";
        ctx.fillRect(ax, seatTop, ppm * 1.6, seatBot - seatTop);
        ctx.fillStyle = "rgba(24,32,44,.30)";
        for (let q = 1; q < 5; q++) ctx.fillRect(ax, seatTop + (seatBot - seatTop) * q / 5, ppm * 1.6, Math.max(0.5, ppm * 0.14));
      }
      // Roof: slab on four posts, shadow thrown over the top tier,
      // teal under-edge — the COINOP lid on the stand.
      ctx.fillStyle = "rgba(18,26,36,.30)";
      ctx.fillRect(x0, seatTop - 0.4 * ppm, sw, tierH * 0.92);
      ctx.fillStyle = "#333f4d";
      for (let q = 0; q < 4; q++) ctx.fillRect(x0 + (sw - 0.55 * ppm) * q / 3, topY + 1.5 * ppm, 0.55 * ppm, seatTop - topY - 1.1 * ppm);
      ctx.fillStyle = "#22303e";
      ctx.fillRect(x0 - 1.6 * ppm, topY, sw + 3.2 * ppm, 1.5 * ppm);
      ctx.fillStyle = "#39ffdc";
      ctx.fillRect(x0 - 1.6 * ppm, topY + 1.5 * ppm, sw + 3.2 * ppm, 0.45 * ppm);
      // Front banner across the base — big and legible.
      const by2 = baseY - bh2;
      ctx.fillStyle = "#06231f"; ctx.fillRect(x0, by2, sw, bh2);
      ctx.fillStyle = "#39ffdc"; ctx.fillRect(x0, by2, sw, Math.max(0.5, 0.28 * ppm));
      if (sw >= 24) {
        ctx.fillStyle = "#39ffdc";
        ctx.font = `bold ${Math.min(bh2 * 0.60, sw / 5.8)}px Arial, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("COINOP", x0 + sw / 2, by2 + bh2 / 2 + 0.5);
        ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      }
      ctx.restore();
    };
    // The start/finish gantry: two steel posts at the road edges and a
    // truss banner across the top reading COINOP GRAND PRIX, with a
    // chequered skirt. Drawn at its projected distance (fractional
    // segment gantryK) after the road pass, so the road and nearer
    // scenery sit correctly around its feet.
    const drawGantry = () => {
      if (gantryK < 0) return;
      const baseY = yAt(gantryK), ppm = ppmAt(gantryK);
      const cx = cxAt(gantryK), hw = hwAt(gantryK);
      const postH = 8.6 * ppm, banH = 2.5 * ppm, banTop = baseY - postH;
      const px0 = cx - hw - 1.5 * ppm, px1 = cx + hw + 1.5 * ppm;
      const pw = Math.max(0.8, 0.62 * ppm);
      ctx.fillStyle = "rgba(0,0,0,.30)"; // feet shadows
      ctx.beginPath(); ctx.ellipse(px0 + pw / 2, baseY, 1.5 * ppm, 0.4 * ppm, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(px1 + pw / 2, baseY, 1.5 * ppm, 0.4 * ppm, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#2c3138"; // posts + truss uprights
      ctx.fillRect(px0, banTop, pw, postH);
      ctx.fillRect(px1, banTop, pw, postH);
      ctx.fillStyle = "rgba(255,255,255,.16)";
      ctx.fillRect(px0, banTop, Math.max(0.4, pw * 0.35), postH);
      ctx.fillRect(px1, banTop, Math.max(0.4, pw * 0.35), postH);
      if (ppm > 0.9) { // truss diagonals on the posts
        ctx.strokeStyle = "rgba(230,238,246,.35)"; ctx.lineWidth = Math.max(0.5, ppm * 0.09);
        for (const px of [px0, px1]) for (let q = 0; q < 3; q++) {
          ctx.beginPath();
          ctx.moveTo(px, baseY - q * postH / 3); ctx.lineTo(px + pw, baseY - (q + 1) * postH / 3);
          ctx.moveTo(px + pw, baseY - q * postH / 3); ctx.lineTo(px, baseY - (q + 1) * postH / 3);
          ctx.stroke();
        }
        ctx.lineWidth = 1;
      }
      // Banner: dark teal board, teal frame, the race name, and a
      // chequered skirt along its bottom edge.
      const bx0 = px0 - 0.7 * ppm, bw = (px1 + pw) - bx0 + 0.7 * ppm;
      ctx.fillStyle = "#06231f";
      ctx.fillRect(bx0, banTop, bw, banH);
      ctx.strokeStyle = "#39ffdc"; ctx.lineWidth = Math.max(0.6, ppm * 0.13);
      ctx.strokeRect(bx0, banTop, bw, banH); ctx.lineWidth = 1;
      const sq = banH * 0.30;
      for (let c = 0; c * sq < bw; c++) {
        ctx.fillStyle = c % 2 ? "#101216" : "#eef1f4";
        ctx.fillRect(bx0 + c * sq, banTop + banH - sq, Math.min(sq, bx0 + bw - (bx0 + c * sq)), sq);
      }
      if (bw >= 34) {
        ctx.fillStyle = "#39ffdc";
        ctx.font = `bold ${Math.min(banH * 0.44, (bw * 0.94) / (16 * 0.64))}px Arial, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("COINOP GRAND PRIX", cx + pw / 2, banTop + banH * 0.36);
        ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      }
    };

    // --- ground + road, far to near. Segment parity alternates the grass
    // (mow stripes) and asphalt shades; the sample window slides as the
    // car advances, so the bands stream toward the viewer — that
    // streaming is the speed read. Broad red/white kerbs frame a light
    // grey track, exactly the reference's read.
    ctx.fillStyle = "#5aa34a"; ctx.fillRect(0, horizon, W, H - horizon);
    const quad = (nl: number, nr: number, fr: number, fl: number, yN: number, yF: number) => {
      ctx.beginPath(); ctx.moveTo(nl, yN); ctx.lineTo(nr, yN); ctx.lineTo(fr, yF); ctx.lineTo(fl, yF); ctx.closePath(); ctx.fill();
    };
    for (let k = DRAW_N - 1; k >= 0; k--) {
      const yN = yAt(k), yF = yAt(k + 1);
      ctx.fillStyle = k % 2 ? "#4f9440" : "#5aa34a"; // grass: daytime green bands
      ctx.fillRect(0, yF, W, yN - yF + 1);
      const cxN = cxAt(k), cxF = cxAt(k + 1), hwN = hwAt(k), hwF = hwAt(k + 1);
      const abs = baseSeg + k, cv = cvAt(k);
      ctx.fillStyle = k % 4 < 2 ? "#cf352e" : "#eef1f4"; // BROAD kerbs at the edges
      quad(cxN - hwN * 1.30, cxN - hwN, cxF - hwF, cxF - hwF * 1.30, yN, yF);
      quad(cxN + hwN, cxN + hwN * 1.30, cxF + hwF * 1.30, cxF + hwF, yN, yF);
      ctx.fillStyle = k % 2 ? "#8f959c" : "#9aa0a7"; // asphalt, light grey
      quad(cxN - hwN, cxN + hwN, cxF + hwF, cxF - hwF, yN, yF);
      // The polished racing line: two tyre-wear bands that drift with
      // the bend, plus a darker swept arc laid over strong corners.
      const ws = Math.max(-0.3, Math.min(0.3, cv * 0.22));
      ctx.fillStyle = "rgba(40,44,52,.10)";
      quad(cxN + hwN * (-0.62 + ws), cxN + hwN * (-0.30 + ws), cxF + hwF * (-0.30 + ws), cxF + hwF * (-0.62 + ws), yN, yF);
      quad(cxN + hwN * (0.30 + ws), cxN + hwN * (0.62 + ws), cxF + hwF * (0.62 + ws), cxF + hwF * (0.30 + ws), yN, yF);
      if (Math.abs(cv) >= 0.55) { // faint dark tyre arcs through the bend
        ctx.fillStyle = `rgba(24,25,31,${Math.min(0.15, (Math.abs(cv) - 0.4) * 0.16)})`;
        const a0 = -0.28 + ws * 1.5, a1 = 0.28 + ws * 1.5;
        quad(cxN + hwN * a0, cxN + hwN * a1, cxF + hwF * a1, cxF + hwF * a0, yN, yF);
      }
      if (yN - yF >= 2) { // asphalt grain: a few deterministic speckles
        for (let j = 0; j < 5; j++) {
          const hh = shash(abs, j * 7 + 1, k, 99);
          const v = ((hh >>> 8) % 100) / 100, u = (hh % 100) / 100;
          const cxv = cxF + (cxN - cxF) * v, hwv = hwF + (hwN - hwF) * v;
          ctx.fillStyle = hh % 3 === 0 ? "rgba(255,255,255,.05)" : "rgba(28,30,36,.08)";
          ctx.fillRect(cxv + (u * 2 - 1) * hwv * 0.92, yF + (yN - yF) * v, Math.max(0.6, hwv * 0.022), Math.max(0.6, (yN - yF) * 0.3));
        }
      }
      ctx.fillStyle = "rgba(250,252,255,.85)"; // painted edge lines
      quad(cxN - hwN, cxN - hwN * 0.95, cxF - hwF * 0.95, cxF - hwF, yN, yF);
      quad(cxN + hwN * 0.95, cxN + hwN, cxF + hwF, cxF + hwF * 0.95, yN, yF);
      if (k % 6 < 3) { // centre dashes
        ctx.fillStyle = "rgba(255,255,255,.38)";
        quad(cxN - hwN * 0.022, cxN + hwN * 0.022, cxF + hwF * 0.022, cxF - hwF * 0.022, yN, yF);
      }
      if (gantryK > 0 && Math.abs(k - gantryK) < 0.55 && yN - yF >= 1.2) {
        // the chequered start line painted across the asphalt
        for (let r = 0; r < 2; r++) for (let c = 0; c < 12; c++) {
          const fA = r / 2, fB = (r + 1) / 2, uA = c / 12, uB = (c + 1) / 12;
          const yA = yF + (yN - yF) * fA, yB = yF + (yN - yF) * fB;
          const cxA = cxF + (cxN - cxF) * fA, hwA = hwF + (hwN - hwF) * fA;
          const cxB = cxF + (cxN - cxF) * fB, hwB = hwF + (hwN - hwF) * fB;
          ctx.fillStyle = (r + c) % 2 ? "#14151a" : "#eef1f4";
          quad(cxB + hwB * (uA * 2 - 1), cxB + hwB * (uB * 2 - 1), cxA + hwA * (uB * 2 - 1), cxA + hwA * (uA * 2 - 1), yB, yA);
        }
      }
      // --- start/finish furniture painted with the road band: grid
      // slots, the pit wall, catch fencing. All keyed to the absolute
      // segment like the scenery below (480 segments to a lap).
      const poly = (p: readonly (readonly [number, number])[]) => {
        ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]);
        for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
        ctx.closePath(); ctx.fill();
      };
      const segLap = ((abs % 480) + 480) % 480;
      if (segLap <= 4) {
        // staggered start-grid slots painted on the asphalt — one row
        // per segment, columns alternating, so the grid the rivals
        // line up on is drawn on the track itself
        const colOff = abs % 2 === 0 ? -0.42 : 0.42;
        const spt = (f: number, u: number) => {
          const yy = yF + (yN - yF) * f, cc = cxF + (cxN - cxF) * f, hh2 = hwF + (hwN - hwF) * f;
          return [cc + hh2 * u, yy] as const;
        };
        const c1 = spt(0.88, colOff - 0.39), c2 = spt(0.88, colOff + 0.39), c3 = spt(0.14, colOff + 0.39), c4 = spt(0.14, colOff - 0.39);
        ctx.strokeStyle = "rgba(255,255,255,.75)"; ctx.lineWidth = Math.max(0.6, ppmAt(k) * 0.09);
        ctx.beginPath();
        ctx.moveTo(c1[0], c1[1]); ctx.lineTo(c2[0], c2[1]); ctx.lineTo(c3[0], c3[1]); ctx.lineTo(c4[0], c4[1]);
        ctx.closePath(); ctx.stroke(); ctx.lineWidth = 1;
      }
      if (standAlpha > 0 && k >= 6 && k <= 18) {
        // pit wall on the left, opposite the grandstand: a long low
        // concrete wall with a painted top edge and a teal pinstripe,
        // COINOP lettered on its face
        const ppmN = ppmAt(k), ppmF = ppmAt(k + 1);
        const wx = (kk: number) => cxAt(kk) - hwAt(kk) * 1.44;
        ctx.save(); ctx.globalAlpha = standAlpha;
        ctx.fillStyle = k % 2 ? "#8f979f" : "#99a1a8";
        poly([[wx(k), yN], [wx(k + 1), yF], [wx(k + 1), yF - ppmF * 1.05], [wx(k), yN - ppmN * 1.05]]);
        ctx.fillStyle = "rgba(0,0,0,.22)"; // base shadow band
        poly([[wx(k), yN], [wx(k + 1), yF], [wx(k + 1), yF - ppmF * 0.14], [wx(k), yN - ppmN * 0.14]]);
        ctx.fillStyle = "#edf1f4"; // painted top edge
        poly([[wx(k), yN - ppmN * 1.05], [wx(k + 1), yF - ppmF * 1.05], [wx(k + 1), yF - ppmF * 0.85], [wx(k), yN - ppmN * 0.85]]);
        ctx.fillStyle = "rgba(57,255,220,.75)"; // teal pinstripe under the cap
        poly([[wx(k), yN - ppmN * 0.85], [wx(k + 1), yF - ppmF * 0.85], [wx(k + 1), yF - ppmF * 0.78], [wx(k), yN - ppmN * 0.78]]);
        if (k === 13 && ppmN >= 0.5) {
          ctx.fillStyle = "#07332b";
          ctx.font = `bold ${ppmN * 0.5}px Arial, sans-serif`;
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText("COINOP", wx(k), yN - ppmN * 0.42);
          ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        }
        ctx.restore();
      }
      {
        // catch fencing just outside the kerbs: a faint mesh wash,
        // three wire lines and posts every other segment — lining the
        // whole start/finish stretch and scattered runs elsewhere,
        // hashed from the absolute segment like all GP scenery
        const startStretch = segLap < 42 || segLap >= 452;
        const scattered = shash(abs >> 3, 4242, 7, 11) % 4 === 0;
        const ppmK = ppmAt(k);
        if ((startStretch || scattered) && ppmK >= 0.22) {
          const FH = 2.3, BO = 1.37;
          const fpt = (kk: number, side: number, f: number) => {
            const yy = yAt(kk), pp = ppmAt(kk);
            return [cxAt(kk) + side * hwAt(kk) * BO, yy - pp * FH * f] as const;
          };
          for (const side of [-1, 1]) {
            if (standAlpha > 0 && side > 0 && k >= 9 && k <= 20) continue; // grandstand frontage
            if (standAlpha > 0 && side < 0 && k >= 6 && k <= 18) continue; // the pit wall stands here
            const b0 = fpt(k, side, 0), b1 = fpt(k + 1, side, 0), t0 = fpt(k, side, 1), t1 = fpt(k + 1, side, 1);
            ctx.fillStyle = "rgba(205,222,238,.05)";
            poly([b0, b1, t1, t0]);
            if (ppmK >= 0.3) {
              ctx.fillStyle = "rgba(215,228,242,.30)";
              for (const f of [0.36, 0.68, 1.0]) {
                const a = fpt(k, side, f), b = fpt(k + 1, side, f), th = Math.max(0.4, ppmK * 0.045);
                poly([a, b, [b[0], b[1] + th], [a[0], a[1] + th]]);
              }
              if (abs % 2 === 0) { // fence post at this segment's near edge
                const pw3 = Math.max(0.5, ppmK * 0.08);
                ctx.fillStyle = "rgba(38,44,52,.85)";
                ctx.fillRect(b0[0] - pw3 / 2, t0[1], pw3, b0[1] - t0[1]);
              }
            }
          }
        }
      }
      // scenery anchored to this segment, painted with its band so
      // nearer segments overpaint farther scenery bases
      if (k === GS_K && standAlpha > 0) drawGrandstand(k, standAlpha);
      const ppm = ppmAt(k);
      if (ppm >= 0.34 && k >= 2) {
        const h = shash(abs, abs * 31 + 7, Math.round(cv * 24), Math.round((dxv(k + 1) - dxv(k)) * 4));
        const nearStand = standAlpha > 0 && k >= 8 && k <= 20;
        const pitSeg = standAlpha > 0 && (k === 9 || k === 12 || k === 15);
        const wallZone = standAlpha > 0 && k >= 6 && k <= 18;
        if (h % 7 === 3) {
          // mow patch: a big soft tonal ellipse on the grass, so the
          // fields read as mown ground, not flat colour bands
          const pside = (h >>> 9) % 2 === 0 ? -1 : 1;
          ctx.fillStyle = (h >>> 11) % 2 ? "rgba(255,255,214,.05)" : "rgba(8,46,18,.06)";
          ctx.beginPath();
          ctx.ellipse(cxN + pside * hwN * 2.9, (yN + yF) / 2, hwN * 1.6, Math.max(1, (yN - yF) * 1.6), 0, 0, 7);
          ctx.fill();
        }
        if (pitSeg) drawPitBox(cxN - hwN * 2.35, yN, ppm, k / 3 - 3, standAlpha);
        if (h % 5 === 2) {
          const side = (h >>> 6) % 2 === 0 ? -1 : 1;
          if (!(nearStand && side > 0) && !(wallZone && side < 0)) {
            const tt = (h >>> 4) % 10;
            const bx = cxN + side * hwN * (tt < 5 ? 2.05 : tt < 8 ? 1.85 : 1.5);
            if (tt < 5) drawBillboard(bx, yN, ppm, (h >>> 8) % 5);
            else if (tt < 8) drawTree(bx, yN, ppm, (h >>> 8) % 2, 0.85 + ((h >>> 10) % 3) * 0.22);
            else drawPole(bx, yN, ppm, side);
          }
        } else if (h % 11 === 5) { // a rarer, larger board standing closer
          const side = (h >>> 6) % 2 === 0 ? -1 : 1;
          if (!(nearStand && side > 0) && !(wallZone && side < 0)) drawBillboard(cxN + side * hwN * 1.72, yN, ppm, (h >>> 8) % 5, true);
        }
        // tyre stacks guard the inside of strong corners
        if (Math.abs(cv) >= 0.6 && shash(abs, 777, k, 3) % 3 === 0) {
          const side = cv > 0 ? 1 : -1;
          if (!(nearStand && side > 0) && !(wallZone && side < 0)) drawTyreStack(cxN + side * hwN * 1.52, yN, ppm, (h >>> 5) % 3, side);
        }
      }
    }
    drawGantry();

    // --- cars: sprite-style rear-view open-wheelers sitting on groundY,
    // total width w (the wing is the widest part). Every car — hero and
    // rivals alike — is BUILT FROM PARTS in the reference's layers:
    // full-width rear wing with endplates, a name across the wing, pylons,
    // very wide rear tyres with tread and sidewall detail standing clear
    // of a much narrower tapered body, full suspension arms and
    // uprights, an exposed rear machinery panel with a four-tip
    // exhaust cluster and diffuser strakes, sidepod shoulders with a
    // livery sweep, a spined engine cover, a tapered airbox, cockpit +
    // helmet, mirror stalks, and a bold livery centre stripe. Each part
    // takes a different rung of the shade() ladder with a crisp dark
    // outline, so the silhouette reads as a detailed car at any distance;
    // fine detail fades in as the car grows.
    const RIVAL_LABELS = ["APEX", "NOVA", "VOLT", "ONYX", "GRID"];
    const drawCar = (x: number, groundY: number, w: number, hex: string, hero: boolean, label: string, accent: string, scheme: number) => {
      const h = w * 0.5;
      const Y = (f: number) => groundY - h * f; // height fraction -> y
      const dark = shade(hex, 0.45), darker = shade(hex, 0.28), light = shade(hex, 1.45);
      const ol = "rgba(0,0,0,0.55)";
      const lw = Math.max(0.5, Math.min(1.6, w * 0.008));
      const part = (x0: number, y0: number, w0: number, h0: number, r: number) => {
        rr(ctx, x0, y0, w0, h0, r); ctx.fill();
        ctx.strokeStyle = ol; ctx.lineWidth = lw; ctx.stroke(); ctx.lineWidth = 1;
      };
      // ground shadow + tyre contact patches
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.beginPath(); ctx.ellipse(x, groundY - h * 0.02, w * 0.52, h * 0.09, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,.45)";
      ctx.beginPath(); ctx.ellipse(x - w * 0.375, groundY - h * 0.015, w * 0.10, h * 0.045, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + w * 0.375, groundY - h * 0.015, w * 0.10, h * 0.045, 0, 0, 7); ctx.fill();
      // very wide rear tyres at the outer edges of the lower car —
      // chunkier now, and shaded like rubber in sun: a lit shoulder
      // rolling down through mid-tones to a near-black contact band
      const tyre = (tx: number) => {
        const tw = w * 0.20, tt = Y(0.64), th = h * 0.64;
        const tg = ctx.createLinearGradient(0, tt, 0, groundY);
        tg.addColorStop(0, "#2e2e34"); tg.addColorStop(0.38, "#141418");
        tg.addColorStop(0.78, "#0a0a0d"); tg.addColorStop(1, "#030304");
        ctx.fillStyle = tg;
        part(tx, tt, tw, th, Math.min(3, w * 0.03));
        ctx.fillStyle = "rgba(255,255,255,.14)"; // lit shoulder band
        ctx.fillRect(tx + w * 0.014, tt + h * 0.025, tw - w * 0.028, h * 0.05);
        ctx.fillStyle = "rgba(0,0,0,.55)"; // contact band pressed to the road
        ctx.fillRect(tx + w * 0.006, groundY - h * 0.055, tw - w * 0.012, h * 0.05);
        if (w >= 56) { // tread grooves across the contact face
          ctx.fillStyle = "rgba(255,255,255,.08)";
          for (let g = 1; g <= 4; g++)
            ctx.fillRect(tx + (tw * g) / 5 - w * 0.006, tt + h * 0.04, w * 0.012, h * 0.56);
          ctx.fillRect(tx + w * 0.012, tt + th * 0.55, tw - w * 0.024, h * 0.028);
        }
        if (w >= 34) { // sidewall ring
          ctx.strokeStyle = "#3d3d46"; ctx.lineWidth = Math.max(1, w * 0.013);
          rr(ctx, tx + w * 0.042, tt + h * 0.095, w * 0.116, h * 0.45, Math.min(2, w * 0.02)); ctx.stroke(); ctx.lineWidth = 1;
        }
        if (hero && w >= 40) { // teal tyre ring on the hero, tyre-supplier style
          ctx.strokeStyle = "rgba(57,255,220,.45)"; ctx.lineWidth = Math.max(0.8, w * 0.010);
          rr(ctx, tx + w * 0.022, tt + h * 0.05, w * 0.156, h * 0.54, Math.min(2.5, w * 0.025)); ctx.stroke(); ctx.lineWidth = 1;
        }
      };
      tyre(x - w * 0.475); tyre(x + w * 0.275);
      // suspension: lower wishbones, an upper arm and a pushrod per
      // side, running from the body out to upright blocks at the
      // tyres' inner faces
      if (w >= 30) {
        ctx.strokeStyle = "#0c0d10"; ctx.lineWidth = Math.max(0.8, w * 0.018);
        for (const m of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(x + m * w * 0.13, Y(0.36)); ctx.lineTo(x + m * w * 0.33, Y(0.30));
          ctx.moveTo(x + m * w * 0.13, Y(0.22)); ctx.lineTo(x + m * w * 0.33, Y(0.26));
          ctx.moveTo(x + m * w * 0.10, Y(0.52)); ctx.lineTo(x + m * w * 0.34, Y(0.47));
          ctx.moveTo(x + m * w * 0.16, Y(0.58)); ctx.lineTo(x + m * w * 0.335, Y(0.44));
          ctx.stroke();
        }
        ctx.lineWidth = 1;
        ctx.fillStyle = "#101216"; // uprights
        part(x - w * 0.315, Y(0.44), w * 0.035, h * 0.30, 1);
        part(x + w * 0.280, Y(0.44), w * 0.035, h * 0.30, 1);
      }
      // body / engine cover: ~45% of car width at the top, tapering up
      // from a wider base between the tyres, shaded light -> base -> dark
      const bg = ctx.createLinearGradient(0, Y(0.62), 0, groundY);
      bg.addColorStop(0, light); bg.addColorStop(0.35, shade(hex, 1.15));
      bg.addColorStop(0.7, hex); bg.addColorStop(1, darker);
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(x - w * 0.17, Y(0.62)); ctx.lineTo(x + w * 0.17, Y(0.62));
      ctx.lineTo(x + w * 0.30, Y(0.28)); ctx.lineTo(x + w * 0.34, Y(0.08));
      ctx.lineTo(x - w * 0.34, Y(0.08)); ctx.lineTo(x - w * 0.30, Y(0.28));
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = ol; ctx.lineWidth = lw; ctx.stroke(); ctx.lineWidth = 1;
      // livery stripes down the cover, in the car's accent — the
      // scheme varies per car (centre stripe, twin stripes, plain,
      // pinstripe) so the grid reads as distinct teams
      const stripeBand = (off: number, hTop: number, hBot: number) => {
        ctx.beginPath();
        ctx.moveTo(x + off - hTop, Y(0.615)); ctx.lineTo(x + off + hTop, Y(0.615));
        ctx.lineTo(x + off + hBot, Y(0.13)); ctx.lineTo(x + off - hBot, Y(0.13));
        ctx.closePath(); ctx.fill();
      };
      ctx.fillStyle = accent;
      if (scheme === 0) stripeBand(0, w * 0.052, w * 0.030);
      else if (scheme === 1) { stripeBand(-w * 0.052, w * 0.030, w * 0.018); stripeBand(w * 0.052, w * 0.030, w * 0.018); }
      else if (scheme === 3) { ctx.globalAlpha = 0.8; stripeBand(0, w * 0.014, w * 0.008); ctx.globalAlpha = 1; }
      ctx.fillStyle = "rgba(255,255,255,.12)";
      ctx.beginPath();
      ctx.moveTo(x - w * 0.035, Y(0.60)); ctx.lineTo(x + w * 0.035, Y(0.60));
      ctx.lineTo(x + w * 0.06, Y(0.10)); ctx.lineTo(x - w * 0.06, Y(0.10));
      ctx.closePath(); ctx.fill();
      // dark flanks where the cover curves away, so the body reads as a
      // sculpted spine rather than a flat pyramid
      ctx.fillStyle = darker; ctx.globalAlpha = 0.55;
      for (const m of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x + m * w * 0.115, Y(0.62)); ctx.lineTo(x + m * w * 0.185, Y(0.30));
        ctx.lineTo(x + m * w * 0.24, Y(0.08)); ctx.lineTo(x + m * w * 0.34, Y(0.08));
        ctx.lineTo(x + m * w * 0.30, Y(0.28)); ctx.lineTo(x + m * w * 0.17, Y(0.62));
        ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(0,0,0,.25)"; // shoulder crease across the cover
      ctx.fillRect(x - w * 0.295, Y(0.30), w * 0.59, h * 0.02);
      ctx.fillStyle = "rgba(255,255,255,.10)"; // cover highlight + lower step
      ctx.fillRect(x - w * 0.17, Y(0.56), w * 0.34, h * 0.018);
      ctx.fillStyle = "rgba(0,0,0,.18)";
      ctx.fillRect(x - w * 0.28, Y(0.20), w * 0.56, h * 0.02);
      // sidepod shoulders: sculpted blocks low on the flanks carrying
      // the livery — a bold accent sweep across each shoulder
      for (const m of [-1, 1]) {
        const pg = ctx.createLinearGradient(0, Y(0.40), 0, Y(0.16));
        pg.addColorStop(0, shade(hex, 1.02)); pg.addColorStop(1, shade(hex, 0.5));
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.moveTo(x + m * w * 0.13, Y(0.40)); ctx.lineTo(x + m * w * 0.29, Y(0.40));
        ctx.lineTo(x + m * w * 0.30, Y(0.16)); ctx.lineTo(x + m * w * 0.20, Y(0.16));
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = ol; ctx.lineWidth = lw; ctx.stroke(); ctx.lineWidth = 1;
        ctx.fillStyle = accent;
        if (scheme === 2) {
          // sidepod-block livery: the accent takes the whole shoulder
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.moveTo(x + m * w * 0.145, Y(0.385)); ctx.lineTo(x + m * w * 0.283, Y(0.385));
          ctx.lineTo(x + m * w * 0.29, Y(0.185)); ctx.lineTo(x + m * w * 0.205, Y(0.185));
          ctx.closePath(); ctx.fill();
          ctx.globalAlpha = 1;
        } else {
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.moveTo(x + m * w * 0.15, Y(0.375)); ctx.lineTo(x + m * w * 0.27, Y(0.375));
          ctx.lineTo(x + m * w * 0.28, Y(0.335)); ctx.lineTo(x + m * w * 0.165, Y(0.335));
          ctx.closePath(); ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      if (hero && w >= 80) { // number roundels on the engine-cover flanks
        for (const m of [-1, 1]) {
          ctx.fillStyle = "#f2f6fa";
          ctx.beginPath(); ctx.arc(x + m * w * 0.235, Y(0.27), w * 0.042, 0, 7); ctx.fill();
          ctx.strokeStyle = ol; ctx.lineWidth = lw; ctx.stroke(); ctx.lineWidth = 1;
          ctx.fillStyle = "#0b2030";
          ctx.font = `bold ${w * 0.055}px Arial, sans-serif`;
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText("1", x + m * w * 0.235, Y(0.27) + w * 0.004);
          ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        }
      }
      // the rear wing's shadow, thrown soft across the engine cover —
      // the spine and airbox drawn next cut through its middle,
      // leaving the shade lying on the bodywork either side of them
      ctx.fillStyle = "rgba(0,0,0,.18)";
      ctx.beginPath(); ctx.ellipse(x, Y(0.58), w * 0.33, h * 0.07, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,.10)";
      ctx.beginPath(); ctx.ellipse(x, Y(0.525), w * 0.37, h * 0.055, 0, 0, 7); ctx.fill();
      // exposed rear machinery between the tyres: engine block panel,
      // a four-tip exhaust cluster, diffuser strakes low — the
      // reference's busy rear end
      ctx.fillStyle = "#0b0c0f";
      ctx.beginPath();
      ctx.moveTo(x - w * 0.20, Y(0.31)); ctx.lineTo(x + w * 0.20, Y(0.31));
      ctx.lineTo(x + w * 0.26, Y(0.03)); ctx.lineTo(x - w * 0.26, Y(0.03));
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = ol; ctx.lineWidth = lw; ctx.stroke(); ctx.lineWidth = 1;
      if (w >= 36) { // diffuser strakes fanning across the panel's base
        ctx.strokeStyle = "rgba(200,210,220,.34)"; ctx.lineWidth = Math.max(0.6, w * 0.006);
        for (const o of [-0.17, -0.085, 0, 0.085, 0.17]) {
          ctx.beginPath(); ctx.moveTo(x + w * o, Y(0.105)); ctx.lineTo(x + w * o * 1.18, Y(0.012)); ctx.stroke();
        }
        ctx.lineWidth = 1;
        ctx.fillStyle = "rgba(255,255,255,.07)"; // panel top highlight
        ctx.fillRect(x - w * 0.185, Y(0.305), w * 0.37, h * 0.016);
      }
      if (w >= 44) {
        // Exhaust cluster: a recessed panel holding FOUR tips in a
        // row, heat tint above them — dense machinery, and crucially
        // not two pale rings staring back like eyes.
        const ew = w * 0.30, eh = h * 0.115, ex = x - ew / 2, ey = Y(0.235);
        ctx.fillStyle = "#05060a";
        rr(ctx, ex, ey, ew, eh, Math.min(2, w * 0.012)); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.14)"; ctx.lineWidth = Math.max(0.5, w * 0.004); ctx.stroke(); ctx.lineWidth = 1;
        ctx.fillStyle = "rgba(255,120,40,.13)"; // heat tint above the tips
        ctx.fillRect(ex + ew * 0.08, ey - h * 0.028, ew * 0.84, h * 0.024);
        for (let q = 0; q < 4; q++) {
          const tipX = ex + ew * (0.14 + q * 0.24), tipW = ew * 0.15, tipH = eh * 0.62, tipY = ey + eh * 0.19;
          const tg = ctx.createLinearGradient(0, tipY, 0, tipY + tipH);
          tg.addColorStop(0, "#aeb8c2"); tg.addColorStop(1, "#3a4048");
          ctx.fillStyle = tg;
          rr(ctx, tipX, tipY, tipW, tipH, Math.min(1.5, tipW * 0.3)); ctx.fill();
          ctx.fillStyle = "#07080a"; // bore
          ctx.fillRect(tipX + tipW * 0.22, tipY + tipH * 0.52, tipW * 0.56, tipH * 0.34);
        }
      }
      // engine spine: a raised ridge running down the cover toward
      // the airbox, with panel seams and cooling slats on its flanks
      ctx.fillStyle = shade(hex, 0.92);
      ctx.beginPath();
      ctx.moveTo(x - w * 0.055, Y(0.56)); ctx.lineTo(x + w * 0.055, Y(0.56));
      ctx.lineTo(x + w * 0.085, Y(0.30)); ctx.lineTo(x - w * 0.085, Y(0.30));
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = ol; ctx.lineWidth = lw; ctx.stroke(); ctx.lineWidth = 1;
      ctx.fillStyle = accent; // livery stripe rides the spine, same scheme as the cover
      if (scheme === 0) {
        ctx.beginPath();
        ctx.moveTo(x - w * 0.028, Y(0.555)); ctx.lineTo(x + w * 0.028, Y(0.555));
        ctx.lineTo(x + w * 0.042, Y(0.315)); ctx.lineTo(x - w * 0.042, Y(0.315));
        ctx.closePath(); ctx.fill();
      } else if (scheme === 1) {
        for (const o of [-0.024, 0.024]) {
          ctx.beginPath();
          ctx.moveTo(x + (o - 0.011) * w, Y(0.555)); ctx.lineTo(x + (o + 0.011) * w, Y(0.555));
          ctx.lineTo(x + (o + 0.013) * w, Y(0.315)); ctx.lineTo(x + (o - 0.013) * w, Y(0.315));
          ctx.closePath(); ctx.fill();
        }
      } else if (scheme === 3) {
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(x - w * 0.007, Y(0.555)); ctx.lineTo(x + w * 0.007, Y(0.555));
        ctx.lineTo(x + w * 0.009, Y(0.315)); ctx.lineTo(x - w * 0.009, Y(0.315));
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (w >= 30) { // specular streak down the spine's lit shoulder
        ctx.fillStyle = "rgba(255,255,255,.20)";
        ctx.beginPath();
        ctx.moveTo(x - w * 0.052, Y(0.55)); ctx.lineTo(x - w * 0.036, Y(0.55));
        ctx.lineTo(x - w * 0.048, Y(0.33)); ctx.lineTo(x - w * 0.066, Y(0.33));
        ctx.closePath(); ctx.fill();
      }
      if (w >= 56) {
        ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = Math.max(0.5, w * 0.005);
        for (const f of [0.40, 0.47]) { // panel seams across the spine
          ctx.beginPath(); ctx.moveTo(x - w * 0.068, Y(f)); ctx.lineTo(x + w * 0.068, Y(f)); ctx.stroke();
        }
        ctx.lineWidth = 1;
        ctx.fillStyle = "rgba(0,0,0,.4)"; // cooling slats beside the spine
        for (const m of [-1, 1]) for (let q = 0; q < 3; q++)
          ctx.fillRect(x + m * w * 0.105 - w * 0.016, Y(0.52) + q * h * 0.045, w * 0.032, h * 0.020);
      }
      // airbox: a tapered stack over the spine — wider base rising to
      // a shaped intake slot with a lit rim
      const abg = ctx.createLinearGradient(0, Y(0.86), 0, Y(0.52));
      abg.addColorStop(0, light); abg.addColorStop(1, shade(hex, 0.8));
      ctx.fillStyle = abg;
      ctx.beginPath();
      ctx.moveTo(x - w * 0.058, Y(0.86)); ctx.lineTo(x + w * 0.058, Y(0.86));
      ctx.lineTo(x + w * 0.098, Y(0.54)); ctx.lineTo(x - w * 0.098, Y(0.54));
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = ol; ctx.lineWidth = lw; ctx.stroke(); ctx.lineWidth = 1;
      if (w >= 20) {
        ctx.fillStyle = "#04050a";
        rr(ctx, x - w * 0.044, Y(0.86) + h * 0.028, w * 0.088, h * 0.115, w * 0.018); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.lineWidth = Math.max(0.5, w * 0.004);
        rr(ctx, x - w * 0.044, Y(0.86) + h * 0.028, w * 0.088, h * 0.115, w * 0.018); ctx.stroke(); ctx.lineWidth = 1;
      }
      if (w >= 20) { // specular streak down the airbox's lit edge
        ctx.fillStyle = "rgba(255,255,255,.18)";
        ctx.beginPath();
        ctx.moveTo(x - w * 0.056, Y(0.855)); ctx.lineTo(x - w * 0.042, Y(0.855));
        ctx.lineTo(x - w * 0.080, Y(0.545)); ctx.lineTo(x - w * 0.096, Y(0.545));
        ctx.closePath(); ctx.fill();
      }
      if (hero && w >= 60) { // QTR roundel on the airbox
        ctx.fillStyle = "#39ffdc";
        ctx.beginPath(); ctx.arc(x, Y(0.63), w * 0.040, 0, 7); ctx.fill();
        ctx.fillStyle = "#07332b"; ctx.font = `bold ${w * 0.052}px Arial, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("Q", x, Y(0.63) + w * 0.004);
        ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      }
      // cockpit opening, then the driver's helmet nested in it: a
      // colour crown with a team stripe over a dark visor band
      ctx.fillStyle = "#07080c";
      ctx.beginPath(); ctx.ellipse(x, Y(0.475), w * 0.105, h * 0.115, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#e8f4ff";
      ctx.beginPath(); ctx.ellipse(x, Y(0.46), w * 0.068, h * 0.135, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = ol; ctx.lineWidth = lw; ctx.stroke(); ctx.lineWidth = 1;
      if (w >= 26) {
        ctx.fillStyle = hex; // helmet crown in the car's colour
        ctx.beginPath(); ctx.ellipse(x, Y(0.46), w * 0.068, h * 0.135, 0, Math.PI, Math.PI * 2); ctx.fill();
        ctx.fillStyle = accent; // crown stripe in the livery accent
        ctx.fillRect(x - w * 0.016, Y(0.578), w * 0.032, h * 0.055);
        ctx.fillStyle = "#0a0d14"; // visor band
        ctx.fillRect(x - w * 0.058, Y(0.485), w * 0.116, h * 0.05);
        ctx.fillStyle = "rgba(255,255,255,.75)"; // gloss spot on the crown
        ctx.beginPath(); ctx.ellipse(x - w * 0.026, Y(0.545), w * 0.014, h * 0.026, -0.5, 0, 7); ctx.fill();
      }
      // mirror stalks at the body's top corners
      if (w >= 40) {
        ctx.strokeStyle = "#0c0d10"; ctx.lineWidth = Math.max(0.7, w * 0.012);
        for (const m of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(x + m * w * 0.15, Y(0.58)); ctx.lineTo(x + m * w * 0.225, Y(0.65)); ctx.stroke();
        }
        ctx.lineWidth = 1;
        ctx.fillStyle = shade(hex, 0.75);
        part(x - w * 0.277, Y(0.685), w * 0.052, h * 0.055, 1);
        part(x + w * 0.225, Y(0.685), w * 0.052, h * 0.055, 1);
      }
      // wing assembly: two pylons, a lower plane, endplates, and the main
      // plane on top carrying the car's name — drawn last, nearest the
      // viewer from behind
      ctx.fillStyle = shade(hex, 0.6);
      ctx.fillRect(x - w * 0.085, Y(0.84), w * 0.05, h * 0.24);
      ctx.fillRect(x + w * 0.035, Y(0.84), w * 0.05, h * 0.24);
      const lg = ctx.createLinearGradient(0, Y(0.74), 0, Y(0.68)); // lower wing plane
      lg.addColorStop(0, shade(hex, 0.95)); lg.addColorStop(1, shade(hex, 0.62));
      ctx.fillStyle = lg;
      part(x - w * 0.44, Y(0.74), w * 0.88, h * 0.06, 1.2);
      ctx.fillStyle = shade(hex, 0.42); // its darker underside
      ctx.fillRect(x - w * 0.44, Y(0.68), w * 0.88, h * 0.018);
      ctx.fillStyle = shade(hex, 0.65); // endplates
      part(x - w * 0.50, Y(0.97), w * 0.035, h * 0.33, 1.2);
      part(x + w * 0.465, Y(0.97), w * 0.035, h * 0.33, 1.2);
      const wg = ctx.createLinearGradient(0, Y(0.94), 0, Y(0.82)); // main plane
      wg.addColorStop(0, light); wg.addColorStop(0.55, shade(hex, 1.15)); wg.addColorStop(1, hex);
      ctx.fillStyle = wg;
      part(x - w * 0.50, Y(0.94), w, h * 0.12, 1.5);
      ctx.fillStyle = shade(hex, 0.30); // the main plane's dark underside face
      ctx.fillRect(x - w * 0.50, Y(0.82), w, h * 0.02);
      ctx.fillStyle = accent; // accent stripe in the livery accent
      ctx.fillRect(x - w * 0.50, Y(0.845), w, h * 0.022);
      ctx.fillStyle = shade(hex, 0.5); // gurney flap along the plane's top edge
      ctx.fillRect(x - w * 0.50, Y(0.952), w, Math.max(0.6, h * 0.02));
      if (w >= 44 && label) { // the car's name across the wing
        const [lr, lg, lb] = hexRgb(hex);
        ctx.fillStyle = (0.299 * lr + 0.587 * lg + 0.114 * lb) > 140 ? "#12151c" : "#f4f8ff";
        ctx.font = `bold ${Math.min(h * 0.105, (w * 0.86) / (label.length * 0.64))}px Arial, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(label, x, Y(0.88) + 0.5);
        ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      }
      if (hero) { // slim centre rain light — the one red thing on the car
        ctx.fillStyle = throttle < 0 ? "#ff2d20" : "rgba(255,45,32,.35)";
        if (throttle < 0) glowDot(ctx, x, Y(0.30), w * 0.05, "#ff2d20");
        ctx.fillRect(x - w * 0.017, Y(0.335), w * 0.034, h * 0.070);
      }
    };
    const vis = rivals.filter((r) => r.relS > 1 && r.relS < DRAW_N * SEG_M).sort((a, b) => b.relS - a.relS);
    for (const r of vis) {
      const z = Z0 + r.relS, sc = CAM_D / z;
      const x = W / 2 + sc * (dxAt(r.relS / SEG_M) + r.lat * ROAD_HALF - camX) * (W / 2);
      drawCar(x, horizon + sc * CAM_H * (H / 2), Math.max(3, sc * 6.2 * (W / 2)), r.color, false, RIVAL_LABELS[r.id % RIVAL_LABELS.length], accentOf(r.color), r.id % 4);
    }
    // --- hero car: pinned low-centre like the era's games, leaning on
    // the wheel and bouncing harder the faster it goes. It wears the
    // COINOP colours — deep teal with a #39ffdc accent and the QTR
    // roundel — never the cabinet's red. At ~55% of the frame the road
    // stays visible on both sides of it, as in the reference.
    const heroW = W * 0.55;
    const heroX = W / 2 + steer * W * 0.012;
    const heroY = H * 0.985 + Math.sin(raceMs / 45) * 1.3 * speedFrac;
    if (s.offTrack && s.status === "playing") { // grass flecks off the tyres
      ctx.fillStyle = "rgba(63,122,51,.55)";
      for (let i = 0; i < 6; i++) {
        const ph = (raceMs / 90 + i * 1.93) % 1;
        const side = i % 2 ? 1 : -1;
        ctx.beginPath();
        ctx.ellipse(heroX + side * heroW * (0.42 + ph * 0.22), heroY - ph * heroW * 0.16, 3.4 - ph * 1.8, 2.2 - ph, 0, 0, 7);
        ctx.fill();
      }
    }
    ctx.save();
    ctx.translate(heroX, heroY); ctx.rotate(steer * 0.035); ctx.translate(-heroX, -heroY);
    drawCar(heroX, heroY, heroW, "#0b4f45", true, "COINOP", "#39ffdc", 0);
    ctx.restore();

    // --- HUD: timing-tower strip up top, lap data low left, pedal lamps
    // low centre, big speed readout low right — chunky mono, COINOP
    // colours. Unchanged from the night build except a soft scrim under
    // the strip so the LAP TIME line stays legible over a bright sky.
    ctx.fillStyle = "rgba(2,5,10,.62)"; ctx.fillRect(0, 0, W, 30);
    const scrim = ctx.createLinearGradient(0, 30, 0, 58);
    scrim.addColorStop(0, "rgba(2,5,10,.45)"); scrim.addColorStop(1, "rgba(2,5,10,0)");
    ctx.fillStyle = scrim; ctx.fillRect(0, 30, W, 28);
    ctx.fillStyle = rgba(color, 0.35); ctx.fillRect(0, 30, W, 1);
    hud(ctx, `LAP ${s.lap as number}/${s.laps as number}`, 10, 20, "#e8f4ff", 13);
    ctx.textAlign = "center";
    hud(ctx, "TIME " + fmtMs(raceMs), W / 2, 20, "#cfe0f7", 11);
    ctx.textAlign = "right";
    ctx.font = "bold 19px monospace"; ctx.fillStyle = color;
    ctx.fillText("P" + (s.position as number), W - 26, 21);
    ctx.font = "bold 10px monospace"; ctx.fillStyle = "#9fb4d8";
    ctx.fillText("/" + (rivals.length + 1), W - 8, 21);
    ctx.textAlign = "left";
    const last = s.lastLapMs as number | null, best = s.bestLapMs as number | null;
    hud(ctx, "LAP TIME " + fmtMs((s.lapMs as number) || 0), 10, 46, "#9fb4d8", 10);
    if ((s.crashes as number) > 0) {
      ctx.textAlign = "right";
      hud(ctx, `CRASHES ${s.crashes as number}`, W - 10, 46, "#ff9f43", 10);
      ctx.textAlign = "left";
    }
    hud(ctx, "SCORE " + s.score, 10, H - 56, "#e8f4ff", 11);
    hud(ctx, last ? "LAST " + fmtMs(last) : "LAST —", 10, H - 40, "#9fb4d8", 10);
    hud(ctx, best ? "BEST " + fmtMs(best) : "BEST —", 10, H - 25, "#9fb4d8", 10);
    ctx.fillStyle = "rgba(2,5,10,.55)"; rr(ctx, W - 98, H - 60, 90, 52, 6); ctx.fill();
    ctx.strokeStyle = rgba(color, 0.30); rr(ctx, W - 98, H - 60, 90, 52, 6); ctx.stroke();
    ctx.textAlign = "right";
    ctx.font = "bold 30px monospace"; ctx.fillStyle = color;
    ctx.fillText(String(s.kmh as number), W - 16, H - 26);
    ctx.font = "bold 8px monospace"; ctx.fillStyle = "#9fb4d8";
    ctx.fillText("KM/H", W - 16, H - 13);
    ctx.textAlign = "left";
    const lamp = (cx: number, label: string, on: boolean, onCol: string) => {
      ctx.fillStyle = on ? onCol : "rgba(255,255,255,.07)";
      rr(ctx, cx - 15, H - 25, 30, 14, 3); ctx.fill();
      ctx.font = "bold 7.5px monospace"; ctx.textAlign = "center";
      ctx.fillStyle = on ? "#060a12" : "#5d6a84";
      ctx.fillText(label, cx, H - 15);
      ctx.textAlign = "left";
    };
    lamp(W / 2 - 18, "BRK", throttle < 0, "#ff5040");
    lamp(W / 2 + 18, "THR", throttle > 0, "#39ffdc");
    if (s.offTrack && s.status === "playing") {
      ctx.font = "bold 13px monospace"; ctx.textAlign = "center";
      ctx.fillStyle = (t % 800 < 480) ? "#ffb02e" : "rgba(255,176,46,.35)";
      ctx.fillText("OFF TRACK", W / 2, 66);
      ctx.textAlign = "left";
    }
    if (s.status === "over") {
      ctx.fillStyle = "rgba(3,4,10,.72)"; ctx.fillRect(0, H / 2 - 34, W, 68);
      ctx.font = "bold 17px monospace"; ctx.textAlign = "center"; ctx.fillStyle = s.finished ? "#39ffdc" : "#ffb02e";
      const msg = s.finished ? `FINISH — P${s.finalPosition as number}` : "TIME EXPIRED";
      ctx.fillText(msg, W / 2, H / 2 - 4);
      ctx.font = "bold 12px monospace"; ctx.fillStyle = "#e8f4ff";
      const sub = "SCORE " + s.score + (best ? " · BEST LAP " + fmtMs(best) : "");
      ctx.fillText(sub, W / 2, H / 2 + 18);
      ctx.textAlign = "left";
    }
    return;
  }

  ctx.fillStyle = "#fff"; ctx.font = "bold 12px monospace";
  ctx.fillText("NO RENDERER FOR " + s.slug.toUpperCase(), 8, 16);
}
