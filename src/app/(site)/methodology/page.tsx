import type { Metadata } from "next";
import { STATE_DESCRIPTION, STATE_LABEL, type VerificationState } from "@/lib/verification/types";
import { StateBadge } from "@/components/ui/state-badge";
import { vibeDeployments } from "@/lib/vibe/contracts";
import { activeNetwork } from "@/lib/chain/networks";
import { launchpadAdapters } from "@/lib/launchpads/registry";
import { Address } from "@/components/ui/address";
import { CREATOR_DEFINITIONS } from "@/lib/services/creator-service";
import { SORTS } from "@/lib/services/discover-service";

export const metadata: Metadata = { title: "Methodology" };

const SOURCE_LABEL: Record<string, string> = {
  official_documentation: "Official documentation",
  "public_app_config+onchain": "Public vibe/vibe app config, confirmed onchain",
  onchain_only: "Onchain observation only",
  unknown: "Unverified (operator-supplied)",
};

export default function Methodology() {
  const states: VerificationState[] = ["verified", "observed", "creator_claimed", "not_found", "unavailable"];
  const net = activeNetwork();
  const deployments = vibeDeployments(net.chainId);
  const adapter = launchpadAdapters(net.chainId)[0];
  return (
    <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6 md:pt-14">
      <p className="label">Methodology</p>
      <h1 className="text-gradient mt-3 text-4xl font-medium leading-tight md:text-5xl">How VibeProof knows what it shows</h1>
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
          <p>A token is treated as a vibe/vibe launch on {net.name} only if one of these factories emitted its launch event. vibe/vibe publishes no address list: the addresses were read from the public vibe/vibe app configuration and confirmed onchain (bytecode present, factory creation transaction found, emitted event topics match). Their source is not verified on the explorer.</p>
          {deployments.length ? (
            <ul className="mt-4 space-y-3">
              {deployments.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 font-mono text-sm">
                  <span className="w-24 text-fg">{d.id}</span>
                  <Address value={d.factory} short={false} />
                  <span className="text-xs">events {adapter.getLaunchEvents(d).map((e) => e.name).join(", ")}</span>
                  <span className="w-full text-xs font-sans text-muted">{SOURCE_LABEL[d.provenance.source]} · checked {d.provenance.verifiedAt ?? "never"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-fg">No vibe/vibe deployment is known on {net.name}. VibeProof does not guess factory addresses; launches on this network are not indexed until a verified deployment is configured.</p>
          )}
        </section>
        <section>
          <h2 className="mb-4 text-lg font-medium text-fg">Contract analysis</h2>
          <p>Bytecode is read at a specific block. Function capabilities (mint, pause, blacklist, upgrade, fee and limit setters) are detected by matching 4-byte selectors in the runtime bytecode, or against the verified ABI when the explorer has source. Selector matching only recognises standard names; a custom-named admin function will not be detected. Proxies are detected via EIP-1967 storage slots, EIP-1167 minimal-proxy bytecode, and explorer metadata. For a beacon proxy, the beacon contract is asked for its implementation() and that address is analysed (the beacon itself is never treated as the implementation).</p>
        </section>
        <section>
          <h2 className="mb-4 text-lg font-medium text-fg">Activity</h2>
          <p>The indexer reads factory launch events, every ERC-20 Transfer of indexed tokens, and bonding-curve buy, sell, CurveCompleted and Graduated events emitted by each token's own curve. Holder counts are exact net balances above zero, excluding the zero and dead addresses, the token contract itself, its bonding curve and the launchpad's protocol contracts. Volume is summed only for ETH-quoted curves. Snapshots are stored every ten minutes per active token and power “What changed”.</p>
          <p className="mt-3">Counters are shown only when a token's complete history from its launch block is indexed (<em>fully covered</em>). While history is queued (<em>partial</em>), being processed (<em>indexing</em>) or failed (<em>error</em>), counters are Unavailable and explorer counts are shown with their source instead. Historical event times come from block headers; for large backfills they are interpolated between headers at most 500 blocks apart and marked as such.</p>
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
          <p>Launch metadata (the JSON at the launch event's metadata URI) is fetched over IPFS gateways or HTTPS by the same sandboxed client. Its bytes are checked against the IPFS content identifier and, where the launch event commits to one, its metadataDigest. Matching hashes prove the bytes are the ones committed to, not that what they say is true: names, descriptions and social links in metadata are creator claims.</p>
          <p className="mt-3">Only the launch creator (or a non-Vibe token's current owner) can submit links, after signing in with their wallet. Websites and demos are fetched from a sandboxed client that refuses private and internal network addresses. A site is <em>observed</em> if it is reachable, and <em>verified</em> if the page contains the token's contract address. GitHub repositories are read from the GitHub API; a README that contains the contract address upgrades the state to verified. Social links are recorded as creator claims only.</p>
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
