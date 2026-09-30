import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { SearchTrigger } from "@/components/layout/command-palette";
import { discover, activityFeed } from "@/lib/services/discover-service";
import { isDemoMode } from "@/lib/demo/mode";
import { formatInt, timeAgo } from "@/lib/util/format";
import { Pill } from "@/components/ui/primitives";

export const revalidate = 15;

const PILLARS = [
  { k: "Contract", h: "Know what the code can do.", b: "Bytecode, explorer source, proxy slots and admin functions. Each result links to the call that produced it." },
  { k: "Creator", h: "Know what the deployer has done.", b: "Every vibe/vibe launch from the same wallet, with status and activity. Observed history, not a reputation label." },
  { k: "Product", h: "See whether there is something behind the token.", b: "Website, GitHub and demo checked for reachability, activity and a link back to the contract." },
  { k: "Activity", h: "Understand what is happening onchain.", b: "Holders, transfers, curve buys and sells from indexed events, plus what changed since you last looked." },
];

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function Home() {
  const demo = isDemoMode();
  const [{ items }, feed] = await Promise.all([safe(() => discover("active", "all", 6), { items: [], cached: false }), safe(() => activityFeed(8), [])]);

  return (
    <>
      <section className="grid-bg relative border-b border-line">
        <div className="mx-auto max-w-6xl px-4 pb-20 pt-20 md:px-6 md:pb-28 md:pt-28">
          <p className="label">VibeProof · Robinhood Chain</p>
          <h1 className="mt-5 max-w-3xl text-5xl font-semibold leading-[1.02] tracking-tight md:text-7xl">Know what was launched.</h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-fg-2">The verification and intelligence layer for vibe/vibe launches. Contract data, creator history, product proof and onchain activity in one passport.</p>
          <div className="mt-10 max-w-xl">
            <SearchTrigger large />
            <p className="mt-3 text-xs text-muted">Token address · $SYMBOL · creator wallet · transaction hash</p>
          </div>
        </div>
      </section>

      <section aria-label="What VibeProof shows" className="mx-auto grid max-w-6xl gap-px px-4 py-16 md:grid-cols-2 md:px-6 lg:grid-cols-4">
        {PILLARS.map((p) => (
          <div key={p.k} className="border-t border-line pt-6 lg:pr-6">
            <p className="label !text-accent">{p.k}</p>
            <h2 className="mt-3 text-lg font-medium leading-snug">{p.h}</h2>
            <p className="mt-3 text-sm leading-relaxed text-fg-2">{p.b}</p>
          </div>
        ))}
      </section>

      <section aria-label="Live preview" className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="mb-5 flex items-center gap-3">
          <h2 className="label !text-fg">Most recently active</h2>
          {demo ? <Pill tone="claimed">Demo data</Pill> : <Pill tone="accent"><span className="size-1.5 animate-pulse-dot rounded-full bg-accent" />Live · testnet</Pill>}
          <Link href="/discover?sort=active" className="ml-auto text-sm text-fg-2 hover:text-fg">
            All launches →
          </Link>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
          <div className="overflow-hidden rounded-md border border-line">
            {items.length ? (
              <table className="w-full text-sm">
                <caption className="sr-only">Recently active vibe/vibe launches</caption>
                <thead>
                  <tr className="text-left">
                    {["Token", "Holders", "Transfers", "Proof", "Active"].map((h, i) => (
                      <th key={h} scope="col" className={`label px-4 py-2.5 font-normal ${i > 0 && i < 4 ? "text-right" : ""} ${i === 3 ? "hidden sm:table-cell" : ""}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((t) => (
                    <tr key={t.address} className="border-t border-line/70 transition-colors hover:bg-surface-2">
                      <td className="px-4 py-3">
                        <Link href={`/token/robinhood-testnet/${t.address}`} className="font-medium hover:underline">
                          {t.symbol ? `$${t.symbol}` : "Unnamed"}
                        </Link>
                        <div className="max-w-[180px] truncate text-xs text-fg-2">{t.name}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular">{formatInt(t.holders)}</td>
                      <td className="px-4 py-3 text-right font-mono tabular">{formatInt(t.transactions)}</td>
                      <td className="hidden px-4 py-3 text-right sm:table-cell">{t.proofSubmitted ? <Pill tone="accent">Submitted</Pill> : <span className="text-xs text-muted">—</span>}</td>
                      <td className="px-4 py-3 font-mono text-xs text-fg-2">{timeAgo(t.lastActivityAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="p-6 text-sm text-fg-2">No indexed launches yet. Start the indexer (`npm run indexer`) or enable demo mode.</p>
            )}
          </div>
          <div className="rounded-md border border-line">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="label">Activity feed</span>
              <Link href="/activity" className="text-xs text-fg-2 hover:text-fg">
                Open →
              </Link>
            </div>
            <ul>
              {feed.map((f) => (
                <li key={f.id} className="border-b border-line/60 px-4 py-2.5 last:border-b-0">
                  <div className="flex items-baseline gap-2 text-sm">
                    <Link href={`/token/robinhood-testnet/${f.token}`} className="font-medium hover:underline">
                      {f.symbol ? `$${f.symbol}` : "Token"}
                    </Link>
                    <span className="ml-auto font-mono text-[11px] text-muted">{timeAgo(f.at)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-fg-2">{f.message}</p>
                </li>
              ))}
              {!feed.length ? <li className="px-4 py-6 text-sm text-fg-2">No events yet.</li> : null}
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-24 max-w-6xl px-4 md:px-6">
        <div className="grid gap-10 border-t border-line pt-10 md:grid-cols-2">
          <div>
            <p className="label">Principle</p>
            <h2 className="mt-3 text-2xl font-medium tracking-tight">No scores. No verdicts. Evidence.</h2>
          </div>
          <div className="space-y-4 text-sm leading-relaxed text-fg-2">
            <p>VibeProof separates what is cryptographically true, what was measured, and what the creator says, and labels each. There is no single trust score, and nothing on this site tells you what to buy.</p>
            <p>Where a check could not run, it says “Unavailable”. It never shows zero.</p>
            <div className="flex gap-5 pt-2">
              <Link href="/methodology" className="inline-flex items-center gap-1 text-fg hover:underline">
                Methodology <ArrowUpRight className="size-3.5" />
              </Link>
              <Link href="/submit" className="inline-flex items-center gap-1 text-fg hover:underline">
                Submit project proof <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
