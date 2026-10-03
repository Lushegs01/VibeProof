import { toEventSelector } from "viem";
import { getProvider } from "../lib/chain/provider";
import { getLogsAdaptive } from "../lib/chain/logs";
import { NETWORKS, type NetworkSlug } from "../lib/chain/networks";
import { launchpadAdapters } from "../lib/launchpads/registry";
import { discoverVibeDeployments } from "../lib/launchpads/vibe-discovery";
import { vibeDeployments } from "../lib/vibe/contracts";

/**
 * `npm run vibe:verify` — read-only check that the configured vibe/vibe deployments are current.
 *
 *  1. Re-read the public app bundle and list every deployment it declares.
 *  2. For each configured deployment, on its chain: bytecode present, and the factory emitted
 *     at least one decodable launch event in the most recent window that has any.
 *  3. Report deployments that are in the bundle but not configured (new) and configured but no
 *     longer in the bundle (stale). Exit code 1 if anything needs attention.
 *
 * It never sends transactions and never writes to the database.
 */
const appUrl = process.argv.find((a) => a.startsWith("--app="))?.split("=")[1] ?? "https://testnet.vibevibe.fun/";
let problems = 0;
const out = (o: unknown) => console.log(JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));

const discovered = await discoverVibeDeployments(appUrl).catch((e) => {
  problems++;
  return { appUrl, files: 0, bytes: 0, deployments: [], errors: [String(e)] };
});
out({ step: "bundle", appUrl, files: discovered.files, bytes: discovered.bytes, deployments: discovered.deployments, errors: discovered.errors.slice(0, 5) });

for (const slug of Object.keys(NETWORKS) as NetworkSlug[]) {
  const net = NETWORKS[slug];
  const provider = getProvider(slug);
  const configured = vibeDeployments(net.chainId);
  const adapter = launchpadAdapters(net.chainId)[0];
  let chainId: number | null = null;
  try {
    chainId = (await provider.getChainId?.()) ?? null;
  } catch (e) {
    problems++;
    out({ step: "rpc", network: slug, ok: false, error: String(e) });
    continue;
  }
  const head = await provider.getBlockNumber();
  out({ step: "rpc", network: slug, chainId, expected: net.chainId, ok: chainId === net.chainId, head });
  if (chainId !== net.chainId) problems++;

  for (const d of configured) {
    const code = await provider.getBytecode(d.factory);
    const events = adapter.getLaunchEvents(d);
    // Find the most recent launch event, scanning backwards in windows.
    let sample: { block: bigint; tx: string; decoded: boolean; token: string | null; creator: string | null } | null = null;
    const start = d.startBlock ?? head - 5_000_000n;
    for (let to = head; to >= start && !sample; to -= 2_000_000n) {
      const from = to - 1_999_999n > start ? to - 1_999_999n : start;
      const logs = await getLogsAdaptive(provider, { address: d.factory, events }, from, to);
      const last = logs[logs.length - 1];
      if (last) {
        const dec = adapter.decodeLaunch(last, d);
        sample = { block: last.blockNumber!, tx: last.transactionHash!, decoded: !!dec, token: dec?.token ?? null, creator: dec?.creator ?? null };
      }
    }
    const inBundle = discovered.deployments.some((x) => x.factory.toLowerCase() === d.factory.toLowerCase());
    const ok = !!code && code !== "0x" && !!sample?.decoded;
    if (!ok || (discovered.deployments.length && !inBundle)) problems++;
    out({
      step: "deployment",
      network: slug,
      id: d.id,
      factory: d.factory,
      provenance: d.provenance.source,
      bytecodeBytes: code ? (code.length - 2) / 2 : 0,
      launchTopics: events.map((e) => `${e.name} ${toEventSelector(e).slice(0, 10)}`),
      latestLaunch: sample,
      inCurrentBundle: discovered.deployments.length ? inBundle : "bundle unavailable",
      ok,
    });
  }
  for (const x of discovered.deployments.filter((x) => (x.chainId === null || x.chainId === net.chainId) && !configured.some((c) => c.factory.toLowerCase() === x.factory.toLowerCase()))) {
    const code = await provider.getBytecode(x.factory);
    if (code && code !== "0x") {
      problems++;
      out({ step: "new_deployment", network: slug, ...x, bytecodeBytes: (code.length - 2) / 2, action: "Present in the public bundle and onchain but NOT configured. Verify, then add it (VIBE_EXTRA_DEPLOYMENTS or src/lib/vibe/contracts.ts)." });
    }
  }
  if (!configured.length) out({ step: "no_deployments", network: slug, note: "No vibe/vibe deployment is configured for this network." });
}
out({ step: "summary", problems });
process.exit(problems ? 1 : 0);
