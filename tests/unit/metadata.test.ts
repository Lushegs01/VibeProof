import { describe, expect, it } from "vitest";
import { canonicalProofMetadata, proofMetadataHash, ProofSubmissionSchema } from "@/lib/proof/metadata";

const base = { chainId: 46630, creator: "0xAbC0000000000000000000000000000000000001", token: "0xDEF0000000000000000000000000000000000002" };

describe("proof metadata hashing", () => {
  it("is deterministic and independent of key order / address case", () => {
    const a = proofMetadataHash({ ...base, websiteUrl: "https://a.xyz", githubUrl: "https://github.com/a/b" });
    const b = proofMetadataHash({ githubUrl: "https://github.com/a/b", websiteUrl: "https://a.xyz", chainId: 46630, creator: base.creator.toLowerCase(), token: base.token.toLowerCase() });
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("changes when any field changes", () => {
    const a = proofMetadataHash({ ...base, websiteUrl: "https://a.xyz" });
    expect(proofMetadataHash({ ...base, websiteUrl: "https://b.xyz" })).not.toBe(a);
    expect(proofMetadataHash({ ...base, chainId: 1, websiteUrl: "https://a.xyz" })).not.toBe(a);
  });
  it("omits empty fields from the canonical form", () => {
    expect(canonicalProofMetadata({ ...base, websiteUrl: undefined, description: "" as never })).toBe(
      '{"chainId":46630,"creator":"0xabc0000000000000000000000000000000000001","schema":"vibeproof.proof.v1","token":"0xdef0000000000000000000000000000000000002"}',
    );
  });
});

describe("proof submission schema", () => {
  const token = "0x" + "a".repeat(40);
  it("accepts valid https links", () => {
    expect(ProofSubmissionSchema.safeParse({ token, websiteUrl: "https://x.xyz", githubUrl: "https://github.com/o/r", twitterUrl: "https://x.com/o" }).success).toBe(true);
  });
  it("rejects non-https, wrong hosts and bad tokens", () => {
    expect(ProofSubmissionSchema.safeParse({ token, websiteUrl: "http://x.xyz" }).success).toBe(false);
    expect(ProofSubmissionSchema.safeParse({ token, githubUrl: "https://gitlab.com/o/r" }).success).toBe(false);
    expect(ProofSubmissionSchema.safeParse({ token, discordUrl: "https://evil.com/discord.gg/x" }).success).toBe(false);
    expect(ProofSubmissionSchema.safeParse({ token: "0x123" }).success).toBe(false);
  });
  it("treats empty strings as absent", () => {
    const r = ProofSubmissionSchema.parse({ token, websiteUrl: "" });
    expect(r.websiteUrl).toBeUndefined();
  });
});
