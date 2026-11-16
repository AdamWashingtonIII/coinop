"use client";
import { useEffect, useRef, useState } from "react";
import { drawGameState, type AnyStateLike } from "./render";
// Replay viewer: steps through the server's own snapshots of a finished run —
// exactly what the engine recorded, nothing re-simulated or invented.
interface Summary { sid: string; wallet: string; finalScore: number; endedAt: number }
interface Detail { sid: string; wallet: string; finalScore: number; snapshots: AnyStateLike[] }
export default function ReplayViewer({ slug, color }: { slug: string; color: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [list, setList] = useState<Summary[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { let on = true;
    fetch("/api/replays?slug=" + slug).then((r) => r.json()).then((j) => { if (on) setList(j.replays ?? []); }).catch(() => {});
    return () => { on = false; };
  }, [slug]);
  useEffect(() => { if (!playing || !detail) return;
    const id = setInterval(() => setIdx((i) => {
      if (i >= detail.snapshots.length - 1) { setPlaying(false); return i; }
      return i + 1;
    }), 350);
    return () => clearInterval(id);
  }, [playing, detail]);
  useEffect(() => { const ctx = canvas.current?.getContext("2d"); if (!ctx || !detail) return;
    const s = detail.snapshots[Math.min(idx, detail.snapshots.length - 1)];
    if (s) drawGameState(ctx, s, color);
  }, [detail, idx, color]);
  async function open(sid: string) {
    try { const r = await fetch("/api/replay/" + sid); const j = await r.json();
      if (j.snapshots) { setDetail(j as Detail); setIdx(0); setPlaying(true); } } catch { /* leave list */ }
  }
  return (<section aria-label="Recent replays" className="mt-6">
    <h2 className="font-bold tracking-widest text-sm" style={{ color }}>RECENT RUNS — REPLAYS</h2>
    {list.length === 0 && <p className="text-sm opacity-70 mt-1">No finished runs recorded yet. The first agent to complete a run appears here.</p>}
    {list.length > 0 && (<div className="mt-2 flex gap-2 flex-wrap">{list.map((r) => (
      <button key={r.sid} onClick={() => open(r.sid)}
        className="px-3 py-1 border border-white/25 rounded text-sm focus:outline-none focus:ring-2 focus:ring-neon">
        {r.wallet.slice(0, 6)}… · {r.finalScore} pts</button>))}</div>)}
    {detail && (<div className="mt-3">
      <canvas ref={canvas} width={320} height={300} aria-label="Replay playback" className="block bg-black rounded" />
      <div className="mt-2 flex items-center gap-3 flex-wrap text-sm">
        <button onClick={() => setPlaying((p) => !p)} className="px-3 py-1 border border-white/25 rounded">{playing ? "Pause" : "Play"}</button>
        <button onClick={() => { setPlaying(false); setIdx((i) => Math.max(0, i - 1)); }} className="px-3 py-1 border border-white/25 rounded">‹ Step</button>
        <button onClick={() => { setPlaying(false); setIdx((i) => Math.min(detail.snapshots.length - 1, i + 1)); }} className="px-3 py-1 border border-white/25 rounded">Step ›</button>
        <input type="range" min={0} max={detail.snapshots.length - 1} value={idx} aria-label="Replay position"
          onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} className="flex-1 min-w-32" />
        <span className="led" style={{ color: "#39ffdc" }}>FRAME {idx + 1}/{detail.snapshots.length} · FINAL {detail.finalScore}</span>
      </div>
    </div>)}
  </section>);
}
