import type { Metadata } from "next";
import { STATE_DESCRIPTION, STATE_LABEL, type VerificationState } from "@/lib/verification/types";
import { StateBadge } from "@/components/ui/state-badge";
import { VIBE_DEPLOYMENTS } from "@/lib/vibe/contracts";
import { Address } from "@/components/ui/address";
import { CREATOR_DEFINITIONS } from "@/lib/services/creator-service";
import { SORTS } from "@/lib/services/discover-service";

export const metadata: Metadata = { title: "Methodology" };

export default function Methodology() {
  const states: VerificationState[] = ["verified", "observed", "creator_claimed", "not_found", "unavailable"];
  return (
    <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6 md:pt-14">
      <p className="label">Methodology</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">How VibeProof knows what it shows</h1>
      <div className="mt-10 space-y-12 text-[15px] leading-relaxed text-fg-2">
        <section>
          <h2 className="mb-4 text-lg font-medium text-fg">Verification states</h2>
          <ul className="space-y-3">
            {states.map((s) => (
              <li key={s} className="grid grid-cols-[150px_1fr] items-start gap-4">
                <StateBadge state={s} />
                <span>
                  <span className="sr-only">{STATE_LABEL[s]}: </span>
                  {STATE_DESCRIPTION[s]}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="mb-4 text-lg font-medium text-fg">Which contracts count as vibe/vibe</h2>
          <p>A token is treated as a vibe/vibe launch only if one of these factories emitted its launch event. Addresses were read from the official vibe/vibe app and confirmed onchain (bytecode present, event topics match). Their source is not verified on the explorer.</p>
          <ul className="mt-4 space-y-2">
            {VIBE_DEPLOYMENTS.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 font-mono text-sm">
                <span className="w-24 text-fg">{d.id}</span>
                <Address value={d.factory} short={false} />
                <span className="text-xs">event {d.launchEvent}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="mb-4 text-lg font-medium text-fg">Contract analysis</h2>
          <p>Bytecode is read at a specific block. Function capabilities (mint, pause, blacklist, upgrade, fee and limit setters) are detected by matching 4-byte selectors in the runtime bytecode, or against the verified ABI when the explorer has source. Selector matching only recognises standard names; a custom-named admin function will not be detected. Proxies are detected via EIP-1967 storage slots, EIP-1167 minimal-proxy bytecode, and explorer metadata. When a proxy is found, its implementation is analysed.</p>
        </section>
        <section>
          <h2 className="mb-4 text-lg font-medium text-fg">Activity</h2>
          <p>The indexer reads factory launch events, every ERC-20 Transfer of indexed tokens, and bonding-curve buy/sell events. Holder counts are net balances above zero, excluding the zero address, the dead address, and the token's own bonding curve. Volume is summed only for ETH-paired curves. Snapshots are stored every ten minutes per active token and power “What changed”.</p>
        </section>
        <section>
          <h2 className="mb-4 text-lg font-medium text-fg">Creator history</h2>
          <dl className="space-y-2">
            {Object.entries(CREATOR_DEFINITIONS).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[110px_1fr] gap-4">
                <dt className="capitalize text-fg">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h2 className="mb-4 text-lg font-medium text-fg">Product proof</h2>
          <p>Only the launch creator (or a non-Vibe token's current owner) can submit links, after signing in with their wallet. Websites and demos are fetched from a sandboxed client that refuses private and internal network addresses. A site is <em>observed</em> if it is reachable, and <em>verified</em> if the page contains the token's contract address. GitHub repositories are read from the GitHub API; a README that contains the contract address upgrades the state to verified. Social links are recorded as creator claims only.</p>
        </section>
        <section>
          <h2 className="mb-4 text-lg font-medium text-fg">Sorting</h2>
          <dl className="space-y-2">
            {Object.values(SORTS).map((s) => (
              <div key={s.label} className="grid grid-cols-[180px_1fr] gap-4">
                <dt className="text-fg">{s.label}</dt>
                <dd>{s.explain}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h2 className="mb-4 text-lg font-medium text-fg">What VibeProof never does</h2>
          <p>It does not produce a trust score, label a wallet or project as safe or unsafe, infer common ownership between wallets, predict prices, or recommend buying or selling anything.</p>
        </section>
      </div>
    </div>
  );
}
