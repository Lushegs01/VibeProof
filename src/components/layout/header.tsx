import Link from "next/link";
import { Ghost, Sparkles } from "lucide-react";
import { Wordmark } from "./logo";
import { SearchTrigger } from "./command-palette";
import { MobileNav } from "./mobile-nav";

export const NAV = [
  { href: "/discover", label: "Discover" },
  { href: "/activity", label: "Activity" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/methodology", label: "Methodology" },
];

export function Header() {
  return (
    <>
      <div className="haunt-banner">
        <div className="mx-auto flex max-w-6xl items-center justify-center gap-6 px-4 py-2.5 sm:justify-between md:px-6">
          <Link href="/#haunt" className="edition-label hover:text-fg">
            <Ghost className="size-3.5" aria-hidden="true" /> Haunt the Chain <span className="text-fg-2">/ Halloween edition</span>
          </Link>
          <span className="hidden items-center gap-2 font-mono text-[10px] text-fg-2 sm:flex">
            <Sparkles className="size-3 text-accent" aria-hidden="true" /> No tricks. Just evidence.
          </span>
        </div>
      </div>
      <header className="sticky top-0 z-40 border-b border-line/60 bg-bg/70 backdrop-blur-xl">
        <div className="mx-auto grid h-[68px] max-w-6xl grid-cols-[1fr_auto] items-center gap-6 px-4 md:grid-cols-[1fr_auto_1fr] md:px-6">
          <Link href="/" aria-label="VibeProof home" className="justify-self-start">
            <Wordmark />
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-7 md:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-[14px] text-fg-2 transition-colors hover:text-fg">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2 justify-self-end">
            <SearchTrigger className="hidden w-44 lg:flex" />
            <SearchTrigger className="lg:hidden" compact />
            <Link href="/submit" className="btn btn-primary hidden h-10 px-5 sm:inline-flex">
              Submit proof
            </Link>
            <MobileNav />
          </div>
        </div>
      </header>
    </>
  );
}
