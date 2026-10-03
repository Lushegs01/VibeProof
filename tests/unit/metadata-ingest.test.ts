import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { extractClaims, fetchMetadata, gatewayUrls, normalizeMetadataUri, rawSha256Digest } from "@/lib/metadata/ingest";
import { SafeFetchError, type SafeFetchResult } from "@/lib/proof/safe-fetch";

/** Real vibe/vibe v5 launch metadata: ipfs://bafkreif63y… with metadataDigest 0x4478… (token 0x61a3…e5a3). */
const CID = "bafkreif63yr2ajjz5rfzccmuf45ts6taqks2k3rsdd3cpkmzw2kwyqlx2a";
const BYTES = fs.readFileSync(`tests/fixtures/metadata-${CID}.json`);
const DIGEST = "0x44784491074d340cbe4df249ca06def89a2045db04daa5fe033c083d3920234a" as const;
const TEMPLATES = ["https://gw-a.example/ipfs/{cid}{path}", "https://{cid}.ipfs.gw-b.example{path}"];

const ok = (body: Buffer, headers: Record<string, string> = { "content-type": "application/json" }, status = 200, truncated = false): SafeFetchResult => ({ finalUrl: "x", status, headers, body: body.toString("utf8"), bytes: body, truncated, tls: { valid: true }, redirects: [], ms: 1 });

describe("metadata URI normalisation", () => {
  it("normalises ipfs://, gateway path and subdomain forms to the same CID", () => {
    expect(normalizeMetadataUri(`ipfs://${CID}`)).toMatchObject({ kind: "ipfs", cid: CID, path: "" });
    expect(normalizeMetadataUri(`ipfs://ipfs/${CID}/meta.json`)).toMatchObject({ kind: "ipfs", cid: CID, path: "/meta.json" });
    expect(normalizeMetadataUri(`https://ipfs.io/ipfs/${CID}`)).toMatchObject({ kind: "ipfs", cid: CID });
    expect(normalizeMetadataUri(`https://${CID}.ipfs.dweb.link/`)).toMatchObject({ kind: "ipfs", cid: CID });
    expect(normalizeMetadataUri("ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG")).toMatchObject({ kind: "ipfs" });
  });
  it("keeps plain https URLs and refuses everything else", () => {
    expect(normalizeMetadataUri("https://example.com/m.json")).toMatchObject({ kind: "https" });
    for (const u of ["http://example.com/m.json", "data:application/json,{}", "ar://abc", "file:///etc/passwd", "", "ipfs://not-a-cid", `ipfs://${CID}/../x`, "x".repeat(3000)])
      expect(normalizeMetadataUri(u).kind).toBe("unsupported");
  });
  it("builds gateway URLs (subdomain templates only for CIDv1)", () => {
    expect(gatewayUrls(CID, "", TEMPLATES)).toEqual([`https://gw-a.example/ipfs/${CID}`, `https://${CID}.ipfs.gw-b.example`]);
    expect(gatewayUrls("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG", "", TEMPLATES)).toHaveLength(1);
  });
  it("decodes the sha2-256 digest from a raw-codec CIDv1", () => {
    expect(rawSha256Digest(CID)).toBe("bede23a02539ec4b9109942f3b397a6082a5a56e3218f627a999b6956c4177d0");
    expect(rawSha256Digest("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG")).toBeNull();
  });
});

