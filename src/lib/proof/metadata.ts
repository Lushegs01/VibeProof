import { keccak256, toBytes } from "viem";
import { z } from "zod";

const optUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => u.startsWith("https://"), "Must be an https:// URL")
  .optional()
  .or(z.literal("").transform(() => undefined));

export const ProofSubmissionSchema = z.object({
  token: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  websiteUrl: optUrl,
  githubUrl: optUrl.refine((u) => !u || /^https:\/\/(www\.)?github\.com\/[^/]+\/[^/]+/.test(u), "Must be a github.com/{owner}/{repo} URL"),
  demoUrl: optUrl,
  docsUrl: optUrl,
  twitterUrl: optUrl.refine((u) => !u || /^https:\/\/(www\.)?(x|twitter)\.com\//.test(u), "Must be an x.com or twitter.com URL"),
  discordUrl: optUrl.refine((u) => !u || /^https:\/\/(www\.)?(discord\.gg|discord\.com)\//.test(u), "Must be a discord.gg or discord.com URL"),
  description: z.string().trim().max(500).optional(),
});
export type ProofSubmission = z.infer<typeof ProofSubmissionSchema>;

/**
 * Canonical proof metadata: sorted keys, lowercase addresses, no undefined.
 * The keccak256 of this exact string is what gets anchored in VibeProofRegistry.
 */
export function canonicalProofMetadata(p: ProofSubmission & { chainId: number; creator: string }) {
  const obj: Record<string, string | number> = {
    chainId: p.chainId,
    creator: p.creator.toLowerCase(),
    schema: "vibeproof.proof.v1",
    token: p.token.toLowerCase(),
  };
  for (const k of ["websiteUrl", "githubUrl", "demoUrl", "docsUrl", "twitterUrl", "discordUrl", "description"] as const) {
    const v = p[k];
    if (v) obj[k] = v;
  }
  const sorted = Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
  return JSON.stringify(sorted);
}

export function proofMetadataHash(p: Parameters<typeof canonicalProofMetadata>[0]) {
  return keccak256(toBytes(canonicalProofMetadata(p)));
}
