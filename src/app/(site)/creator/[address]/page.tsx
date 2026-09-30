import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { parseAddress, shortAddress } from "@/lib/util/address";
import { getCreatorPassport } from "@/lib/services/creator-service";
import { formatInt, formatUtc, timeAgo } from "@/lib/util/format";
import { Address } from "@/components/ui/address";
import { Section, Pill } from "@/components/ui/primitives";
import { EvidenceButton } from "@/components/ui/evidence";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ address: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address } = await params;
  return { title: `Creator ${shortAddress(address)}` };
}

export default async function CreatorPage({ params }: Props) {
  const { address } = await params;
  const a = parseAddress(address) ?? parseAddress(address.toLowerCase());
  if (!a) notFound();
  const { creator } = await getCreatorPassport(a);

  if (!creator)
    return (
      <div className="mx-auto max-w-6xl px-4 py-16 md:px-6">
        <p className="label">Creator Passport</p>
        <div className="mt-4">
          <Address value={a} short={false} className="text-lg" />
        </div>
        <p className="mt-6 max-w-lg text-fg-2">No vibe/vibe launches from this wallet have been observed by the VibeProof indexer. This is an observation about our index, not a statement about the wallet.</p>
      </div>
    );

  return (
    <div className="mx-auto max-w-6xl px-4 md:px-6">
      <header className="pb-8 pt-10 md:pt-14">
        <div className="flex items-center gap-2">
          <span className="label">Creator Passport</span>
          {creator.demo ? <Pill tone="claimed">Demo data</Pill> : null}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Address value={creator.address} short={false} className="text-base md:text-xl" />
        </div>
        <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-5">
          {[
            ["First observed", creator.firstSeenAt ? timeAgo(creator.firstSeenAt) : "—", creator.firstSeenAt ? formatUtc(creator.firstSeenAt) : ""],
            ["Launches", formatInt(creator.launchCount), creator.definitions.launches],
            ["Graduated", formatInt(creator.graduatedLaunchCount), creator.definitions.graduated],
            ["Active", formatInt(creator.activeLaunchCount), creator.definitions.active],
            ["Historical", formatInt(creator.historicalLaunchCount), creator.definitions.historical],
          ].map(([k, v, d]) => (
            <div key={k} className="bg-surface px-4 py-4">
              <dt className="label flex items-center gap-1">
                {k}
                <EvidenceButton metric={`Creator ${k}`} value={v} evidence={creator.evidence} note={d} />
              </dt>
              <dd className="mt-2 font-mono text-2xl tabular">{v}</dd>
            </div>
          ))}
        </dl>
      </header>

      <Section title="Observed history" kicker="chronological, newest first">
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full min-w-[680px] text-sm">
            <caption className="sr-only">Launches by this creator</caption>
            <thead>
              <tr className="text-left">
                {["Token", "Deployed", "Status", "Holders", "Transfers", "Last activity"].map((h, i) => (
                  <th key={h} scope="col" className={`label px-4 py-2.5 font-normal ${i >= 3 && i <= 4 ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {creator.launches.map((l) => (
                <tr key={l.token} className="border-t border-line/70 hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <Link href={`/token/robinhood-testnet/${l.token}`} className="font-medium hover:underline">
                      {l.symbol ? `$${l.symbol}` : shortAddress(l.token)}
                    </Link>
                    <div className="max-w-[220px] truncate text-xs text-fg-2">{l.name}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-fg-2">
                    <a href={`https://explorer.testnet.chain.robinhood.com/tx/${l.txHash}`} target="_blank" rel="noopener noreferrer" className="hover:text-fg">
                      {formatUtc(l.createdAt)}
                    </a>
                  </td>
                  <td className="px-4 py-3">{l.status === "graduated" ? <Pill tone="observed">Graduated</Pill> : <Pill tone="muted">Bonding</Pill>}</td>
                  <td className="px-4 py-3 text-right font-mono tabular">{l.holders === null ? <span className="text-fg-2">Unavailable</span> : formatInt(l.holders)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular">{l.transactions === null ? <span className="text-fg-2">Unavailable</span> : formatInt(l.transactions)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-fg-2">{l.lastActivityAt ? timeAgo(l.lastActivityAt) : "None observed"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-muted">VibeProof does not label creators. Relationships between wallets are not inferred; only launches whose event names this wallet are listed.</p>
      </Section>
    </div>
  );
}
