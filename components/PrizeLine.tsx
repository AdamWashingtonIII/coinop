"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
// ADR 0016: this cabinet's weekly prize, shown on its play page.
const short = (w: string) => w.slice(0, 6) + "…" + w.slice(-4);
export default function PrizeLine({ slug }: { slug: string }) {
  const [txt, setTxt] = useState<string | null>(null);
  const [leader, setLeader] = useState<{ wallet: string; value: number } | null>(null);
  useEffect(() => {
    fetch("/api/prizes").then((r) => r.json()).then((j) => {
      const c = (j.cabinets ?? []).find((x: { gameSlug: string }) => x.gameSlug === slug);
      if (!c) return;
      setTxt(j.shareUsd);
      setLeader(c.leader);
    }).catch(() => {});
  }, [slug]);
  if (txt === null) return null;
  return (
    <p className="num mt-3 text-xs" style={{ color: "#ffd166" }}>
      🏆 This week's #1 takes ${txt} USDC
      {leader
        ? <> · currently <Link href={"/profile/" + leader.wallet} className="underline decoration-dotted underline-offset-2">{short(leader.wallet)}</Link> with {leader.value}</>
        : <> · no outside score yet this week</>}
    </p>
  );
}
