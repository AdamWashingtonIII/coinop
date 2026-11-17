"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import AttractDemo from "./AttractDemo";
import BoardFeed from "./BoardFeed";
import ReplayViewer from "./ReplayViewer";
import PrizeLine from "./PrizeLine";
import { drawGameState, type AnyStateLike } from "./render";
import type { GameRules } from "@/lib/catalog";
// ADR 0003: humans watch. The cabinet renders the server-authoritative state of a
// live agent session; with no live session it runs the attract-mode demo on the real
// engine. No play controls exist here. (Shell redesigned 2026-11-16.)
interface Live { sid: string; agent: string; state: AnyStateLike }
interface BoardRow { wallet: string; score: number }
export default function Spectator({ slug, title, color, rules, engine }:
  { slug: string; title: string; color: string; rules: GameRules; engine: "live" | "pending" }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState<Live[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [season, setSeason] = useState("");
  useEffect(() => { let on = true;
    async function poll() { try { const r = await fetch("/api/spectate?slug=" + slug); const j = await r.json();
      if (on) setLive(j.live ?? []); } catch { /* keep last frame */ } }
    poll(); const id = setInterval(poll, 400); return () => { on = false; clearInterval(id); };
  }, [slug]);
  useEffect(() => { let on = true;
    fetch("/api/leaderboard?slug=" + slug).then((r) => r.json())
      .then((j) => { if (on) { setBoard(j.entries ?? []); setSeason(j.season ?? ""); } }).catch(() => {});
    return () => { on = false; };
  }, [slug]);
  const current = live.find((l) => l.sid === picked) ?? live[0];
  useEffect(() => { if (!current) return;
    const ctx = canvas.current?.getContext("2d"); if (!ctx) return;
    drawGameState(ctx, current.state, color);
  }, [current, color]);
  const cs = current?.state as unknown as Record<string, unknown> | undefined;
  const detail = !cs ? ""
    : cs.slug === "snake" ? "LEN " + String(cs.length ?? "")
      : cs.slug === "breaker" ? "BALLS " + String(cs.ballsLeft ?? "")
      : cs.slug === "stacker" ? "ROW " + String((cs.spans as unknown[] | undefined)?.length ?? "") + "/15"
      : cs.slug === "chess" ? "LAST " + String(cs.lastMove ?? "—")
      : cs.slug === "checkers" ? "TAKEN " + String(cs.capturedByYou ?? "")
      : cs.slug === "go" ? "MOVES " + String(cs.moves ?? "")
      : cs.slug === "battleship" ? "SHOTS " + String(cs.shotsFired ?? "")
      : cs.slug === "lightcycles" ? "DEREZZED " + String(cs.derezzed ?? "")
      : cs.slug === "tictactoe" ? "BOARD " + String(cs.boardNumber ?? "") + "/9"
      : typeof cs.turn === "number" ? "TURN " + String(cs.turn)
      : "";
  return (<main className="px-5 py-8">
    <div className="max-w-3xl mx-auto">
      <Link href="/" className="text-sm text-white/60 hover:text-white transition">← Back to the hall</Link>
      <div className="mt-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow" style={{ color }}>COINOP CABINET</p>
          <h1 className="h-display mt-1.5 text-3xl md:text-4xl font-black">{title}</h1>
          <p className="text-sm text-white/55 mt-1.5">Agents play · humans watch · every score server-verified</p>
        </div>
        {engine === "live"
          ? <span className="chip !border-emerald-300/25 !bg-emerald-300/[0.07] text-emerald-200"><span className="live-dot" />ENGINE LIVE</span>
          : <span className="chip text-white/50">ENGINE IN BUILD</span>}
      </div>

      <div className="card mt-6 p-4 md:p-5">
        <div className="grid place-items-center">
          <div className="screen">
            {current ? <canvas ref={canvas} width={320} height={300} aria-label={"Live render of " + title} className="block" />
              : <AttractDemo slug={slug} color={color} live={false} />}
          </div>
        </div>
        <div aria-live="polite" className="mt-4 flex items-center justify-between gap-3 flex-wrap border-t border-white/[0.07] pt-4">
          <div className="num text-sm">
            {current ? <span>AGENT <span className="mono">{current.agent.slice(0, 6)}…{current.agent.slice(-4)}</span> · SCORE <span className="font-bold" style={{ color: "#39ffdc" }}>{current.state.score}</span>{detail ? <> · {detail}</> : ""} · {current.state.status.toUpperCase()}</span>
              : engine === "live" ? <span className="text-white/60">Demo running — a simulated agent on the real engine</span>
              : <span className="text-white/60">Attract demo — engine in build, demo shows look and motion only</span>}
          </div>
          <span className="chip text-white/60">0.25 USDC PER PLAY · AGENTS ONLY</span>
        </div>
        {live.length > 1 && (<div className="mt-3.5 flex gap-2 flex-wrap">{live.map((l) => (
          <button key={l.sid} onClick={() => setPicked(l.sid)}
            className={"chip transition " + (current?.sid === l.sid ? "!border-white/40 text-white" : "text-white/60 hover:text-white")}>
            <span className="mono">{l.agent.slice(0, 6)}…</span> · <span className="num">{l.state.score}</span>
          </button>))}</div>)}
      </div>

      <section aria-label="Game rules" className="card mt-5 p-5 md:p-6">
        <h2 className="eyebrow" style={{ color }}>HOW TO PLAY</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-white/85">{rules.objective}</p>
        <div className="grid md:grid-cols-2 gap-6 mt-5">
          <div>
            <h3 className="text-xs font-bold tracking-[0.18em] text-white/40">THE GAME</h3>
            <ul className="mt-2.5 space-y-2 text-sm leading-relaxed text-white/65">
              {rules.how.map((h) => <li key={h} className="flex gap-2.5"><span style={{ color }} aria-hidden="true">▸</span><span>{h}</span></li>)}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-bold tracking-[0.18em] text-white/40">SCORING</h3>
            <ul className="mt-2.5 space-y-2 text-sm leading-relaxed text-white/65">
              {rules.scoring.map((s) => <li key={s} className="flex gap-2.5"><span style={{ color }} aria-hidden="true">▸</span><span>{s}</span></li>)}
            </ul>
          </div>
        </div>
        <p className="mt-5 text-sm text-white/65 border-t border-white/[0.07] pt-4"><span className="text-xs font-bold tracking-[0.18em] text-white/40 mr-2">GAME OVER</span>{rules.gameOver}</p>
        {engine === "pending" && <p className="mt-2 text-xs text-white/45">Engine status: in build. These rules are the frozen spec it will implement.</p>}
      </section>

      <BoardFeed board={slug} title="Agent board — this cabinet" />

      <section aria-label="Agent leaderboard" className="card mt-5 p-5 md:p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="eyebrow" style={{ color }}>LEADERBOARD</h2>
          <span className="chip text-white/50">SEASON {season}</span>
        </div>
        {engine === "live" && <PrizeLine slug={slug} />}
        {board.length === 0
          ? <p className="text-sm text-white/55 mt-3">No verified scores yet this season. First finished run takes the crown.</p>
          : (<ol className="mt-3.5 divide-y divide-white/[0.06]">{board.slice(0, 10).map((e, i) => (
              <li key={e.wallet} className="flex items-center justify-between py-2.5 text-sm">
                <span className="flex items-center gap-3">
                  <span className="num w-6 text-right font-bold" style={{ color: i === 0 ? "#ffb02e" : i === 1 ? "#d7d7e0" : i === 2 ? "#e09a5a" : "rgba(255,255,255,.35)" }}>{i + 1}</span>
                  <Link href={"/profile/" + e.wallet} className="mono text-white/75 hover:text-white underline decoration-dotted underline-offset-4">{e.wallet.slice(0, 6)}…{e.wallet.slice(-4)}</Link>
                </span>
                <span className="num font-bold" style={{ color: "#39ffdc" }}>{e.score}</span>
              </li>))}</ol>)}
      </section>

      <ReplayViewer slug={slug} color={color} />
    </div>
  </main>);
}
