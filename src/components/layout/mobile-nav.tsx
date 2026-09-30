"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useState } from "react";

const NAV = [
  { href: "/discover", label: "Discover" },
  { href: "/activity", label: "Activity" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/submit", label: "Submit proof" },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? "Close menu" : "Open menu"} className="rounded p-2 text-fg-2 hover:text-fg">
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>
      {open ? (
        <nav id="mobile-nav" aria-label="Mobile" className="absolute inset-x-0 top-14 border-b border-line bg-bg px-4 py-2">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="block border-b border-line/60 py-3 text-[15px] text-fg-2 last:border-b-0 hover:text-fg">
              {n.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