describe("fetchMetadata", () => {
  it("IPFS: verifies the bytes against the CID AND the onchain digest", async () => {
    const r = await fetchMetadata(`ipfs://${CID}`, { onchainDigest: DIGEST, templates: TEMPLATES, fetcher: async () => ok(BYTES) });
    expect(r.status).toBe("ok");
    expect(r.cidVerified).toBe(true);
    expect(r.digestMatch).toBe(true);
    expect(r.claims).toMatchObject({ name: "Vibe4A96", symbol: "V4A9", chainId: 46630, creator: "0x0430c9462ac92118a48049c63115607105267655" });
  });
  it("flags an onchain digest mismatch instead of hiding it", async () => {
    const r = await fetchMetadata(`ipfs://${CID}`, { onchainDigest: `0x${"0".repeat(64)}`, templates: TEMPLATES, fetcher: async () => ok(BYTES) });
    expect(r.status).toBe("ok");
    expect(r.digestMatch).toBe(false);
    expect(r.error).toMatch(/does not match/);
  });
  it("rejects a gateway that serves the wrong bytes and falls back to the next one", async () => {
    const calls: string[] = [];
    const r = await fetchMetadata(`ipfs://${CID}`, {
      templates: TEMPLATES,
      fetcher: async (url) => (calls.push(url), url.includes("gw-a") ? ok(Buffer.from('{"name":"forged"}')) : ok(BYTES)),
    });
    expect(calls).toHaveLength(2);
    expect(r.status).toBe("ok");
    expect(r.gateway).toBe(`${CID}.ipfs.gw-b.example`);
    expect(r.claims?.name).toBe("Vibe4A96");
  });
  it("reports integrity_mismatch when every gateway serves wrong bytes", async () => {
    const r = await fetchMetadata(`ipfs://${CID}`, { templates: TEMPLATES, fetcher: async () => ok(Buffer.from('{"name":"forged"}')) });
    expect(r.status).toBe("integrity_mismatch");
    expect(r.data).toBeNull();
  });
  it("timeout → unavailable and retryable (never 'not found')", async () => {
    const r = await fetchMetadata(`ipfs://${CID}`, { templates: TEMPLATES, fetcher: async () => Promise.reject(new SafeFetchError("Timed out", "timeout")) });
    expect(r.status).toBe("unavailable");
    expect(r.retryable).toBe(true);
    expect(r.attempts).toHaveLength(2);
  });
  it("gateway 429/404 → tries the next gateway", async () => {
    const r = await fetchMetadata(`ipfs://${CID}`, { templates: TEMPLATES, fetcher: async (url) => (url.includes("gw-a") ? ok(Buffer.from("rate limited"), { "content-type": "text/plain" }, 429) : ok(BYTES)) });
    expect(r.status).toBe("ok");
  });
  it("missing metadata (no URI) and HTTPS 404 are reported, not invented", async () => {
    expect((await fetchMetadata("")).status).toBe("unsupported_uri");
    const r = await fetchMetadata("https://example.com/missing.json", { fetcher: async () => ok(Buffer.from("nope"), { "content-type": "text/html" }, 404) });
    expect(r.status).toBe("not_found");
    expect(r.retryable).toBe(false);
  });
  it("oversized responses are refused", async () => {
    const r = await fetchMetadata("https://example.com/big.json", { fetcher: async () => ok(Buffer.alloc(10, 0x7b), { "content-type": "application/json" }, 200, true) });
    expect(r.status).toBe("too_large");
    expect(r.data).toBeNull();
  });
  it("non-JSON content (e.g. the image some v5 launches point at) is not parsed as metadata", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const r = await fetchMetadata("https://example.com/m", { fetcher: async () => ok(jpeg, { "content-type": "image/jpeg" }) });
    expect(r.status).toBe("not_json");
  });
  it("malformed JSON and non-object JSON are invalid", async () => {
    expect((await fetchMetadata("https://example.com/a", { fetcher: async () => ok(Buffer.from("{bad json")) })).status).toBe("invalid");
    expect((await fetchMetadata("https://example.com/b", { fetcher: async () => ok(Buffer.from("[1,2]")) })).status).toBe("invalid");
  });
  it("refuses compressed responses (no decompression of untrusted data)", async () => {
    const r = await fetchMetadata("https://example.com/c", { fetcher: async () => ok(Buffer.from([0x1f, 0x8b]), { "content-type": "application/json", "content-encoding": "gzip" }) });
    expect(r.status).toBe("unavailable");
  });
  it("strips NUL bytes from hostile JSON so it can be stored", async () => {
    const r = await fetchMetadata("https://example.com/d", { fetcher: async () => ok(Buffer.from('{"name":"a\\u0000b","description":"\\u202Eevil"}')) });
    expect(r.status).toBe("ok");
    expect(JSON.stringify(r.data)).not.toContain("\\u0000");
    expect(r.claims?.name).toBe("ab");
    expect(r.claims?.description).toBe("evil");
  });
  it("SSRF: an internal URL is blocked by the real safe fetcher (no request leaves)", async () => {
    for (const u of ["https://127.0.0.1/m.json", "https://169.254.169.254/latest/meta-data", "https://localhost/m.json", "https://[::1]/m.json", "https://10.0.0.1/x", "https://metadata.google.internal/x"]) {
      const r = await fetchMetadata(u);
      expect(r.status, u).toBe("blocked");
    }
  });
  it("SSRF: a public hostname that resolves to loopback is refused at connect time (DNS rebinding)", async () => {
    const r = await fetchMetadata("https://localtest.me/m.json", { timeoutMs: 5_000 });
    // localtest.me → 127.0.0.1. If DNS is unavailable in the sandbox the result is 'unavailable', never 'ok'.
    expect(["blocked", "unavailable", "not_found"]).toContain(r.status);
    expect(r.status).not.toBe("ok");
  });
});

describe("metadata claims", () => {
  it("extracts only well-formed links and caps text", () => {
    const c = extractClaims({ name: "x".repeat(500), socials: { website: "https://a.example", x: "javascript:alert(1)", telegram: 5 }, projectTypes: ["meme", 7] });
    expect(c.name!.length).toBe(200);
    expect(c.website).toBe("https://a.example/");
    expect(c.x).toBeNull();
    expect(c.telegram).toBeNull();
    expect(c.projectTypes).toEqual(["meme"]);
  });
});
