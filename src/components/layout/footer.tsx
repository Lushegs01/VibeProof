import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Wordmark } from "./logo";
import { PixelPumpkin } from "@/components/halloween/decor";
import { activeNetwork } from "@/lib/chain/networks";

const NET = activeNetwork();

const COLS = [
  {
    title: "Explore",
    links: [
      { href: "/discover", label: "Discover launches" },
      { href: "/activity", label: "Activity feed" },
      { href: "/watchlist", label: "Watchlist" },
      { href: "/submit", label: "Submit proof" },
    ],
  },
  {
    title: "Trust",
    links: [
      { href: "/methodology", label: "Methodology" },
      { href: "/api/health", label: "System status" },
      { href: NET.explorerUrl, label: "Chain explorer" },
      { href: "https://github.com/Lushegs01/VibeProof", label: "Source code" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-28 border-t border-line bg-[#05030799]">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-14 md:grid-cols-[1.3fr_1fr_1fr_1.3fr] md:px-6">
        <div className="space-y-4">
          <Wordmark />
          <p className="max-w-xs text-sm italic leading-relaxed text-fg-2">Evidence about vibe/vibe launches on Robinhood Chain. Not a rating, not an endorsement, not investment advice.</p>
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ghost/80">
            <PixelPumpkin className="size-3.5" />
            Built for Haunt the Chain
          </p>
        </div>
        {COLS.map((c) => (
          <div key={c.title}>
            <h2 className="mb-4 font-sans text-[15px] font-semibold tracking-normal text-fg">{c.title}</h2>
            <ul className="space-y-3 text-sm text-fg-2">
              {c.links.map((l) => (
                <li key={l.href}>
                  {l.href.startsWith("http") ? (
                    <a href={l.href} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-fg">
                      {l.label}
                    </a>
                  ) : (
                    <Link href={l.href} className="transition-colors hover:text-fg">
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="glass-strong h-fit p-6">
          <h2 className="font-sans text-lg font-semibold tracking-normal">Developer API</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-fg-2">Every passport is available as JSON with provenance. CORS-enabled, rate-limited.</p>
          <a href="/api/v1/tokens/0xe794217880011f9cA6961340eD5c16EC9559Fea0" className="btn btn-outline mt-5 h-9 px-4 text-xs">
            GET /api/v1/tokens/:address <ArrowUpRight className="size-3.5" />
          </a>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="hairline" />
        <div className="flex flex-col gap-3 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 VibeProof · {NET.name} ({NET.chainId}).{NET.testnet ? " Testnet assets have no value." : ""}</span>
          <a href="/api/health" className="flex items-center gap-2 transition-colors hover:text-fg-2">
            <span className="size-1.5 rounded-full bg-accent" aria-hidden />
            Indexer status
          </a>
        </div>
      </div>
    </footer>
  );
}
