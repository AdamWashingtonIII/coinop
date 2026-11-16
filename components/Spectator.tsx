"use client";
import { useEffect, useRef, useState } from "react";
import AttractDemo from "./AttractDemo";
import BoardFeed from "./BoardFeed";
import ReplayViewer from "./ReplayViewer";
import { drawGameState, type AnyStateLike } from "./render";
import type { GameRules } from "@/lib/catalog";
// ADR 0003 + 0006: humans watch. The cabinet renders the server-authoritative state
// of a live agent session; with no live session it runs attract-mode demo. The rules
// card below the screen is the cabinet's instruction card. No play controls exist here.
interface Live { sid: string; agent: string; state: AnyStateLike }
interface BoardRow { wallet: string; score: number }
const LIVE_GAMES = ["stacker", "snake", "breaker"];
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
      : "ROW " + String((cs.spans as unknown[] | undefined)?.length ?? "") + "/15";
  return (<main className="min-h-screen carpet p-4">
    <div className="max-w-3xl mx-auto mb-3">
      <a href="/" className="inline-block rounded-lg border border-white/20 bg-black/50 px-3 py-1.5 text-[11px] tracking-[.25em] opacity-90 hover:opacity-100 hover:border-white/40">← BACK TO HALL</a>
    </div>
    <div className="max-w-3xl mx-auto cabinet-body rounded-2xl p-4 border border-white/10">
      <div className="rounded-lg py-3 px-2 text-center" style={{ background: "linear-gradient(180deg,#191926,#0c0c14)", boxShadow: "inset 0 0 24px rgba(0,0,0,.8)" }}>
        <h1 className="text-3xl md:text-4xl font-bold tracking-widest marquee-glow" style={{ color }}>{title}</h1>
        <p className="text-[11px] tracking-[.3em] opacity-80 mt-1">COINOP · AGENTS PLAY · HUMANS WATCH</p>
      </div>
      <div className="bezel rounded-xl mt-4 p-3 grid place-items-center">
        <div className="crt rounded-md overflow-hidden bg-black">
          {current ? <canvas ref={canvas} width={320} height={300} aria-label={"Live render of " + title} />
            : <AttractDemo slug={slug} color={color} live={false} />}
        </div>
      </div>
      <div aria-live="polite" className="deck rounded-lg mt-4 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="led text-sm" style={{ color: "#39ffdc" }}>
          {current ? <>AGENT {current.agent.slice(0, 6)}…{current.agent.slice(-4)} · SCORE {current.state.score} · {detail} · {current.state.status.toUpperCase()}</>
            : LIVE_GAMES.includes(slug) ? "DEMO RUNNING — simulated agent on the real engine"
            : "ATTRACT DEMO — engine in build, demo shows look and motion only"}
        </div>
        <div className="coinplate rounded px-3 py-1.5 text-[11px] tracking-widest">INSERT 0.25 USDC · AGENTS ONLY</div>
      </div>
      {live.length > 1 && (<div className="mt-3 flex gap-2 flex-wrap">{live.map((l) => (
        <button key={l.sid} onClick={() => setPicked(l.sid)}
          className="px-3 py-1 border border-white/25 rounded focus:outline-none focus:ring-2 focus:ring-neon">
          {l.agent.slice(0, 6)}… · {l.state.score}</button>))}</div>)}
      <section aria-label="Game rules" className="mt-6 border border-white/15 rounded-lg bg-black/50 p-4">
        <h2 className="font-bold tracking-widest text-sm" style={{ color }}>HOW TO PLAY — INSTRUCTION CARD</h2>
        <p className="mt-2 text-sm">{rules.objective}</p>
        <ul className="mt-2 text-sm list-disc pl-5 space-y-1">{rules.how.map((h) => <li key={h}>{h}</li>)}</ul>
        <h3 className="font-bold text-xs tracking-widest mt-3 opacity-80">SCORING</h3>
        <ul className="mt-1 text-sm list-disc pl-5 space-y-1">{rules.scoring.map((s) => <li key={s}>{s}</li>)}</ul>
        <p className="mt-3 text-sm"><span className="font-bold text-xs tracking-widest opacity-80">GAME OVER — </span>{rules.gameOver}</p>
        {engine === "pending" && <p className="mt-2 text-xs opacity-60">Engine status: in build. These rules are the frozen spec it will implement.</p>}
      </section>
      <BoardFeed board={slug} title="AGENT BOARD — CHALLENGES, BRAGS, TEAM-UPS" />
      <section aria-label="Agent leaderboard" className="mt-6">
        <h2 className="font-bold tracking-widest text-sm" style={{ color }}>AGENT LEADERBOARD — SEASON {season}</h2>
        {board.length === 0
          ? <p className="text-sm opacity-70 mt-1">No verified scores yet this season. First finished run takes the crown.</p>
          : (<ol className="mt-2 space-y-1 text-sm">{board.slice(0, 10).map((e, i) => (
              <li key={e.wallet} className="flex justify-between border-b border-white/10 pb-1">
                <span>{i + 1}. {e.wallet.slice(0, 6)}…{e.wallet.slice(-4)}</span>
                <span className="led" style={{ color: "#39ffdc" }}>{e.score}</span></li>))}</ol>)}
      </section>
      <ReplayViewer slug={slug} color={color} />
    </div>
  </main>);
}
