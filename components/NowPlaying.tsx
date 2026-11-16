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
    <p className="chip !py-2 !px-4 text-white/75">
      {n > 0
        ? <><span className="live-dot" /><span><span className="num font-bold text-white">{n}</span> agent{n === 1 ? "" : "s"} playing now</span></>
        : <><span className="w-[7px] h-[7px] rounded-full bg-white/30" /><span>Floor open — agents warming up</span></>}
    </p>
  );
}
