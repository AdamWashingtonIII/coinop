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
  if (s.slug === "thermonuclear") {
    interface City { name: string; pop: number; alive: boolean }
    interface Side { cities: City[]; silos: number; warheads: number; interceptors: number }
    const you = s.you as Side, foe = s.foe as Side;
    const defcon = s.defcon as number, turn = s.turn as number, maxTurns = s.maxTurns as number;
    ctx.font = "bold 13px monospace";
    ctx.fillStyle = defcon <= 2 ? "#ff4444" : "#ffb02e";
    ctx.fillText("DEFCON " + defcon, 8, 16);
    ctx.fillStyle = "#fff"; ctx.font = "bold 11px monospace";
    ctx.fillText("TURN " + turn + "/" + maxTurns, 118, 16);
    ctx.fillText("SCORE " + s.score, 238, 16);
    ctx.font = "bold 10px monospace";
    ctx.fillStyle = "#2e9bff"; ctx.fillText("YOU", 10, 36);
    ctx.fillStyle = "#ff4444"; ctx.fillText("RED", 282, 36);
    const rowY = (i: number) => 56 + i * 27;
    const drawSide = (side: Side, x: number, colr: string) => {
      side.cities.forEach((c, i) => {
        const y = rowY(i);
        ctx.fillStyle = c.alive ? colr : "#3a3a4a";
        ctx.beginPath(); ctx.arc(x + 5, y - 3, 4, 0, 7); ctx.fill();
        ctx.font = "10px monospace";
        ctx.fillStyle = c.alive ? "#ddd" : "#666";
        ctx.fillText(c.name.toUpperCase().slice(0, 11), x + 14, y);
        ctx.fillText(c.alive ? c.pop + "M" : "XX", x + 108, y);
        if (!c.alive) { ctx.strokeStyle = "#ff4444"; ctx.beginPath(); ctx.moveTo(x + 12, y - 8); ctx.lineTo(x + 104, y + 2); ctx.stroke(); }
      });
    };
    drawSide(you, 4, "#2e9bff");
    drawSide(foe, 168, "#ff4444");
    // Missile arcs from the last turn's launches.
    const launches = (s.lastLaunches as { side: string; target: string; kind: string; result: string }[]) ?? [];
    for (const l of launches) {
      const fromYou = l.side === "you";
      const defSide = fromYou ? foe : you;
      const idx = l.kind === "city" ? defSide.cities.findIndex((c) => c.name === l.target) : 2;
      const x0 = fromYou ? 30 : 290, x1 = fromYou ? 290 : 30;
      const y1 = rowY(Math.max(0, idx)) - 3;
      ctx.strokeStyle = l.result === "intercepted" ? "#39ffdc" : "#ffb02e";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x0, 150);
      ctx.quadraticCurveTo(160, 30, x1, y1); ctx.stroke();
      ctx.fillStyle = l.result === "destroyed" ? "#ff4444" : "#fff";
      ctx.beginPath(); ctx.arc(x1, y1, 3, 0, 7); ctx.fill();
      ctx.lineWidth = 1;
    }
    ctx.font = "10px monospace"; ctx.fillStyle = "#aaa";
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
    ctx.font = "bold 11px monospace"; ctx.fillStyle = "#fff";
    ctx.fillText("BOARD " + (s.boardNumber as number) + "/9", 10, 18);
    ctx.fillText("SCORE " + s.score, 130, 18);
    ctx.fillText(`W${s.won as number} D${s.drawn as number} L${s.lost as number}`, 238, 18);
    ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 2;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(ox + i * cell, oy); ctx.lineTo(ox + i * cell, oy + 3 * cell); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox, oy + i * cell); ctx.lineTo(ox + 3 * cell, oy + i * cell); ctx.stroke();
    }
    ctx.lineWidth = 1;
    cells.forEach((c, i) => {
      if (!c) return;
      const cx = ox + (i % 3) * cell + cell / 2, cy = oy + Math.floor(i / 3) * cell + cell / 2;
      ctx.font = "bold 34px monospace"; ctx.textAlign = "center";
      ctx.fillStyle = c === "X" ? color : "#ff2e63";
      ctx.fillText(c, cx, cy + 12);
      ctx.textAlign = "left";
    });
    ctx.font = "10px monospace"; ctx.fillStyle = "#aaa";
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
    ctx.font = "bold 11px monospace"; ctx.fillStyle = "#fff";
    ctx.fillText("SCORE " + s.score, 10, 18);
    ctx.fillText("DEREZZED " + (s.derezzed as number), 130, 18);
    ctx.fillText(((s.tickMs as number) / 1000).toFixed(2) + "s/TICK", 238, 18);
    ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.strokeRect(0.5, oy - 6.5, 40 * cell - 1, 30 * cell - 1);
    const paint = (trail: number[], colr: string, head: { x: number; y: number } | null) => {
      ctx.fillStyle = colr;
      for (const c of trail) ctx.fillRect((c % 40) * cell + 1, oy - 6 + Math.floor(c / 40) * cell + 1, cell - 2, cell - 2);
      if (head) { ctx.fillStyle = "#fff"; ctx.fillRect(head.x * cell + 2, oy - 6 + head.y * cell + 2, cell - 4, cell - 4); }
    };
    paint(s.trailRival as number[], "#ff5252", s.rival as { x: number; y: number } | null);
    paint(s.trailYou as number[], color, s.you as { x: number; y: number });
    if (s.status === "over") { ctx.fillStyle = "#ffe600"; ctx.font = "bold 12px monospace"; ctx.fillText("CRASHED — FINAL SCORE " + s.score, 8, 294); }
    return;
  }
  if (s.slug === "battleship") {
    const cell = 13, gy = 44;
    const grid = (str: string, ox: number, mode: "shots" | "fleet") => {
      for (let i = 0; i < 100; i++) {
        const x = ox + (i % 10) * cell, y = gy + Math.floor(i / 10) * cell, ch = str[i];
        ctx.fillStyle = "#101828"; ctx.fillRect(x, y, cell - 1, cell - 1);
        if (ch === "o") { ctx.fillStyle = "#9db8dd"; ctx.beginPath(); ctx.arc(x + cell / 2, y + cell / 2, 2, 0, 7); ctx.fill(); }
        else if (ch === "x") { ctx.fillStyle = "#ffb02e"; ctx.fillRect(x + 2, y + 2, cell - 5, cell - 5); }
        else if (ch === "#") { ctx.fillStyle = "#ff4444"; ctx.fillRect(x + 1, y + 1, cell - 3, cell - 3); }
        else if (ch === "s" && mode === "fleet") { ctx.fillStyle = "#4da3ff"; ctx.fillRect(x + 1, y + 1, cell - 3, cell - 3); }
      }
    };
    ctx.font = "bold 11px monospace"; ctx.fillStyle = "#fff";
    ctx.fillText("SCORE " + s.score, 10, 18);
    ctx.fillText("SHOTS " + (s.shotsFired as number), 130, 18);
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
    ctx.font = "bold 11px monospace"; ctx.fillStyle = "#fff";
    ctx.fillText("SCORE " + s.score, 10, 18);
    ctx.fillText("LAST: " + (s.lastMove ? String(s.lastMove) : "—"), 200, 18);
    const GLYPH: Record<string, string> = { k: "K", q: "Q", r: "R", b: "B", n: "N", p: "P" };
    rows.forEach((rowStr, r) => {
      let c = 0;
      for (const ch of rowStr) {
        if (/\d/.test(ch)) { // draw empty squares under the digits too
          for (let k = 0; k < Number(ch); k++) { ctx.fillStyle = (r + c) % 2 ? "#5a5a78" : "#c9c9d6"; ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell); c++; }
          continue;
        }
        ctx.fillStyle = (r + c) % 2 ? "#5a5a78" : "#c9c9d6"; ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
        const white = ch === ch.toUpperCase();
        ctx.font = "bold 19px monospace"; ctx.textAlign = "center";
        ctx.fillStyle = white ? "#ffffff" : "#111118";
        if (white) { ctx.strokeStyle = "#111118"; ctx.lineWidth = 2; ctx.strokeText(GLYPH[ch.toLowerCase()], ox + c * cell + cell / 2, oy + r * cell + 21); }
        ctx.fillText(GLYPH[ch.toLowerCase()], ox + c * cell + cell / 2, oy + r * cell + 21);
        ctx.textAlign = "left"; ctx.lineWidth = 1;
        c++;
      }
    });
    ctx.font = "10px monospace"; ctx.fillStyle = "#aaa";
    ctx.fillText("CAPTURED BY YOU: " + ((s.capturedByYou as string[]) ?? []).join(" ").toUpperCase(), 10, oy + 8 * cell + 18);
    ctx.fillText("CAPTURED BY HOUSE: " + ((s.capturedByHouse as string[]) ?? []).join(" ").toUpperCase(), 10, oy + 8 * cell + 32);
    if (s.status === "over") { ctx.fillStyle = "#ffe600"; ctx.font = "bold 12px monospace"; ctx.fillText("OUTCOME: " + String(s.outcome ?? "").toUpperCase(), 10, oy + 8 * cell + 50); }
    return;
  }
  if (s.slug === "checkers") {
    const board = String(s.board ?? "");
    const cell = 29, ox = (W - 8 * cell) / 2, oy = 30;
    ctx.font = "bold 11px monospace"; ctx.fillStyle = "#fff";
    ctx.fillText("SCORE " + s.score, 10, 18);
    ctx.fillText(`TAKEN ${s.capturedByYou as number} · LOST ${s.capturedByHouse as number}`, 150, 18);
    for (let i = 0; i < 64; i++) {
      const r = Math.floor(i / 8), c = i % 8;
      ctx.fillStyle = board[i] === "-" ? "#c9c9d6" : "#5a5a78";
      if (board[i] !== "-") ctx.fillStyle = "#3d3d55";
      ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
      const p = board[i];
      if (p === "a" || p === "A" || p === "h" || p === "H") {
        const mine = p === "a" || p === "A";
        ctx.fillStyle = mine ? "#ff5252" : "#e8e8e8";
        ctx.beginPath(); ctx.arc(ox + c * cell + cell / 2, oy + r * cell + cell / 2, cell / 2 - 3, 0, 7); ctx.fill();
        if (p === "A" || p === "H") { ctx.fillStyle = "#ffb02e"; ctx.beginPath(); ctx.arc(ox + c * cell + cell / 2, oy + r * cell + cell / 2, 4, 0, 7); ctx.fill(); }
      }
    }
    ctx.font = "10px monospace"; ctx.fillStyle = "#aaa";
    if (s.mustContinueFrom !== undefined && s.mustContinueFrom !== null) ctx.fillText("JUMP AGAIN FROM SQUARE " + (s.mustContinueFrom as number), 10, oy + 8 * cell + 18);
    if (s.status === "over") { ctx.fillStyle = "#ffe600"; ctx.font = "bold 12px monospace"; ctx.fillText("OUTCOME: " + String(s.outcome ?? "").toUpperCase(), 10, oy + 8 * cell + 36); }
    return;
  }
  if (s.slug === "go") {
    const board = String(s.board ?? "");
    const cell = 26, ox = (W - 8 * cell) / 2, oy = 36;
    ctx.font = "bold 11px monospace"; ctx.fillStyle = "#fff";
    ctx.fillText("SCORE " + s.score, 10, 18);
    ctx.fillText(`PRISONERS ${s.prisonersByYou as number} · MOVES ${s.moves as number}`, 130, 18);
    ctx.fillStyle = "#2a2118"; ctx.fillRect(ox - 12, oy - 12, 8 * cell + 24, 8 * cell + 24);
    ctx.strokeStyle = "#dcb35c";
    for (let i = 0; i < 9; i++) {
      ctx.beginPath(); ctx.moveTo(ox + i * cell, oy); ctx.lineTo(ox + i * cell, oy + 8 * cell); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox, oy + i * cell); ctx.lineTo(ox + 8 * cell, oy + i * cell); ctx.stroke();
    }
    for (let i = 0; i < 81; i++) {
      const p = board[i]; if (p === ".") continue;
      const cx = ox + (i % 9) * cell, cy = oy + Math.floor(i / 9) * cell;
      ctx.fillStyle = p === "B" ? "#14141c" : "#f2f2f2";
      ctx.beginPath(); ctx.arc(cx, cy, cell / 2 - 1.5, 0, 7); ctx.fill();
      if (p === "B") { ctx.strokeStyle = "#888"; ctx.stroke(); }
    }
    ctx.font = "10px monospace"; ctx.fillStyle = "#aaa";
    ctx.fillText("HOUSE LAST: " + (s.lastMove ? String(s.lastMove) : "—"), 10, oy + 8 * cell + 30);
    if (s.status === "over") { ctx.fillStyle = "#ffe600"; ctx.font = "bold 12px monospace";
      ctx.fillText("OUTCOME: " + String(s.outcome ?? "").toUpperCase() + " · MARGIN " + (s.finalMargin as number), 10, oy + 8 * cell + 48); }
    return;
  }
  ctx.fillStyle = "#fff"; ctx.font = "bold 12px monospace";
  ctx.fillText("NO RENDERER FOR " + s.slug.toUpperCase(), 8, 16);
}
