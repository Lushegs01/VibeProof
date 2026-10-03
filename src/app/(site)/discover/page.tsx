import type { Metadata } from "next";
import Link from "next/link";
import { discover, SORTS, CATEGORIES, type SortKey, type CategoryKey } from "@/lib/services/discover-service";
import { formatInt, timeAgo } from "@/lib/util/format";
import { shortAddress } from "@/lib/util/address";
import { Pill } from "@/components/ui/primitives";
import { cn } from "@/lib/util/cn";
import { LaunchStatus } from "@/components/ui/launch-status";
import { getNetwork, activeNetwork, tokenPath, type NetworkSlug } from "@/lib/chain/networks";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Discover launches" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ sort?: string; category?: string; chain?: string }> };

export default async function DiscoverPage({ searchParams }: Props) {
  const sp = await searchParams;
  const sort = (sp.sort && sp.sort in SORTS ? sp.sort : "newest") as SortKey;
  const category = (sp.category && sp.category in CATEGORIES ? sp.category : "all") as CategoryKey;
  const net = sp.chain ? getNetwork(sp.chain) : activeNetwork();
  if (!net) notFound();
  const { items, excludedIncomplete } = await discover(sort, category, 60, net.slug);
  const href = (s: string, c: string) => `/discover?sort=${s}&category=${c}${sp.chain ? `&chain=${net.slug}` : ""}`;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-10 md:px-6 md:pt-14">
      <p className="label">Discover</p>
      <h1 className="text-gradient mt-3 text-4xl font-medium leading-tight md:text-5xl">vibe/vibe launches</h1>
      <p className="mt-3 max-w-xl text-fg-2">Transparent sorting only. There is no “best token” ranking and no recommendation.</p>

      <nav aria-label="Category" className="mt-8 flex flex-wrap gap-2">
        {Object.entries(CATEGORIES).map(([k, label]) => (
          <Link key={k} href={href(sort, k)} aria-current={k === category ? "page" : undefined} className={cn("rounded-full border px-4 py-2 text-sm transition-colors", k === category ? "border-accent/60 bg-accent-dim text-fg" : "border-line-strong text-fg-2 hover:text-fg")}>
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
        {excludedIncomplete ? <> {excludedIncomplete.toLocaleString("en-US")} launches whose history is still being indexed are not ranked.</> : null}
      </p>

      <div className="mt-6 overflow-x-auto rounded-[20px] border border-line bg-surface/50">
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
                  <Link href={tokenPath(t.address, t.chain as NetworkSlug)} className="font-medium hover:underline">
                    {t.symbol ? `$${t.symbol}` : shortAddress(t.address)}
                  </Link>
                  <div className="max-w-[200px] truncate text-xs text-fg-2">{t.name}</div>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{t.creator ? <Link href={`/creator/${t.creator}`} className="text-fg-2 hover:text-fg">{shortAddress(t.creator)}</Link> : "—"}</td>
                <td className="px-4 py-3 font-mono text-xs text-fg-2">{timeAgo(t.createdAt)}</td>
                <td className="px-4 py-3 text-right font-mono tabular">{t.holders === null ? <span className="text-fg-2">{t.historyComplete ? "Unavailable" : "History pending"}</span> : formatInt(t.holders)}</td>
                <td className="px-4 py-3 text-right font-mono tabular">{t.transactions === null ? <span className="text-fg-2">{t.historyComplete ? "Unavailable" : "History pending"}</span> : formatInt(t.transactions)}</td>
                <td className="px-4 py-3">
                  <LaunchStatus status={t.status} />
                </td>
                <td className="px-4 py-3">{t.proofSubmitted ? <Pill tone="accent">Submitted</Pill> : <span className="text-xs text-muted">—</span>}</td>
                <td className="px-4 py-3 font-mono text-xs text-fg-2">{!t.historyComplete ? "Unavailable" : t.lastActivityAt ? timeAgo(t.lastActivityAt) : "None observed"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length ? <p className="p-6 text-sm text-fg-2">Nothing in this category yet.</p> : null}
      </div>
    </div>
  );
}
