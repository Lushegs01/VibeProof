import type { Metadata } from "next";
import Link from "next/link";
import { discover, SORTS, CATEGORIES, type SortKey, type CategoryKey } from "@/lib/services/discover-service";
import { formatInt, timeAgo } from "@/lib/util/format";
import { shortAddress } from "@/lib/util/address";
import { Pill } from "@/components/ui/primitives";
import { cn } from "@/lib/util/cn";

export const metadata: Metadata = { title: "Discover launches" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ sort?: string; category?: string }> };

export default async function DiscoverPage({ searchParams }: Props) {
  const sp = await searchParams;
  const sort = (sp.sort && sp.sort in SORTS ? sp.sort : "newest") as SortKey;
  const category = (sp.category && sp.category in CATEGORIES ? sp.category : "all") as CategoryKey;
  const { items } = await discover(sort, category, 60);
  const href = (s: string, c: string) => `/discover?sort=${s}&category=${c}`;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-10 md:px-6 md:pt-14">
      <p className="label">Discover</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">vibe/vibe launches</h1>
      <p className="mt-3 max-w-xl text-fg-2">Transparent sorting only. There is no “best token” ranking and no recommendation.</p>

      <nav aria-label="Category" className="mt-8 flex flex-wrap gap-2">
        {Object.entries(CATEGORIES).map(([k, label]) => (
          <Link key={k} href={href(sort, k)} aria-current={k === category ? "page" : undefined} className={cn("rounded-md border px-3 py-1.5 text-sm transition-colors", k === category ? "border-fg/40 bg-surface-3 text-fg" : "border-line text-fg-2 hover:text-fg")}>
            {label}
          </Link>
        ))}
      </nav>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="label">Sort by</span>
        {Object.entries(SORTS).map(([k, s]) => (
          <Link key={k} href={href(k, category)} aria-current={k === sort ? "true" : undefined} className={cn("transition-colors", k === sort ? "text-fg underline decoration-accent underline-offset-[6px]" : "text-fg-2 hover:text-fg")}>
            {s.label}
          </Link>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        <span className="text-fg-2">How this is sorted:</span> {SORTS[sort].explain}
      </p>

      <div className="mt-6 overflow-x-auto rounded-md border border-line">
        <table className="w-full min-w-[760px] text-sm">
          <caption className="sr-only">Launches sorted by {SORTS[sort].label}</caption>
          <thead>
            <tr className="text-left">
              {["Token", "Creator", "Launched", "Holders", "Transfers", "Status", "Proof", "Last active"].map((h, i) => (
                <th key={h} scope="col" className={`label px-4 py-2.5 font-normal ${i === 3 || i === 4 ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.address} className="border-t border-line/70 hover:bg-surface-2">
                <td className="px-4 py-3">
                  <Link href={`/token/robinhood-testnet/${t.address}`} className="font-medium hover:underline">
                    {t.symbol ? `$${t.symbol}` : shortAddress(t.address)}
                  </Link>
                  <div className="max-w-[200px] truncate text-xs text-fg-2">{t.name}</div>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{t.creator ? <Link href={`/creator/${t.creator}`} className="text-fg-2 hover:text-fg">{shortAddress(t.creator)}</Link> : "—"}</td>
                <td className="px-4 py-3 font-mono text-xs text-fg-2">{timeAgo(t.createdAt)}</td>
                <td className="px-4 py-3 text-right font-mono tabular">{t.holders === null ? <span className="text-fg-2">Unavailable</span> : formatInt(t.holders)}</td>
                <td className="px-4 py-3 text-right font-mono tabular">{t.transactions === null ? <span className="text-fg-2">Unavailable</span> : formatInt(t.transactions)}</td>
                <td className="px-4 py-3">{t.status === "graduated" ? <Pill tone="observed">Graduated</Pill> : <Pill tone="muted">Bonding</Pill>}</td>
                <td className="px-4 py-3">{t.proofSubmitted ? <Pill tone="accent">Submitted</Pill> : <span className="text-xs text-muted">—</span>}</td>
                <td className="px-4 py-3 font-mono text-xs text-fg-2">{t.lastActivityAt ? timeAgo(t.lastActivityAt) : "None"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length ? <p className="p-6 text-sm text-fg-2">Nothing in this category yet.</p> : null}
      </div>
    </div>
  );
}
