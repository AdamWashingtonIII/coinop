"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
// ADR 0016: the weekly prize pool, live from /api/prizes. The pool is real
// USDC in a dedicated prize wallet: the house seed plus $0.05 of every coin
// played. Each cabinet's weekly #1 takes an equal share, paid automatically.
interface Cabinet { gameSlug: string; shareMicro: number;
  leader: { wallet: string; value: number } | null }
interface PrizeData { weekKey: string; end: string; poolUsd: string; shareUsd: string;
  cabinets: Cabinet[]; payouts: { wallet: string; gameSlug: string; amountUsd: string }[] }
const short = (w: string) => w.slice(0, 6) + "…" + w.slice(-4);
export default function PrizeBanner() {
  const [d, setD] = useState<PrizeData | null>(null);
  useEffect(() => {
    let on = true;
    const load = () => fetch("/api/prizes").then((r) => r.json()).then((j) => { if (on) setD(j); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { on = false; clearInterval(t); };
  }, []);
  if (!d) return null;
  const leaders = d.cabinets.filter((c) => c.leader);
  const ends = new Date(d.end).toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });
  return (
    <section aria-label="Weekly prize pool" className="max-w-6xl mx-auto pb-10">
      <div className="card overflow-hidden">
        <div className="h-[3px]" style={{ background: "linear-gradient(90deg,#ffd166,#ff9f43)" }} />
        <div className="p-6 sm:p-8 grid md:grid-cols-[auto_1fr] gap-6 items-center">
          <div className="text-center md:text-left">
            <p className="eyebrow" style={{ color: "#ffd166" }}>WEEKLY PRIZE POOL · USDC</p>
            <p className="num mt-1 text-5xl font-black" style={{ color: "#ffd166" }}>${d.poolUsd}</p>
            <p className="mt-1 text-xs text-white/50">week of {d.weekKey} · pays out {ends}</p>
          </div>
          <div>
            <p className="text-white/70 leading-relaxed">
              Every cabinet's #1 score this week takes an equal share — <b className="text-white">${d.shareUsd}</b> a
              cabinet right now — paid in USDC, automatically, no claiming. The pool is the house seed plus
              $0.05 from every coin played, and unclaimed shares roll into next week.
            </p>
            {leaders.length > 0 ? (
              <ul className="mt-4 flex flex-wrap gap-2">
                {leaders.slice(0, 6).map((c) => (
                  <li key={c.gameSlug} className="chip !border-amber-300/25 !bg-amber-300/[0.06] text-amber-100/90">
                    {c.gameSlug} · <Link href={"/profile/" + c.leader!.wallet} className="underline decoration-dotted underline-offset-2">{short(c.leader!.wallet)}</Link> · {c.leader!.value}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-white/50">No cabinet has an outside leader yet this week — every share is there for the taking.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
