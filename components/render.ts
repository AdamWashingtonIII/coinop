// Shared canvas renderer for live spectating and replays: draws any cabinet's
// server state (stacker / snake / breaker) into a 320x300 screen.
export interface AnyStateLike { slug: string; status: string; score: number }
const ROW_COLORS = ["#2e9bff", "#7dff2e", "#39ffdc", "#ffb02e", "#ff2ea6"]; // breaker rows, top (50) to bottom (10)
export function drawGameState(ctx: CanvasRenderingContext2D, state: AnyStateLike, color: string, W = 320, H = 300): void {
  const s = state as unknown as Record<string, unknown> & AnyStateLike;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  if (s.slug === "stacker") {
    const spans = s.spans as { start: number; end: number }[];
    const moving = s.moving as { start: number; end: number };
    const cw = 32, ch = 20;
    ctx.fillStyle = color;
    spans.forEach((span, row) => { const y = (15 - 1 - row) * ch; ctx.fillRect(span.start * cw + 1, y + 1, (span.end - span.start) * cw - 2, ch - 2); });
    if (s.status === "playing" && moving) { ctx.fillStyle = "#39ffdc"; const y = (15 - 1 - spans.length) * ch;
      ctx.fillRect(moving.start * cw + 1, y + 1, (moving.end - moving.start) * cw - 2, ch - 2); }
    return;
  }
  if (s.slug === "snake") {
    const cell = 15, ox = (W - 20 * cell) / 2;
    const segments = s.segments as { x: number; y: number }[];
    const orb = s.orb as { x: number; y: number } | null;
    const bonus = s.bonus as { x: number; y: number } | null;
    ctx.strokeStyle = "rgba(255,255,255,.08)"; ctx.strokeRect(ox + 0.5, 0.5, 20 * cell - 1, 20 * cell - 1);
    if (orb) { ctx.fillStyle = "#ffb02e"; ctx.fillRect(ox + orb.x * cell + 3, orb.y * cell + 3, cell - 6, cell - 6); }
    if (bonus) { ctx.fillStyle = "#ffe600"; ctx.fillRect(ox + bonus.x * cell + 2, bonus.y * cell + 2, cell - 4, cell - 4); }
    segments.forEach((seg, i) => { ctx.fillStyle = i === 0 ? "#ffffff" : color;
      ctx.fillRect(ox + seg.x * cell + 1, seg.y * cell + 1, cell - 2, cell - 2); });
    return;
  }
  if (s.slug === "breaker") {
    const sx = W / 20, sy = H / 24;
    const bricks = s.bricks as number[];
    bricks.forEach((mask, r) => { ctx.fillStyle = ROW_COLORS[r] ?? color;
      for (let c = 0; c < 10; c++) if ((mask >> c) & 1) ctx.fillRect(c * 2 * sx + 1, (2 + r) * sy + 1, 2 * sx - 2, sy - 2); });
    const paddle = s.paddle as { start: number; width: number };
    ctx.fillStyle = color; ctx.fillRect(paddle.start * sx, 22 * sy, paddle.width * sx, sy - 2);
    const ball = s.ball as { x: number; y: number };
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ball.x * sx, ball.y * sy, 4, 0, 7); ctx.fill();
    return;
  }
  ctx.fillStyle = "#fff"; ctx.font = "bold 12px monospace";
  ctx.fillText("NO RENDERER FOR " + s.slug.toUpperCase(), 8, 16);
}
