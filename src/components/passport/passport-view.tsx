import { IndependentProof } from "./independent-proof";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { TokenPassport } from "@/lib/services/types";
import type { SeriesPoint } from "@/lib/services/token-service";
import { buildStatements } from "@/lib/services/statements";
import { formatInt, formatToken, formatUtc, timeAgo } from "@/lib/util/format";
import { shortAddress } from "@/lib/util/address";
import { Section, Card, Row, Pill } from "@/components/ui/primitives";
import { StateBadge, CheckStatus } from "@/components/ui/state-badge";
import { Address } from "@/components/ui/address";
import { EvidenceButton } from "@/components/ui/evidence";
import { Metric } from "./metric";
import { ActivityChart } from "./activity-chart";
import { RefreshAnalysis, ShareButton, WatchButton, WhatChanged } from "./client-bits";
import { LaunchStatus } from "@/components/ui/launch-status";
import { explorerLink, type NetworkSlug } from "@/lib/chain/networks";

const KEY_CHECKS = ["source_verified", "proxy", "mint", "pause", "blacklist", "upgrade", "fees", "owner"];
const KIND_LABEL = { fact: "Fact", observation: "Observation", creator_claim: "Creator claim", inference: "Inference" } as const;
const KIND_TONE = { fact: "accent", observation: "observed", creator_claim: "claimed", inference: "muted" } as const;
const COVERAGE_LABEL = {
  fully_covered: "Full history indexed",
  indexing: "Indexing history",
  partial: "History incomplete",
  error: "History indexing failed",
  not_indexed: "Not indexed",
} as const;
const COVERAGE_TONE = { fully_covered: "observed", indexing: "accent", partial: "attention", error: "attention", not_indexed: "muted" } as const;

