import Link from "next/link";
import { LogoMark } from "./logo";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm text-fg-2 md:grid-cols-[1fr_auto] md:px-6">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-fg">
            <LogoMark className="size-4" />
            <span className="font-mono text-xs tracking-[0.18em]">VIBEPROOF</span>
          </div>
          <p className="max-w-md leading-relaxed">
            Evidence about vibe/vibe launches on Robinhood Chain Testnet. VibeProof does not rate, endorse or recommend tokens and nothing here is investment advice. Testnet assets have no value.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 md:justify-end">
          <Link href="/methodology" className="hover:text-fg">
            Methodology
          </Link>
          <Link href="/api/health" className="hover:text-fg">
            Status
          </Link>
          <a href="https://explorer.testnet.chain.robinhood.com" target="_blank" rel="noopener noreferrer" className="hover:text-fg">
            Explorer
          </a>
          <span className="flex items-center gap-2">
            <span className="size-1.5 animate-pulse-dot rounded-full bg-accent" aria-hidden />
            Robinhood Chain Testnet · 46630
          </span>
        </div>
      </div>
    </footer>
  );
}
