import Link from "next/link";
import { ArrowRight, Boxes, FileSearch, Ghost, ScrollText, ShieldCheck, Users } from "lucide-react";
import { discover, activityFeed, ecosystemStats } from "@/lib/services/discover-service";
import { getActivitySeries } from "@/lib/services/token-service";
import { isDemoMode } from "@/lib/demo/mode";
import { formatInt, timeAgo } from "@/lib/util/format";
import { getAddress } from "viem";
import { FaqList, OpenSearchButton, type Faq } from "@/components/landing/client";
import { Cobweb, HauntBadge, HeroDecor } from "@/components/halloween/decor";
import { activeNetwork, tokenPath, type NetworkSlug } from "@/lib/chain/networks";

const NET = activeNetwork();

export const revalidate = 30;

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

const STEPS = [
  { n: "01", t: "Search a launch", b: "Paste a token address, $SYMBOL, creator wallet or transaction hash." },
  { n: "02", t: "Read the passport", b: "Contract, creator, product and activity, each with its source." },
  { n: "03", t: "Share the evidence", b: "Send a public passport link that shows facts, not verdicts." },
];

const FAQ: Faq[] = [
  {
    q: "What is VibeProof?",
    a: "VibeProof is the verification layer for tokens launched through vibe/vibe on Robinhood Chain. Each launch gets a Launch Passport that combines what the contract can do, what its creator has launched before, whether a real product stands behind it, and what is happening onchain.",
  },
  {
    q: "Is a passport a safety rating?",
    a: "No. VibeProof never labels a token safe, legit or a scam, and there is no trust score. It shows evidence (facts, observations and creator claims), each labelled, so you can draw your own conclusions.",
  },
  {
    q: "Where does the data come from?",
    a: `Contract reads and event logs come from ${NET.name} itself (the canonical source), source verification from the Blockscout explorer, and product checks from the linked website and the GitHub API. Every metric has a “Why am I seeing this?” panel naming its source, block and method.`,
  },
  {
    q: "Why does a metric say “Unavailable”?",
    a: "Because the check could not be completed, for example when the explorer timed out or a launch's history is still being indexed. VibeProof never shows a failed check as zero.",
  },
  {
    q: "Who can submit project proof?",
    a: "Only the wallet that launched the token, verified by signing in with Ethereum. Websites and repositories are then checked automatically; social links are recorded as creator claims.",
  },
  {
    q: "Which launches are covered?",
    a: NET.testnet
      ? `Every launch from the vibe/vibe v5 and v6 factories on ${NET.name}, discovered from the factories' own events. Testnet assets have no value.`
      : `Every launch from verified vibe/vibe factories on ${NET.name}. If none is configured yet, nothing is listed: VibeProof does not guess factory addresses.`,
  },
];

