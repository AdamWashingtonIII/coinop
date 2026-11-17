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
    // Grand Prix — pseudo-3D racer (ADR 0018), F1GP / Monaco GP era viewed
    // through the COINOP kit. The state was shaped for this: road[k] is the
    // circuit sample 10k metres ahead (dx = centre-line offset in metres
    // from the player's own centre line, curve = bend strength) and rivals
    // carry relS (metres ahead) + lat. A pinhole camera rides at the
    // player's lateral position; the world is projected and painted
    // far-to-near: skyline, runoff, rumble strips, asphalt, rivals scaled
    // by distance, hero car, period HUD. Rendering only — no state touched.
    const road = s.road as { dx: number; curve: number }[];
    const rivals = s.rivals as { id: number; relS: number; lat: number; kmh: number; color: string }[];
    const lat = s.lat as number;
    const steer = (s.steer as number) || 0;
    const throttle = (s.throttle as number) || 0;
    const raceMs = (s.raceMs as number) || 0;
    const speedFrac = Math.max(0, Math.min(1, ((s.speed as number) || 0) / 118));
    const fmtMs = (ms: number) => { const m = Math.floor(ms / 60000), sec = Math.floor((ms % 60000) / 1000), th = Math.floor(ms % 1000);
      return m + ":" + String(sec).padStart(2, "0") + "." + String(th).padStart(3, "0"); };
    const SEG_M = 10, ROAD_HALF = 6.2, CAM_H = 11, CAM_D = 0.9, Z0 = 5;
    const DRAW_N = Math.max(4, Math.min(30, road.length - 1));
    const horizon = Math.round(H * 0.40);
    const camX = lat * ROAD_HALF; // camera follows the car; the road moves
    const zAt = (k: number) => Z0 + k * SEG_M;
    const scAt = (k: number) => CAM_D / zAt(k);
    const dxAt = (k: number) => road[Math.max(0, Math.min(road.length - 1, Math.round(k)))]?.dx ?? 0;
    const cxAt = (k: number) => W / 2 + scAt(k) * (dxAt(k) - camX) * (W / 2);
    const yAt = (k: number) => horizon + scAt(k) * CAM_H * (H / 2);
    const hwAt = (k: number) => scAt(k) * ROAD_HALF * (W / 2);

    // --- sky: deep-space gradient, stars, hall glow on the horizon, and
    // two silhouette ridges that parallax against the far bend.
    ctx.fillStyle = vgrad(ctx, 0, horizon + 2, [[0, "#04060f"], [0.62, "#081226"], [1, "#0a2033"]]);
    ctx.fillRect(0, 0, W, horizon + 2);
    ctx.fillStyle = "#cfe8ff";
    for (let i = 0; i < 42; i++) {
      ctx.globalAlpha = 0.16 + (i % 4) * 0.09;
      ctx.fillRect((i * 97.31) % W, (i * 57.77) % Math.max(8, horizon - 16), 1.1, 1.1);
    }
    ctx.globalAlpha = 1;
    const hGlow = ctx.createRadialGradient(W / 2, horizon, 4, W / 2, horizon, W * 0.55);
    hGlow.addColorStop(0, "rgba(57,255,220,0.20)"); hGlow.addColorStop(1, "rgba(57,255,220,0)");
    ctx.fillStyle = hGlow; ctx.fillRect(0, 0, W, horizon + 2);
    const farDx = Math.max(-60, Math.min(60, dxAt(DRAW_N)));
    const ridge = (base: number, amp: number, f1: number, f2: number, shift: number, fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.moveTo(-4, horizon + 2);
      for (let x = -70; x <= W + 70; x += 7) {
        const y = horizon - base - amp * (0.55 + 0.45 * Math.sin((x + shift) * f1 + 1.7)) - amp * 0.4 * Math.sin((x + shift) * f2 + 0.4);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W + 4, horizon + 2); ctx.closePath(); ctx.fill();
    };
    ridge(H * 0.085, H * 0.055, 0.020, 0.047, farDx * 0.5, "#0c1526");
    ridge(H * 0.028, H * 0.030, 0.031, 0.083, farDx * 1.15, "#060b16");
    for (let i = 0; i < 16; i++) { // floodlit grandstand specks on the near ridge
      ctx.fillStyle = i % 3 ? "rgba(57,255,220,.5)" : "rgba(255,176,46,.55)";
      ctx.fillRect((i * 61.7 + 12) % W, horizon - 3 - ((i * 29.3) % 9), 1.4, 1.4);
    }

    // --- ground + road, far to near. Segment parity alternates the runoff
    // and asphalt shades; the sample window slides as the car advances, so
    // the bands stream toward the viewer — that streaming is the speed read.
    ctx.fillStyle = "#050f09"; ctx.fillRect(0, horizon, W, H - horizon);
    const quad = (nl: number, nr: number, fr: number, fl: number, yN: number, yF: number) => {
      ctx.beginPath(); ctx.moveTo(nl, yN); ctx.lineTo(nr, yN); ctx.lineTo(fr, yF); ctx.lineTo(fl, yF); ctx.closePath(); ctx.fill();
    };
    for (let k = DRAW_N - 1; k >= 0; k--) {
      const yN = yAt(k), yF = yAt(k + 1);
      ctx.fillStyle = k % 2 ? "#07160d" : "#050f09";
      ctx.fillRect(0, yF, W, yN - yF + 1);
      const cxN = cxAt(k), cxF = cxAt(k + 1), hwN = hwAt(k), hwF = hwAt(k + 1);
      ctx.fillStyle = k % 4 < 2 ? "#c9333b" : "#dfe5ef"; // rumble strips, classic red/white
      quad(cxN - hwN * 1.18, cxN - hwN, cxF - hwF, cxF - hwF * 1.18, yN, yF);
      quad(cxN + hwN, cxN + hwN * 1.18, cxF + hwF * 1.18, cxF + hwF, yN, yF);
      ctx.fillStyle = k % 2 ? "#262b38" : "#20242f"; // asphalt
      quad(cxN - hwN, cxN + hwN, cxF + hwF, cxF - hwF, yN, yF);
      ctx.fillStyle = "rgba(232,238,250,.5)"; // painted edge lines
      quad(cxN - hwN, cxN - hwN * 0.94, cxF - hwF * 0.94, cxF - hwF, yN, yF);
      quad(cxN + hwN * 0.94, cxN + hwN, cxF + hwF, cxF + hwF * 0.94, yN, yF);
      if (k % 6 < 3) { // centre dashes
        ctx.fillStyle = "rgba(170,240,255,.28)";
        quad(cxN - hwN * 0.022, cxN + hwN * 0.022, cxF + hwF * 0.022, cxF - hwF * 0.022, yN, yF);
      }
    }

    // --- cars: rear-view open-wheelers sitting on groundY, body width w.
    // Far cars collapse to silhouette + wing; near cars get airbox, helmet,
    // and (hero only) a brake light that fires under braking.
    const drawCar = (x: number, groundY: number, w: number, hex: string, hero: boolean) => {
      const h = w * 0.52;
      ctx.fillStyle = "rgba(0,0,0,.42)";
      ctx.beginPath(); ctx.ellipse(x, groundY - h * 0.03, w * 0.54, h * 0.10, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#08080c"; // fat rear tyres
      rr(ctx, x - w * 0.52, groundY - h * 0.54, w * 0.17, h * 0.54, Math.min(3, w * 0.04)); ctx.fill();
      rr(ctx, x + w * 0.35, groundY - h * 0.54, w * 0.17, h * 0.54, Math.min(3, w * 0.04)); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.13)";
      ctx.fillRect(x - w * 0.52, groundY - h * 0.54, w * 0.17, h * 0.07);
      ctx.fillRect(x + w * 0.35, groundY - h * 0.54, w * 0.17, h * 0.07);
      ctx.fillStyle = "#0a0a10"; // diffuser / floor
      ctx.fillRect(x - w * 0.34, groundY - h * 0.17, w * 0.68, h * 0.17);
      ctx.fillStyle = vgrad(ctx, groundY - h * 0.66, groundY, [[0, hex], [1, rgba(hex, 0.55)]]);
      ctx.beginPath();
      ctx.moveTo(x - w * 0.20, groundY - h * 0.66);
      ctx.lineTo(x + w * 0.20, groundY - h * 0.66);
      ctx.lineTo(x + w * 0.37, groundY - h * 0.10);
      ctx.lineTo(x - w * 0.37, groundY - h * 0.10);
      ctx.closePath(); ctx.fill();
      if (w > 15) {
        ctx.fillStyle = "#101018"; // airbox intake
        rr(ctx, x - w * 0.065, groundY - h * 0.92, w * 0.13, h * 0.30, w * 0.03); ctx.fill();
        ctx.fillStyle = "#e8f4ff"; // helmet
        ctx.beginPath(); ctx.ellipse(x, groundY - h * 0.60, w * 0.095, h * 0.115, 0, 0, 7); ctx.fill();
        ctx.fillStyle = rgba(hex, 0.9); // helmet stripe in the car's colour
        ctx.beginPath(); ctx.ellipse(x, groundY - h * 0.635, w * 0.095, h * 0.05, 0, 0, 7); ctx.fill();
      }
      ctx.fillStyle = rgba(hex, 0.72); // lower wing plane
      rr(ctx, x - w * 0.44, groundY - h * 0.82, w * 0.88, h * 0.085, 1.5); ctx.fill();
      ctx.fillStyle = hex; // main rear wing
      rr(ctx, x - w * 0.53, groundY - h * 1.02, w * 1.06, h * 0.13, 2); ctx.fill();
      ctx.fillStyle = rgba(hex, 0.6); // endplates
      rr(ctx, x - w * 0.53, groundY - h * 1.02, w * 0.045, h * 0.36, 1.5); ctx.fill();
      rr(ctx, x + w * 0.485, groundY - h * 1.02, w * 0.045, h * 0.36, 1.5); ctx.fill();
      if (hero) {
        ctx.fillStyle = throttle < 0 ? "#ff2d20" : "rgba(255,45,32,.35)";
        if (throttle < 0) glowDot(ctx, x, groundY - h * 0.30, w * 0.09, "#ff2d20");
        ctx.fillRect(x - w * 0.032, groundY - h * 0.335, w * 0.064, h * 0.075);
      }
    };
    const vis = rivals.filter((r) => r.relS > 1 && r.relS < DRAW_N * SEG_M).sort((a, b) => b.relS - a.relS);
    for (const r of vis) {
      const z = Z0 + r.relS, sc = CAM_D / z;
      const x = W / 2 + sc * (dxAt(r.relS / SEG_M) + r.lat * ROAD_HALF - camX) * (W / 2);
      drawCar(x, horizon + sc * CAM_H * (H / 2), Math.max(3, sc * 5.6 * (W / 2)), r.color, false);
    }
    // --- hero car: pinned low-centre like the era's games, leaning on the
    // wheel and bouncing harder the faster it goes.
    const heroW = W * 0.40;
    const heroX = W / 2 + steer * W * 0.012;
    const heroY = H * 0.985 + Math.sin(raceMs / 45) * 1.3 * speedFrac;
    if (s.offTrack && s.status === "playing") { // grass flecks off the tyres
      ctx.fillStyle = "rgba(126,160,84,.5)";
      for (let i = 0; i < 6; i++) {
        const ph = (raceMs / 90 + i * 1.93) % 1;
        const side = i % 2 ? 1 : -1;
        ctx.beginPath();
        ctx.ellipse(heroX + side * heroW * (0.42 + ph * 0.22), heroY - ph * heroW * 0.16, 3.4 - ph * 1.8, 2.2 - ph, 0, 0, 7);
        ctx.fill();
      }
    }
    ctx.save();
    ctx.translate(heroX, heroY); ctx.rotate(steer * 0.05); ctx.translate(-heroX, -heroY);
    if (speedFrac > 0.02) glowDot(ctx, heroX, heroY - heroW * 0.2, heroW * 0.5, color);
    drawCar(heroX, heroY, heroW, color, true);
    ctx.restore();

    // --- HUD: timing-tower strip up top, lap data low left, pedal lamps
    // low centre, big speed readout low right — chunky mono, COINOP colours.
    ctx.fillStyle = "rgba(2,5,10,.62)"; ctx.fillRect(0, 0, W, 30);
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
