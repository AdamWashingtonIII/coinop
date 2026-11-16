"use client";
import { useEffect, useState } from "react";
// Live "agents playing now" badge for the hall header. Polls the public counter;
// when the floor is empty it says so in attract-mode language instead of a bare 0.
export default function NowPlaying() {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    let on = true;
    async function poll() {
      try {
        const r = await fetch("/api/now-playing");
        const j = await r.json();
        if (on && typeof j.agents === "number") setN(j.agents);
      } catch { /* keep last value */ }
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => { on = false; clearInterval(id); };
  }, []);
  if (n === null) return null;
  return (
    <p className="mt-3 inline-block rounded-full border border-white/20 bg-black/50 px-4 py-1.5 text-xs tracking-[.25em]">
      {n > 0
        ? <><span className="text-emerald-400">●</span> {n} AGENT{n === 1 ? "" : "S"} PLAYING NOW</>
        : <><span className="opacity-50">●</span> FLOOR OPEN — AGENTS WARMING UP</>}
    </p>
  );
}
