import type { ClaimKind } from "../verification/types";
import type { TokenPassport } from "./types";
import { shortAddress } from "../util/address";

export type Statement = { kind: ClaimKind; text: string; source: string };

/**
 * Turns a passport into an explicit ledger of statements, each classified as
 * FACT (cryptographically/bytecode-backed), OBSERVATION (measured by VibeProof),
 * CREATOR CLAIM (supplied by the creator), or INFERENCE. VibeProof makes no inferences,
 * and says so.
 */
export function buildStatements(p: TokenPassport): Statement[] {
  const out: Statement[] = [];
  const c = p.contract;
  const chk = (id: string) => c.checks.find((x) => x.id === id);

  out.push({ kind: "fact", text: `Contract bytecode exists at ${shortAddress(p.address)} on ${p.chainName}.`, source: "eth_getCode" });
  if (c.basics.symbol) out.push({ kind: "fact", text: `The contract reports symbol ${c.basics.symbol} and ${c.basics.decimals ?? "?"} decimals.`, source: "ERC-20 view calls" });
  if (c.sourceVerified === true) out.push({ kind: "fact", text: "Contract source is verified on the Robinhood Chain explorer.", source: "Blockscout" });
  else if (c.sourceVerified === false) out.push({ kind: "observation", text: "Contract source was not verified on the explorer at the time of the check.", source: "Blockscout" });
  if (p.launch) out.push({ kind: "fact", text: `A ${p.launch.launchpad === "vibe" ? "vibe/vibe" : p.launch.launchpad} factory (${p.launch.deploymentId}) emitted the launch event for this token in block ${Number(p.launch.blockNumber).toLocaleString("en-US")}.`, source: "Factory event log" });
  if (p.launch?.status === "graduated") out.push({ kind: "fact", text: "A Graduated event was emitted by this token's own bonding curve.", source: p.launch.graduatedTx ? `tx ${shortAddress(p.launch.graduatedTx, 6, 4)}` : "Curve event log" });
  else if (p.launch?.status === "curve_completed") out.push({ kind: "fact", text: "The bonding curve emitted CurveCompleted (target reached); no Graduated event has been observed yet.", source: "Curve event log" });
  if (c.owner) out.push({ kind: "fact", text: c.ownershipRenounced ? "owner() returns the zero address." : `owner() returns ${shortAddress(c.owner)}.`, source: "eth_call owner()" });
  const detected = c.checks.filter((x) => ["mint", "pause", "blacklist", "upgrade", "fees", "transfer_limits", "trading_toggle"].includes(x.id) && x.status === "detected");
  if (detected.length)
    out.push({ kind: c.sourceVerified ? "fact" : "observation", text: `Admin-capable functions detected: ${detected.map((d) => d.label.toLowerCase()).join(", ")}.`, source: chk("mint")?.evidence.method ?? "Selector scan" });
  else out.push({ kind: "observation", text: "No standard admin functions (mint, pause, blacklist, upgrade, fee or limit setters) were detected by selector scan.", source: "Selector scan (standard names only)" });

  if (p.creator) out.push({ kind: "observation", text: `The creator wallet launched ${p.creator.launchCount} token${p.creator.launchCount === 1 ? "" : "s"} indexed by VibeProof.`, source: "VibeProof indexer" });
  const h = p.activity.holders;
  if (h.value !== null) out.push({ kind: "observation", text: `${Number(h.value).toLocaleString("en-US")} wallets held a positive balance at the last indexed block${p.coverage?.status === "fully_covered" ? "" : " (explorer count; VibeProof's own history for this token is incomplete)"}.`, source: h.evidence.source });
  if (p.metadata?.status === "ok") {
    if (p.metadata.cidVerified) out.push({ kind: "fact", text: "The launch metadata fetched by VibeProof hashes to the content identifier (CID) named in the launch event.", source: "sha256 vs CID" });
    if (p.metadata.digestMatch === true) out.push({ kind: "fact", text: "keccak256 of the launch metadata equals the metadataDigest committed in the launch event.", source: "Launch event + metadata bytes" });
    if (p.metadata.digestMatch === false) out.push({ kind: "observation", text: "keccak256 of the fetched metadata does NOT equal the metadataDigest in the launch event.", source: "Launch event + metadata bytes" });
    const cl = p.metadata.claims;
    if (cl?.description) out.push({ kind: "creator_claim", text: `Launch metadata description: “${cl.description.slice(0, 280)}”`, source: "Launch metadata (creator-supplied)" });
    for (const [k, v] of [["Website", cl?.website], ["X", cl?.x], ["Telegram", cl?.telegram], ["Discord", cl?.discord]] as const) if (v) out.push({ kind: "creator_claim", text: `${k}: ${v}`, source: "Launch metadata (creator-supplied)" });
  }

  if (p.proof.description) out.push({ kind: "creator_claim", text: `“${p.proof.description}”`, source: "Creator submission" });
  for (const ch of p.proof.checks) {
    if (ch.state === "creator_claimed") out.push({ kind: "creator_claim", text: `${ch.type[0].toUpperCase()}${ch.type.slice(1)}: ${ch.url}`, source: "Creator submission" });
    else if (ch.state === "verified") out.push({ kind: "fact", text: `${ch.type[0].toUpperCase()}${ch.type.slice(1)} (${ch.url}) references this contract address.`, source: ch.evidence.source });
    else if (ch.state === "observed") {
      const commits = ch.facts.commits30d;
      out.push({ kind: "observation", text: ch.type === "github" && typeof commits === "number" ? `GitHub repository had ${commits} commit${commits === 1 ? "" : "s"} in the last 30 days.` : `${ch.type[0].toUpperCase()}${ch.type.slice(1)} was reachable (${ch.summary}).`, source: ch.evidence.source });
    }
  }
  out.push({ kind: "inference", text: "None provided. VibeProof does not score, rate or predict.", source: "—" });
  return out;
}