export function PassportView({ p, series, publicView = false }: { p: TokenPassport; series: SeriesPoint[] | null; publicView?: boolean }) {
  const c = p.contract;
  const productComplete = p.proof.score.observed >= p.proof.score.total;
  const symbol = p.symbol ? `$${p.symbol}` : "Unnamed token";
  const adminDetected = c.checks.filter(
    (x) => ["mint", "pause", "blacklist", "upgrade", "fees", "transfer_limits", "trading_toggle"].includes(x.id) && x.status === "detected",
  ).length;
  const statements = buildStatements(p);
  const chain = p.chain as NetworkSlug;
  const launchpadName = p.launch?.launchpad === "vibe" || !p.launch ? "vibe/vibe" : p.launch.launchpad;

  return (
    <article className="mx-auto max-w-6xl px-4 md:px-6" aria-label={`${symbol} launch passport`}>
      {/* ── HEADER ─────────────────────────────────────────────── */}
      <header className="pb-8 pt-10 md:pt-14">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="label">Launch Passport</span>
          {p.demo ? <Pill tone="claimed">Demo data</Pill> : null}
          {p.isVibeLaunch ? (
            <Pill tone="accent">
              {launchpadName} launch · {p.launch?.deploymentId}
            </Pill>
          ) : (
            <Pill tone="attention">Not a recognised vibe/vibe launch</Pill>
          )}
          {p.launch ? <LaunchStatus status={p.launch.status} /> : null}
          {p.isVibeLaunch ? <Pill tone={COVERAGE_TONE[p.coverage.status]}>{COVERAGE_LABEL[p.coverage.status]}</Pill> : null}
          <Pill tone="muted">{p.chainName}</Pill>
        </div>
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <h1 className="text-gradient truncate pb-1 text-4xl font-medium leading-tight md:text-6xl">{symbol}</h1>
            <p className="mt-2 truncate text-lg text-fg-2">{p.name ?? "Name not reported by contract"}</p>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <span className="flex items-center gap-2">
                <span className="label">Contract</span>
                <Address value={p.address} explorer="token" chain={chain} />
              </span>
              <span className="flex items-center gap-2">
                <span className="label">Product</span>
                {p.proof.submitted ? (
                  <span className={productComplete ? "text-accent" : "text-fg"}>{productComplete ? "Product proof complete" : "Project proof incomplete"}</span>
                ) : (
                  <span className="text-fg-2">No project proof submitted</span>
                )}
              </span>
            </div>
          </div>
          {!publicView ? (
            <div className="flex shrink-0 gap-2">
              <WatchButton
                chain={chain}
                address={p.address}
                symbol={p.symbol}
                holders={typeof p.activity.holders.value === "number" ? p.activity.holders.value : null}
              />
              <ShareButton address={p.address} />
            </div>
          ) : (
            <Link href={`/token/${p.chain}/${p.address}`} className="btn btn-outline h-10 px-5 text-sm">
              Open full passport <ArrowUpRight className="size-4" />
            </Link>
          )}
        </div>

        {/* Dimension strip — deliberately NOT a single score */}
        <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-[20px] border border-accent/20 bg-accent-dim md:grid-cols-4">
          <Dim
            k="Contract"
            href="#contract"
            v={`${c.summary.total} checks`}
            sub={`${adminDetected} admin capabilit${adminDetected === 1 ? "y" : "ies"} detected`}
          />
          <Dim
            k="Creator"
            href="#creator"
            v={p.creator ? `${p.creator.launchCount} launch${p.creator.launchCount === 1 ? "" : "es"}` : "Unknown"}
            sub={p.creator ? `${p.creator.graduatedLaunchCount} graduated` : "Not an indexed launch"}
          />
          <Dim k="Product" href="#product" v={`${p.proof.score.observed}/${p.proof.score.total}`} sub="independently observed" />
          <Dim
            k="Activity"
            href="#activity"
            v={p.activity.holders.value !== null ? `${formatInt(p.activity.holders.value as number)} holders` : "Unavailable"}
            sub={p.activity.transactions.value !== null ? `${formatInt(p.activity.transactions.value as number)} transactions` : "—"}
          />
        </dl>
      </header>

      {p.isVibeLaunch && p.coverage.status !== "fully_covered" ? (
        <div role="status" className="mb-2 rounded-[20px] border border-dashed border-line-strong bg-surface/50 px-5 py-4 text-sm text-fg-2">
          <span className="font-medium text-fg">{COVERAGE_LABEL[p.coverage.status]}.</span> {p.coverage.explanation}
          {p.coverage.backfill?.lastError ? <span className="mt-1 block font-mono text-xs text-muted">Last error: {p.coverage.backfill.lastError}</span> : null}
          <span className="mt-1 block text-xs text-muted">
            Until then, holder and transfer counts come from the explorer (labelled), and VibeProof&apos;s own counters show as Unavailable, never as zero.
          </span>
        </div>
      ) : null}

      {/* ── OVERVIEW ───────────────────────────────────────────── */}
      <Section id="overview" title="Overview" kicker={`observed ${timeAgo(p.observedAt)}`}>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
          <Metric size="lg" label="Holders" obs={p.activity.holders} format={(v: number) => formatInt(v)} />
          <Metric size="lg" label="Transactions" obs={p.activity.transactions} format={(v: number) => formatInt(v)} />
          <Metric size="lg" label="Buyers" obs={p.activity.buyers} format={(v: number) => formatInt(v)} />
          <Metric size="lg" label="Sellers" obs={p.activity.sellers} format={(v: number) => formatInt(v)} />
          <div>
            <span className="label">Created</span>
            <div className="mt-1 font-mono text-2xl md:text-[28px]">{p.createdAt ? timeAgo(p.createdAt) : "Unknown"}</div>
            {p.createdAt ? (
              <div className="mt-0.5 text-xs text-muted">
                {formatUtc(p.createdAt)}
                {p.launch?.createdAtExact === false ? " (≈, interpolated between block headers)" : ""}
              </div>
            ) : null}
          </div>
        </div>
      </Section>

      {!publicView ? (
        <Section id="changes" title="What changed" kicker="compared with a stored snapshot">
          <WhatChanged address={p.address} />
        </Section>
      ) : null}

      {/* ── CONTRACT ───────────────────────────────────────────── */}
      <Section
        id="contract"
        title="Contract"
        kicker={`block #${Number(c.block).toLocaleString("en-US")}`}
        action={!publicView && !p.demo ? <RefreshAnalysis address={p.address} /> : null}
      >
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
          <Card className="px-5">
            {KEY_CHECKS.map((id) => {
              const ch = c.checks.find((x) => x.id === id);
              if (!ch) return null;
              return (
                <Row key={id} label={ch.label} hint={ch.note}>
                  {id === "owner" ? (
                    ch.value ? (
                      <Address value={ch.value} href={`/creator/${ch.value}`} chain={chain} />
                    ) : (
                      <span className="font-mono text-[12px] text-fg-2">{ch.state === "unavailable" ? "UNAVAILABLE" : "NO owner()"}</span>
                    )
                  ) : id === "source_verified" ? (
                    <StateBadge state={ch.state} />
                  ) : (
                    <CheckStatus status={ch.status} />
                  )}
                  <EvidenceButton metric={ch.label} value={ch.value ?? ch.status.replace("_", " ")} evidence={ch.evidence} note={ch.note} />
                </Row>
              );
            })}
          </Card>
          <div className="space-y-4 text-sm leading-relaxed text-fg-2">
            <p>
              <span className="text-fg">DETECTED</span> means a function with that capability exists in the contract. It is not a judgement: many legitimate
              tokens have mint or pause functions. <span className="text-fg">NOT DETECTED</span> means no standard function signature was found; custom-named
              functions are not caught by a selector scan.
            </p>
            <dl className="grid grid-cols-2 gap-3 font-mono text-xs">
              <div>
                <dt className="label">Decimals</dt>
                <dd className="mt-1 text-fg">{c.basics.decimals ?? "Unavailable"}</dd>
              </div>
              <div>
                <dt className="label">Total supply</dt>
                <dd className="mt-1 text-fg">{c.basics.totalSupply ? formatToken(c.basics.totalSupply, c.basics.decimals ?? 18, 0) : "Unavailable"}</dd>
              </div>
            </dl>
          </div>
        </div>
        <details className="group mt-6 rounded-[20px] border border-line bg-surface/50">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-sm text-fg-2 hover:text-fg">
            <span>View technical details · {c.checks.length} checks</span>
            <span className="font-mono text-xs transition-transform group-open:rotate-45" aria-hidden>
              +
            </span>
          </summary>
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">All contract checks with evidence</caption>
              <thead>
                <tr className="text-left">
                  {["Check", "Status", "State", "Value", "Method", ""].map((h) => (
                    <th key={h} scope="col" className="label px-5 py-2.5 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {c.checks.map((ch) => (
                  <tr key={ch.id} className="border-t border-line/70 align-top">
                    <td className="px-5 py-2.5">{ch.label}</td>
                    <td className="px-5 py-2.5">
                      <CheckStatus status={ch.status} />
                    </td>
                    <td className="px-5 py-2.5">
                      <StateBadge state={ch.state} />
                    </td>
                    <td className="max-w-[220px] break-all px-5 py-2.5 font-mono text-xs text-fg-2">{ch.value ?? "—"}</td>
                    <td className="px-5 py-2.5 text-xs text-fg-2">{ch.evidence.method}</td>
                    <td className="px-5 py-2.5">
                      <EvidenceButton metric={ch.label} value={ch.value ?? ch.status} evidence={ch.evidence} note={ch.note} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Section>

      {/* ── CREATOR ────────────────────────────────────────────── */}
      <Section id="creator" title="Creator" kicker="observed history, not a rating">
        {p.creator ? (
          <Card className="grid gap-6 p-5 md:grid-cols-[1fr_2fr] md:items-center">
            <div>
              <span className="label">Launcher wallet</span>
              <div className="mt-2">
                <Address value={p.creator.address} href={`/creator/${p.creator.address}?chain=${chain}`} chain={chain} />
              </div>
              <div className="mt-1 text-xs text-muted">First observed {p.creator.firstSeenAt ? timeAgo(p.creator.firstSeenAt) : "—"}</div>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-6">
              <dl className="grid grid-cols-3 gap-8">
                {[
                  ["Launches", p.creator.launchCount],
                  ["Graduated", p.creator.graduatedLaunchCount],
                  ["Historical", p.creator.historicalLaunchCount],
                ].map(([k, v]) => (
                  <div key={k as string}>
                    <dt className="label">{k}</dt>
                    <dd className="mt-1 font-mono text-2xl tabular">{formatInt(v as number)}</dd>
                  </div>
                ))}
              </dl>
              <Link href={`/creator/${p.creator.address}?chain=${chain}`} className="inline-flex items-center gap-1.5 text-sm text-fg-2 hover:text-fg">
                View Creator Passport <ArrowUpRight className="size-4" />
              </Link>
            </div>
          </Card>
        ) : (
          <p className="text-sm text-fg-2">
            {p.isVibeLaunch
              ? "Creator data unavailable."
              : "This token was not created by a configured vibe/vibe factory, so no launcher is recorded. The contract's owner (if any) is shown under Contract."}
          </p>
        )}
      </Section>

      {/* ── PRODUCT ────────────────────────────────────────────── */}
      <Section
        id="product"
        title="Product"
        kicker={p.proof.submitted ? `submitted ${timeAgo(p.proof.submittedAt)}${p.proof.submitterIsCreator ? " by the launch creator" : ""}` : undefined}
      >
        {p.proof.submitted ? (
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
            <Card className="px-5">
              {(["website", "github", "demo", "docs", "twitter", "discord"] as const).map((t) => {
                const ch = p.proof.checks.find((x) => x.type === t);
                if (!ch && !["website", "github", "demo"].includes(t)) return null;
                return (
                  <Row
                    key={t}
                    label={<span className="capitalize">{t === "github" ? "GitHub" : t}</span>}
                    hint={
                      ch ? (
                        <a href={ch.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all hover:text-fg-2">
                          {ch.url}
                        </a>
                      ) : (
                        "Not submitted"
                      )
                    }
                  >
                    {ch ? (
                      <>
                        <StateBadge state={ch.state} />
                        <EvidenceButton metric={`${t} check`} value={ch.summary} evidence={ch.evidence} />
                      </>
                    ) : (
                      <span className="font-mono text-[12px] text-muted">—</span>
                    )}
                  </Row>
                );
              })}
            </Card>
            <div className="space-y-5">
              {(() => {
                const gh = p.proof.checks.find((x) => x.type === "github");
                if (!gh) return null;
                const f = gh.facts;
                return (
                  <dl className="grid grid-cols-2 gap-5">
                    <Fact k="Commits / 30d" v={f.commits30d} />
                    <Fact k="Contributors" v={f.contributors} />
                    <Fact k="Last commit" v={typeof f.lastCommitAt === "string" ? timeAgo(f.lastCommitAt) : null} />
                    <Fact k="Releases" v={f.releases} />
                  </dl>
                );
              })()}
              {p.proof.description ? (
                <blockquote className="border-l border-claimed/40 pl-4 text-sm text-fg-2">
                  <span className="label !text-claimed">Creator claim</span>
                  <p className="mt-1">{p.proof.description}</p>
                </blockquote>
              ) : null}
              <p className="text-xs leading-relaxed text-muted">
                A reachable website or active repository shows that something exists and is maintained. It does not show that a product works as described.
              </p>
              {p.proof.controls?.length ? (
                <ul className="space-y-2 text-xs">
                  {p.proof.controls.map((c, i) => (
                    <li key={`${c.target}:${i}`}>
                      <strong>{c.status.replaceAll("_", " ")}</strong> · {c.target}
                      <br />
                      Last checked {c.lastCheckedAt ?? "not yet checked"} · expires {c.expiresAt}
                    </li>
                  ))}
                </ul>
              ) : null}
              {p.proof.registryTx ? (
                <p className="text-xs text-fg-2">
                  Anchored onchain in VibeProofRegistry · <Address value={p.proof.registryTx} explorer="tx" chain={chain} />
                  {p.proof.metadataUri ? (
                    <>
                      <br />
                      Immutable document: <span className="break-all">{p.proof.metadataUri}</span>
                      <br />
                      <a
                        className="text-accent underline"
                        href={`/api/proofs/verify?network=${p.chain}&txHash=${p.proof.registryTx}&token=${p.address}&creator=${p.proof.submittedBy}`}
                      >
                        Reproduce commitment using chain and document
                      </a>
                    </>
                  ) : (
                    <span> · Legacy commitment; original bytes may be unavailable.</span>
                  )}
                </p>
              ) : null}
              {p.proof.registryTx && p.proof.submittedBy ? (
                <IndependentProof chain={p.chain} token={p.address} creator={p.proof.submittedBy} txHash={p.proof.registryTx} launchTx={p.launch?.txHash} />
              ) : null}
            </div>
          </div>
        ) : (
          <Card className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-fg-2">No project proof has been submitted. Website, GitHub and demo are all unverified.</p>
            {!publicView ? (
              <Link href={`/submit?token=${p.address}`} className="text-sm text-accent hover:underline">
                Are you the creator? Submit proof →
              </Link>
            ) : null}
          </Card>
        )}
      </Section>

      {/* ── ACTIVITY ───────────────────────────────────────────── */}
      <Section
        id="activity"
        title="Onchain activity"
        kicker={
          p.coverage.status === "fully_covered"
            ? `indexed through block #${Number(p.indexer.indexedThrough).toLocaleString("en-US")}`
            : `${COVERAGE_LABEL[p.coverage.status].toLowerCase()} · explorer counters shown meanwhile`
        }
      >
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Holders" obs={p.activity.holders} format={(v: number) => formatInt(v)} />
          <Metric label="Transfers" obs={p.activity.transactions} format={(v: number) => formatInt(v)} />
          <Metric label="Curve buys" obs={p.activity.buys} format={(v: number) => formatInt(v)} />
          <Metric label="Curve sells" obs={p.activity.sells} format={(v: number) => formatInt(v)} />
          <Metric label="Volume (ETH)" obs={p.activity.volumeEth} format={(v: string) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 4 })} />
          <Metric label="Last activity" obs={p.activity.lastActivityAt} format={(v: string) => timeAgo(v)} />
        </div>
        {series ? (
          <Card className="mt-8 p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="label">Events per hour · since launch or last 7 days</span>
            </div>
            <ActivityChart series={series} />
          </Card>
        ) : null}
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.5fr_1fr] [&>*]:min-w-0">
          <div>
            <h3 className="label mb-3">Recent events</h3>
            {p.recent.length ? (
              <div className="overflow-x-auto rounded-[20px] border border-line bg-surface/50">
                <table className="w-full min-w-[520px] text-sm">
                  <caption className="sr-only">Most recent indexed events</caption>
                  <thead>
                    <tr className="text-left">
                      {["Type", "Wallet", "Amount", "Time", "Tx"].map((h) => (
                        <th key={h} scope="col" className="label px-4 py-2.5 font-normal">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {p.recent.slice(0, 12).map((e) => (
                      <tr key={`${e.txHash}-${e.logIndex}`} className="border-t border-line/70">
                        <td className="px-4 py-2">
                          <span className={e.type === "buy" ? "text-accent" : e.type === "sell" ? "text-observed" : "text-fg-2"}>{e.type}</span>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">
                          {e.wallet ? (
                            <Link href={`/creator/${e.wallet}`} className="hover:underline">
                              {shortAddress(e.wallet)}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs tabular">{e.amount ? formatToken(e.amount, p.decimals ?? 18, 2) : "—"}</td>
                        <td className="px-4 py-2 font-mono text-xs text-fg-2">{timeAgo(e.timestamp)}</td>
                        <td className="px-4 py-2">
                          <a
                            href={explorerLink("tx", e.txHash, chain)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs text-fg-2 hover:text-fg"
                          >
                            {shortAddress(e.txHash, 4, 4)}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-fg-2">
                {p.coverage.status === "fully_covered" ? "No events observed since launch." : "Events are shown once this token's complete history is indexed."}
              </p>
            )}
          </div>
          <div>
            <h3 className="label mb-3">Largest holders</h3>
            {p.topHolders?.length ? (
              <ol className="rounded-[20px] border border-line bg-surface/50">
                {p.topHolders.map((h, i) => (
                  <li key={h.wallet} className="flex items-center gap-3 border-b border-line/70 px-4 py-2 last:border-b-0">
                    <span className="w-4 font-mono text-xs text-muted">{i + 1}</span>
                    <Link href={`/creator/${h.wallet}`} className="flex-1 font-mono text-xs hover:underline">
                      {shortAddress(h.wallet)}
                      {p.creator && h.wallet.toLowerCase() === p.creator.address.toLowerCase() ? <span className="ml-2 text-claimed">creator</span> : null}
                      {h.label ? <span className="ml-2 text-fg-2">{h.label}</span> : null}
                    </Link>
                    <span className="font-mono text-xs tabular">{h.pct !== null ? `${h.pct.toFixed(2)}%` : "—"}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-fg-2">Holder distribution unavailable.</p>
            )}
            <p className="mt-2 text-xs text-muted">Percent of total supply. Protocol contracts are labelled and excluded from the holder count.</p>
          </div>
        </div>
        {p.reconciliation?.length ? (
          <div className="mt-8">
            <h3 className="label mb-3">Indexer vs. explorer</h3>
            <div className="overflow-x-auto rounded-[20px] border border-line bg-surface/50">
              <table className="w-full min-w-[520px] text-sm">
                <caption className="sr-only">The same metric from VibeProof&apos;s index and from Blockscout</caption>
                <thead>
                  <tr className="text-left">
                    {["Metric", "VibeProof indexer", "Blockscout", "Why they can differ"].map((h) => (
                      <th key={h} scope="col" className="label px-4 py-2.5 font-normal">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.reconciliation.map((r) => (
                    <tr key={r.metric} className="border-t border-line/70 align-top">
                      <td className="px-4 py-2 capitalize">{r.metric}</td>
                      <td className="px-4 py-2 font-mono tabular">{r.indexer === null ? "Unavailable" : formatInt(r.indexer)}</td>
                      <td className="px-4 py-2 font-mono tabular">{r.explorer === null ? "Unavailable" : formatInt(r.explorer)}</td>
                      <td className="px-4 py-2 text-xs text-fg-2">{r.explanation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Section>

      {/* ── LAUNCH METADATA ────────────────────────────────────── */}
      {p.metadata ? (
        <Section id="metadata" title="Launch metadata" kicker="creator-supplied · integrity checked">
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
            <Card className="px-5">
              <Row label="Fetch" hint={p.metadata.normalizedUrl ?? p.metadata.uri}>
                <span className="font-mono text-[12px] text-fg-2">
                  {p.metadata.status === "ok"
                    ? `OK${p.metadata.gateway ? ` via ${p.metadata.gateway}` : ""}`
                    : p.metadata.status.replace(/_/g, " ").toUpperCase()}
                </span>
                <EvidenceButton metric="Launch metadata" value={p.metadata.status} evidence={p.metadata.evidence} note={p.metadata.error ?? undefined} />
              </Row>
              <Row label="Matches content ID" hint="sha256 of the bytes vs. the IPFS CID in the launch event">
                <span className="font-mono text-[12px]">{p.metadata.cidVerified === null ? "NOT CHECKABLE" : p.metadata.cidVerified ? "YES" : "NO"}</span>
              </Row>
              <Row label="Matches onchain digest" hint="keccak256 of the bytes vs. metadataDigest in the launch event">
                <span className="font-mono text-[12px]">{p.metadata.digestMatch === null ? "NO DIGEST ONCHAIN" : p.metadata.digestMatch ? "YES" : "NO"}</span>
              </Row>
              {(["website", "x", "telegram", "discord"] as const).map((k) =>
                p.metadata?.claims?.[k] ? (
                  <Row
                    key={k}
                    label={<span className="capitalize">{k === "x" ? "X" : k}</span>}
                    hint={
                      <a href={p.metadata.claims[k]!} target="_blank" rel="noopener noreferrer nofollow" className="break-all hover:text-fg-2">
                        {p.metadata.claims[k]}
                      </a>
                    }
                  >
                    {(() => {
                      const ch = p.metadata?.checks.find((c) => k === "website" && (c.type === "website" || c.type === "github"));
                      return ch ? (
                        <>
                          <StateBadge state={ch.state} />
                          <EvidenceButton metric={`${k} (from metadata)`} value={ch.summary} evidence={ch.evidence} />
                        </>
                      ) : (
                        <StateBadge state="creator_claimed" />
                      );
                    })()}
                  </Row>
                ) : null,
              )}
            </Card>
            <div className="space-y-4 text-sm text-fg-2">
              {p.metadata.claims?.description ? (
                <blockquote className="border-l border-claimed/40 pl-4">
                  <span className="label !text-claimed">Creator claim</span>
                  <p className="mt-1 break-words">{p.metadata.claims.description}</p>
                </blockquote>
              ) : null}
              <p className="text-xs leading-relaxed text-muted">
                Matching hashes prove these are the exact bytes the launch committed to. They do not make the content true: names, descriptions and links in
                metadata are claims by the creator.
              </p>
            </div>
          </div>
        </Section>
      ) : null}

      {/* ── STATEMENT LEDGER ───────────────────────────────────── */}
      <Section id="statements" title="Statement ledger" kicker="every claim, classified">
        <ul className="divide-y divide-line/70 rounded-[20px] border border-line bg-surface/50">
          {statements.map((s, i) => (
            <li key={i} className="grid grid-cols-[120px_1fr] items-start gap-4 px-5 py-3 text-sm md:grid-cols-[140px_1fr_200px]">
              <Pill tone={KIND_TONE[s.kind]} className="justify-self-start">
                {KIND_LABEL[s.kind]}
              </Pill>
              <span className="text-fg">{s.text}</span>
              <span className="col-start-2 text-xs text-fg-2 md:col-start-auto md:text-right">{s.source}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* ── PROVENANCE ─────────────────────────────────────────── */}
      <Section id="provenance" title="Provenance">
        <div className="grid gap-4 text-sm text-fg-2 md:grid-cols-3">
          <Prov k="Chain reads" v={`${p.chainName} (${p.chainId}), block #${Number(c.block).toLocaleString("en-US")}, ${formatUtc(c.observedAt)}`} />
          <Prov
            k="Indexer"
            v={
              p.indexer.indexedThrough
                ? `Transfer + curve events through block #${Number(p.indexer.indexedThrough).toLocaleString("en-US")}`
                : "No indexer data"
            }
          />
          <Prov k="Explorer" v="Blockscout v2 API: source verification, proxy metadata, fallback counters" />
          {p.launch ? <Prov k="Launch event" v={<Address value={p.launch.txHash} explorer="tx" chain={chain} />} /> : null}
          {p.launch ? <Prov k="Factory" v={<Address value={p.launch.factory} chain={chain} />} /> : null}
          {p.metadataUri ? <Prov k="Metadata URI (creator-provided)" v={<span className="break-all font-mono text-xs">{p.metadataUri}</span>} /> : null}
        </div>
        <p className="mt-6 text-xs text-muted">
          Every metric has a “Why am I seeing this?” control showing its source, block and method. VibeProof never converts unavailable data to zero.
        </p>
      </Section>
    </article>
  );
}

function Dim({ k, v, sub, href }: { k: string; v: string; sub: string; href: string }) {
  return (
    <a href={href} className="group bg-surface px-4 py-4 transition-colors hover:bg-surface-2 md:px-5">
      <dt className="label">{k}</dt>
      <dd className="mt-2 font-mono text-lg tabular text-fg">{v}</dd>
      <dd className="mt-0.5 text-xs text-fg-2">{sub}</dd>
    </a>
  );
}

function Fact({ k, v }: { k: string; v: string | number | boolean | null | undefined }) {
  return (
    <div>
      <dt className="label">{k}</dt>
      <dd className={`mt-1 font-mono text-lg tabular ${v === null || v === undefined ? "text-fg-2" : ""}`}>
        {v === null || v === undefined ? "Unavailable" : String(v)}
      </dd>
    </div>
  );
}

function Prov({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="rounded-[20px] border border-line bg-surface/50 p-4">
      <div className="label mb-2">{k}</div>
      <div className="text-fg">{v}</div>
    </div>
  );
}
