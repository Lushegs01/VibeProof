import Link from "next/link";
import { Wordmark } from "./logo";
import { SearchTrigger } from "./command-palette";
import { MobileNav } from "./mobile-nav";

export const NAV = [
  { href: "/discover", label: "Discover" },
  { href: "/activity", label: "Activity" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/submit", label: "Submit proof" },
];

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 md:px-6">
        <Link href="/" aria-label="VibeProof home" className="shrink-0">
          <Wordmark />
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-5 md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="text-sm text-fg-2 transition-colors hover:text-fg">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <SearchTrigger className="w-40 lg:w-56" />
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