export default async function Home() {
  const demo = isDemoMode();
  const [stats, { items }, feed] = await Promise.all([
    safe(() => ecosystemStats(), null),
    safe(() => discover("active", "all", 6), { items: [], cached: false, excludedIncomplete: null }),
    safe(() => activityFeed(8), []),
  ]);
  const featured = items[0] ?? null;
  const series = featured ? await safe(() => getActivitySeries(getAddress(featured.address), 2), null) : null;

  return (
    <>
      {/* ── HERO ───────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden">
        <div className="light-lines absolute inset-0 -z-10" aria-hidden />
        <HeroDecor />
        <div className="mx-auto max-w-6xl px-4 pb-[52vw] pt-14 text-center md:px-6 md:pb-[30vw] md:pt-20 lg:pb-[22rem]">
          <HauntBadge />
          <h1 className="mx-auto mt-7 max-w-5xl text-[2.6rem] font-medium leading-[1.08] sm:text-6xl md:mt-9 md:text-7xl lg:text-[5.4rem]">
            <span className="text-gradient">Know </span>
            <span className="select-box text-ghost">
              what
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className="text-gradient"> was</span> <br />
            <span className="text-gradient-soft">launched on</span> <br />
            <span className="text-fg">Robinhood Chain</span>
          </h1>
          <p className="mx-auto mt-7 max-w-xl text-[15px] leading-relaxed text-fg-2 md:text-base">
            The verification layer for vibe/vibe launches. Contract data, creator history, product proof and onchain activity, all in one passport.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <OpenSearchButton className="btn btn-primary h-12 px-7 text-[15px]">Search a launch</OpenSearchButton>
            <Link href="/discover" className="btn btn-outline h-12 px-7 text-[15px]">
              Browse launches
            </Link>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[60%]" aria-hidden>
          <div className="horizon top-[42%] md:top-[45%]" />
          <div className="fog absolute inset-x-[-10%] top-[22%] h-[45%]" />
        </div>
        <div className="relative pb-8 pt-4 md:absolute md:inset-x-0 md:bottom-0 md:bg-gradient-to-t md:from-bg md:via-bg/80 md:to-transparent md:pt-16">
          <p className="text-center text-sm text-fg-2">{demo ? "Demo data · deterministic fixtures" : `Indexed directly from ${NET.name}`}</p>
          <dl className="mx-auto mt-5 grid max-w-5xl grid-cols-2 gap-y-5 px-4 text-center sm:grid-cols-4">
            {[
              ["Launches indexed", stats ? formatInt(stats.launches) : "Unavailable"],
              ["Creators observed", stats ? formatInt(stats.creators) : "Unavailable"],
              ["Graduated", stats ? formatInt(stats.graduated) : "Unavailable"],
              ["Trust scores issued", "0"],
            ].map(([k, v]) => (
              <div key={k}>
                <dd className="font-display text-xl text-ice md:text-2xl">{v}</dd>
                <dt className="mt-1 text-xs text-fg-2">{k}</dt>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── PROCESS ────────────────────────────────────────── */}
      <section aria-labelledby="process-title" className="mx-auto max-w-6xl px-4 pt-28 md:px-6">
        <h2 id="process-title" className="text-gradient text-center text-4xl font-medium md:text-6xl">
          Step-by-step clarity
        </h2>
        <p className="mx-auto mt-5 max-w-md text-center text-[15px] text-fg-2">
          From a contract address to a shareable, evidence-backed passport in under a minute.
        </p>
        <div className="relative mt-16 rounded-[24px] bg-gradient-to-b from-transparent via-witch/20 to-accent-deep p-0 pb-10 md:px-8">
          <ol className="grid gap-5 md:grid-cols-3">
            {STEPS.map((s) => (
              <li
                key={s.n}
                className="rounded-[20px] border border-accent/20 bg-[linear-gradient(180deg,#22102a,#120919)] p-6 pb-14 shadow-[inset_0_1px_0_#ffffff0f]"
              >
                <span className="text-gradient font-display text-5xl font-medium md:text-6xl" aria-hidden>
                  {s.n}
                </span>
                <h3 className="mt-6 text-2xl font-medium text-fg">{s.t}</h3>
                <p className="mt-3 text-sm leading-relaxed text-fg-2">{s.b}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── FEATURES (bento) ───────────────────────────────── */}
      <section aria-labelledby="features-title" className="mx-auto max-w-6xl px-4 pt-32 md:px-6">
        <h2 id="features-title" className="mx-auto max-w-4xl text-center text-4xl font-medium leading-[1.12] md:text-6xl">
          <span className="text-gradient">Four layers of evidence,</span> <span className="text-gradient-soft">one passport</span>
        </h2>
        <p className="mx-auto mt-5 max-w-md text-center text-[15px] text-fg-2">
          Every statement is labelled as a fact, an observation or a creator claim, with its source one click away.
        </p>
        <div className="mt-16 grid gap-5 md:grid-cols-2">
          <Feature
            icon={<ShieldCheck />}
            title="Know what the code can do"
            body="Source verification, proxies, owner, and mint, pause, blacklist or upgrade functions, read from bytecode at a specific block."
          />
          <Feature
            icon={<Users />}
            title="Know what the deployer has done"
            body="Every launch from the same wallet, with status and activity. Observed history, never a reputation label."
          />
          <Feature
            icon={<FileSearch />}
            title="See what stands behind the token"
            body="Website, GitHub and demo checked for reachability, activity and a link back to the contract address."
          />
          <Feature
            icon={<ScrollText />}
            title="Nothing presented as zero"
            body="If a check fails it says Unavailable. Facts, observations and creator claims are always labelled apart."
          />
          <div className="glass-strong relative col-span-full overflow-hidden p-8 md:min-h-[380px]">
            <Cobweb className="right-0 top-0 w-28 -scale-x-100 opacity-80 md:w-40" />
            <div className="relative z-10 max-w-sm">
              <Boxes className="size-11 text-accent" strokeWidth={1.4} aria-hidden />
              <h3 className="mt-16 text-3xl font-medium leading-tight text-fg md:text-[2.1rem]">Watch the ecosystem move</h3>
              <p className="mt-4 text-sm leading-relaxed text-fg-2">Launches, creator trades on the bonding curve and graduations, indexed as they happen.</p>
              <Link href="/activity" className="btn btn-outline mt-7 h-10 px-5 text-sm">
                Open activity feed <ArrowRight className="size-4" />
              </Link>
            </div>
            <div
              className="dot-grid absolute inset-y-0 right-0 hidden w-[62%] [mask-image:radial-gradient(ellipse_at_center,#000_45%,transparent_75%)] md:block"
              aria-hidden
            />
            <div
              className="absolute inset-y-0 right-0 hidden w-[62%] bg-[radial-gradient(ellipse_at_70%_30%,#c24e0040,transparent_60%)] md:block"
              aria-hidden
            />
            <ul className="relative mt-10 grid gap-3 md:absolute md:inset-y-10 md:right-10 md:mt-0 md:block md:w-[52%]" aria-label="Recent activity">
              {feed.slice(0, 5).map((f, i) => (
                <li key={f.id} className="md:absolute" style={PIN_POS[i]}>
                  <Link
                    href={tokenPath(f.token, f.chain as NetworkSlug)}
                    className="flex items-center gap-2.5 whitespace-nowrap rounded-full border border-accent/25 bg-[#0c0611cc] py-1.5 pl-1.5 pr-4 text-xs shadow-[0_8px_30px_-10px_#ff7a1a88] backdrop-blur transition-colors hover:border-accent"
                  >
                    <span className="flex size-7 items-center justify-center rounded-full bg-[linear-gradient(135deg,#f6e3cb,#ff8a1f,#c24e00)] font-display text-[10px] text-[#1c0800]">
                      {(f.symbol ?? "?").slice(0, 2)}
                    </span>
                    <span className="font-medium text-fg">{f.symbol ? `$${f.symbol}` : "Token"}</span>
                    <span className="hidden text-fg-2 lg:inline">{PIN_LABEL[f.kind] ?? f.kind}</span>
                    <span className="text-muted">{timeAgo(f.at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── SHOWCASE (split) ───────────────────────────────── */}
      <section aria-labelledby="showcase-title" className="mx-auto max-w-6xl px-4 pt-32 md:px-6">
        <h2 id="showcase-title" className="mx-auto max-w-4xl text-center text-4xl font-medium leading-[1.12] md:text-6xl">
          <span className="text-gradient">Prove your project</span> <span className="text-gradient-soft">is real, no code required</span>
        </h2>
        <p className="mx-auto mt-5 max-w-lg text-center text-[15px] text-fg-2">
          Link your website, repository and demo. VibeProof checks what it can independently observe and labels the rest as your claim.
        </p>
        <div className="mt-16 grid items-center gap-12 md:grid-cols-2">
          <div className="rounded-[26px] border border-accent/25 p-3">
            <div className="relative overflow-hidden rounded-[20px] bg-[linear-gradient(160deg,#0f0614_0%,#4a1a3e_52%,#ff8a1f_100%)] px-6 py-10 md:px-12">
              {featured ? (
                <div className="mx-auto max-w-xs space-y-4">
                  <Link
                    href={tokenPath(featured.address, featured.chain as NetworkSlug)}
                    className="block rounded-2xl bg-[#fff8ef] p-4 text-[#1f0f14] shadow-xl transition-transform hover:-translate-y-0.5"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex size-9 items-center justify-center rounded-full bg-[#fbe6cf] font-display text-[11px] text-[#a33f00]">
                        {(featured.symbol ?? "?").slice(0, 2)}
                      </span>
                      <div>
                        <div className="text-[11px] text-[#7d5d55]">{demo ? "Demo passport" : "Live passport"}</div>
                        <div className="font-display text-lg leading-tight">{featured.symbol ? `$${featured.symbol}` : "Token"}</div>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-[11px] text-[#7d5d55]">
                      <div>
                        Holders
                        <div className="font-display text-base text-[#1f0f14]">{featured.holders === null ? "—" : formatInt(featured.holders)}</div>
                      </div>
                      <div>
                        Transfers
                        <div className="font-display text-base text-[#1f0f14]">{featured.transactions === null ? "—" : formatInt(featured.transactions)}</div>
                      </div>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#fbe6cf]">
                      <div className="h-full rounded-full bg-[#ff8a1f]" style={{ width: featured.proofSubmitted ? "100%" : "33%" }} />
                    </div>
                    <div className="mt-1.5 flex justify-between text-[10px] text-[#7d5d55]">
                      <span>{featured.proofSubmitted ? "Project proof submitted" : "Project proof not submitted"}</span>
                      <span>{timeAgo(featured.lastActivityAt)}</span>
                    </div>
                  </Link>
                  <div className="rounded-2xl bg-[#fff8ef] p-4 text-[#1f0f14] shadow-xl">
                    <div className="text-sm font-medium">Onchain activity</div>
                    <div className="text-[10px] text-[#7d5d55]">Events per hour · last 48h · indexed</div>
                    <MiniLine points={series?.map((p) => p.transfers + p.buys + p.sells) ?? []} />
                  </div>
                </div>
              ) : (
                <p className="text-center text-sm text-ice">Live examples appear once the indexer has data.</p>
              )}
            </div>
          </div>
          <div>
            <h3 className="text-3xl font-medium text-fg md:text-4xl">Create a Passport</h3>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-fg-2">
              Sign in with the wallet that launched your token, add your links, and get a public passport that anyone can verify for themselves.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/submit" className="btn btn-outline h-11 px-6">
                Submit proof
              </Link>
              <Link href="/methodology" className="btn btn-ghost h-11 px-2">
                How checks work <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────── */}
      <section aria-labelledby="faq-title" className="mx-auto max-w-5xl px-4 pt-32 md:px-6">
        <h2 id="faq-title" className="mx-auto max-w-3xl text-center text-4xl font-medium leading-[1.12] md:text-6xl">
          <span className="text-gradient">Answering your</span> <span className="text-gradient-soft">most haunting questions</span>
        </h2>
        <p className="mt-5 text-center text-[15px] text-fg-2">Have questions? Start here.</p>
        <div className="mt-10">
          <FaqList items={FAQ} />
        </div>
        <div className="mt-20 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full border border-accent/30 bg-[radial-gradient(circle_at_30%_30%,#5a2a52,#0c0611)]">
            <Ghost className="size-6 text-ice" aria-hidden />
          </div>
          <h3 className="mt-6 font-sans text-3xl font-medium tracking-tight text-fg">Still have questions?</h3>
          <p className="mx-auto mt-3 max-w-md text-fg-2">The methodology explains every check, state and data source in detail.</p>
          <Link href="/methodology" className="btn btn-primary mt-7 h-11 px-6">
            Read the methodology
          </Link>
        </div>
      </section>
    </>
  );
}

const PIN_LABEL: Record<string, string> = { launch: "New launch", creator_activity: "Creator trade", graduation: "Graduated", proof: "Proof submitted" };

const PIN_POS: React.CSSProperties[] = [
  { left: "6%", top: "6%" },
  { left: "44%", top: "20%" },
  { left: "14%", top: "44%" },
  { left: "52%", top: "58%" },
  { left: "22%", top: "80%" },
];

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="glass p-8">
      <span className="block text-accent [&>svg]:size-11 [&>svg]:stroke-[1.4]" aria-hidden>
        {icon}
      </span>
      <h3 className="mt-14 text-2xl font-medium leading-snug text-fg md:text-[1.7rem]">{title}</h3>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-fg-2">{body}</p>
    </div>
  );
}

function MiniLine({ points }: { points: number[] }) {
  if (points.length < 2) return <div className="mt-4 flex h-24 items-center justify-center text-[11px] text-[#7d5d55]">Not enough indexed history yet</div>;
  const max = Math.max(1, ...points);
  const w = 260;
  const h = 96;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${((i / (points.length - 1)) * w).toFixed(1)},${(h - 6 - (p / max) * (h - 16)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 h-24 w-full" role="img" aria-label={`Activity: peak ${max} events per hour`}>
      {[0.25, 0.5, 0.75].map((y) => (
        <line key={y} x1="0" x2={w} y1={h * y} y2={h * y} stroke="#f3e2d2" strokeWidth="1" />
      ))}
      <path d={`${d} L${w},${h} L0,${h} Z`} fill="#ff8a1f24" />
      <path d={d} fill="none" stroke="#c24e00" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
