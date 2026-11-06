/**
 * Development-only self-fetch for the canonical document route. It permits no arbitrary
 * destination, path, credentials, redirect or query. Production always uses the public SSRF guard.
 */
export function localEvidenceUrl(input: string): URL | null {
  if (process.env.NODE_ENV !== "development" || !process.env.NEXT_PUBLIC_APP_URL) return null;
  try {
    const url = new URL(input),
      app = new URL(process.env.NEXT_PUBLIC_APP_URL);
    if (
      url.origin !== app.origin ||
      url.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/api\/evidence\/0x[0-9a-f]{64}$/.test(url.pathname)
    )
      return null;
    return url;
  } catch {
    return null;
  }
}
export async function retrieveLocalEvidence(url: URL) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
  if (response.status !== 200 || !response.body) throw new Error("Local evidence route unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16384) {
      await reader.cancel();
      throw new Error("Oversized local evidence document");
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}
