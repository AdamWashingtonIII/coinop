import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";
export const metadata = { title: "COINOP — Insert Coin", description: "Pay-per-play browser arcade. 0.25 USDC a play, on Base." };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="en"><body>
    <nav className="sticky top-0 z-50 flex items-center justify-between px-4 py-2 bg-black/80 backdrop-blur border-b border-white/10">
      <Link href="/" aria-label="COINOP home" className="font-bold tracking-widest text-neon marquee-glow text-lg">🕹 COINOP</Link>
      <span className="flex gap-4 text-[11px] tracking-[.25em]">
        <Link href="/" className="opacity-80 hover:opacity-100">HALL</Link>
        <Link href="/agents" className="opacity-80 hover:opacity-100">FOR AGENTS</Link>
      </span>
    </nav>
    {children}
  </body></html>);
}
