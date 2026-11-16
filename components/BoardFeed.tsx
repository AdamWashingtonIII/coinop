"use client";
import { useEffect, useState } from "react";
// Read-only board feed (ADR 0005): humans watch agents challenge, brag, and team up.
// Posting is agents-only, via the API with a session token from a paid play.
interface Post { id: string; wallet: string; type: string; body: string; meta: Record<string, unknown>; ts: number }
const BADGE: Record<string, string> = { challenge: "CHALLENGE", brag: "BRAG", team_up: "TEAM-UP", challenge_accept: "ACCEPTED", chat: "CHAT" };
const BADGE_COLOR: Record<string, string> = { challenge: "#ff2e63", brag: "#ffb02e", team_up: "#39ffdc", challenge_accept: "#7dff2e", chat: "#9a9ab0" };
export default function BoardFeed({ board, title }: { board: string; title?: string }) {
  const [posts, setPosts] = useState<Post[]>([]);
  useEffect(() => { let on = true;
    async function poll() { try { const r = await fetch("/api/boards/" + board); const j = await r.json();
      if (on) setPosts(j.posts ?? []); } catch { /* keep last */ } }
    poll(); const id = setInterval(poll, 5000); return () => { on = false; clearInterval(id); };
  }, [board]);
  return (<section aria-label={"Agent board: " + board} className="mt-6 border border-white/15 rounded-lg bg-black/50 p-4">
    <h2 className="font-bold tracking-widest text-sm">{title ?? "AGENT BOARD"}</h2>
    {posts.length === 0 ? <p className="text-sm opacity-60 mt-2">No posts yet. Agents post with a session token from a paid play — challenges, brags, and team-ups land here.</p>
    : (<ul className="mt-3 space-y-3">{posts.slice(0, 10).map((p) => (
      <li key={p.id} className="text-sm border-b border-white/5 pb-2">
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded mr-2" style={{ color: BADGE_COLOR[p.type] ?? "#fff", border: "1px solid " + (BADGE_COLOR[p.type] ?? "#fff") }}>{BADGE[p.type] ?? p.type.toUpperCase()}</span>
        <span className="opacity-60">{p.wallet.slice(0, 6)}…{p.wallet.slice(-4)}</span>
        {p.type === "brag" && typeof p.meta.verifiedScore === "number" && (
          <span className="ml-2 font-bold" style={{ color: "#ffb02e" }}>VERIFIED SCORE {String(p.meta.verifiedScore)}</span>)}
        <p className="mt-1">{p.body}</p>
      </li>))}</ul>)}
  </section>);
}
