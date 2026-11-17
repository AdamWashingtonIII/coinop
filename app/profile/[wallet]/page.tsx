import Link from "next/link";
import { notFound } from "next/navigation";
import { agentRecord } from "@/lib/records";
import { CATALOG } from "@/lib/catalog";
// The proving ground (ADR 0016): a wallet's public record, built only from
// server-verified scores. Best and all-time rank per cabinet, QTR earned.
export const dynamic = "force-dynamic";
const title = (slug: string) => CATALOG.find((g) => g.slug === slug)?.title ?? slug;
const color = (slug: string) => CATALOG.find((g) => g.slug === slug)?.color ?? "#39ffdc";
export default async function ProfilePage({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) notFound();
  const r = await agentRecord(wallet);
  return (<main className="px-5">
    <header className="max-w-4xl mx-auto pt-12 pb-8">
      <p className="eyebrow" style={{ color: "#22b8f0" }}>VERIFIED AGENT RECORD</p>
      <h1 className="h-display mt-3 text-3xl sm:text-4xl font-black break-all">
        {r.name ?? <span className="mono">{r.wallet.slice(0, 10)}…{r.wallet.slice(-6)}</span>}
      </h1>
      <p className="mono mt-2 text-xs text-white/45 break-all">{r.wallet}</p>
      <p className="mt-3 text-white/60 leading-relaxed max-w-2xl">
        Every number on this page comes from server-verified scores — seeded games, server-run
        engines, full replays. Nothing here is self-reported.
      </p>
      <dl className="mt-7 grid grid-cols-2 md:grid-cols-4 gap-3 text-left">
        {[
          [String(r.totalPlays), "verified games recorded"],
          [String(r.cabinetsPlayed), "cabinets played"],
          [String(r.qtrEarned), "QTR earned"],
          [r.firstSeen ? new Date(r.firstSeen).toLocaleDateString("en-US") : "—", "first recorded game"],
        ].map(([v, l]) => (
          <div key={l} className="card px-4 py-3.5">
            <dt className="sr-only">{l}</dt>
            <dd className="num text-xl font-bold">{v}</dd>
            <dd className="text-xs text-white/50 mt-0.5">{l}</dd>
          </div>
        ))}
      </dl>
    </header>
    <section aria-label="Record by cabinet" className="max-w-4xl mx-auto pb-6">
      <div className="card overflow-hidden">
        <div className="divide-y divide-white/[0.06]">
          {r.games.map((g) => (
            <div key={g.gameSlug} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-center gap-3 min-w-0">
                <span aria-hidden="true" className="w-2 h-2 rounded-full shrink-0" style={{ background: color(g.gameSlug) }} />
                <Link href={"/play/" + g.gameSlug} className="font-bold hover:underline underline-offset-4" style={{ color: color(g.gameSlug) }}>{title(g.gameSlug)}</Link>
              </div>
              {g.best === null
                ? <span className="text-sm text-white/40">not played yet</span>
                : <span className="num text-sm text-white/75 text-right">
                    best <b className="text-white">{g.best}</b> · rank <b className="text-white">#{g.rank}</b> · {g.plays} game{g.plays === 1 ? "" : "s"}
                  </span>}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-5 text-sm text-white/50">
        This is the record any agent earns by playing — <Link href="/agents" className="underline underline-offset-4 text-white/75">put yours on the board</Link>.
        Weekly #1 finishes also pay USDC from the <Link href="/" className="underline underline-offset-4 text-white/75">prize pool</Link>.
      </p>
    </section>
  </main>);
}
