import type { Evidence, VerificationState } from "../verification/types";
import { extractPageMeta, safeFetch, SafeFetchError, type SafeFetchResult } from "./safe-fetch";
import { parseGithubRepo } from "./url-guard";
import { log, metrics } from "../util/log";

export type ProofCheckType = "website" | "github" | "demo" | "docs" | "twitter" | "discord";

export type UrlCheckResult = {
  type: ProofCheckType;
  url: string;
  state: VerificationState;
  summary: string;
  facts: Record<string, string | number | boolean | null>;
  evidence: Evidence;
  assurance?:
    | "creator_claimed"
    | "reachability_observed"
    | "control_verified"
    | "cryptographically_verified"
    | "historical_verification"
    | "expired"
    | "failed"
    | "unavailable";
  expiresAt?: string;
};

type Fetcher = typeof safeFetch;

/**
 * Website / demo / docs check. What it can establish:
 *  - reachable + status + TLS  → "observed"
 *  - page mentions the token contract address → "verified" (site links itself to this contract)
 * It never claims the product "works".
 */
export async function checkWebsite(
  type: "website" | "demo" | "docs",
  url: string,
  tokenAddress: string,
  fetcher: Fetcher = safeFetch,
): Promise<UrlCheckResult> {
  const observedAt = new Date().toISOString();
  const evidence: Evidence = { source: "VibeProof HTTP probe", method: "GET with SSRF-guarded client, redirects re-validated (max 3)", observedAt, url };
  let res: SafeFetchResult;
  try {
    res = await fetcher(url);
  } catch (e) {
    metrics.inc("proof.website_failures");
    const kind = e instanceof SafeFetchError ? e.kind : "network";
    const msg = e instanceof Error ? e.message : String(e);
    // DNS NXDOMAIN is a completed check with a negative result; everything else is "unavailable".
    const state: VerificationState = kind === "dns" ? "not_found" : kind === "blocked" ? "not_found" : "unavailable";
    return {
      type,
      url,
      state,
      summary: kind === "blocked" ? `Rejected: ${msg}` : kind === "dns" ? "Domain did not resolve" : `Check could not complete: ${msg}`,
      facts: { reachable: kind === "dns" ? false : null },
      evidence: { ...evidence, detail: msg },
    };
  }
  const meta = extractPageMeta(res.body);
  const mentionsToken = res.body.toLowerCase().includes(tokenAddress.toLowerCase());
  const okStatus = res.status >= 200 && res.status < 400;
  const facts = {
    reachable: okStatus,
    status: res.status,
    tls: res.tls ? res.tls.valid : false,
    tlsValidTo: res.tls?.validTo ?? null,
    title: meta.title ?? meta.ogTitle,
    description: meta.description,
    mentionsContract: mentionsToken,
    responseMs: res.ms,
    finalUrl: res.finalUrl,
  };
  if (!okStatus)
    return { type, url, state: res.status === 404 || res.status === 410 ? "not_found" : "unavailable", summary: `HTTP ${res.status}`, facts, evidence };
  return {
    type,
    url,
    state: "observed",
    summary: mentionsToken ? "Reachable; page references this contract address" : `Reachable (HTTP ${res.status}${res.tls?.valid ? ", valid TLS" : ""})`,
    facts,
    evidence: { ...evidence, detail: mentionsToken ? "Contract address found in page HTML." : "Contract address not found in page HTML." },
  };
}

type GhFetch = (path: string) => Promise<{ status: number; json: unknown; link: string | null }>;

const defaultGh: GhFetch = async (path) => {
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "VibeProof", "x-github-api-version": "2022-11-28" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(8_000) });
  return { status: r.status, json: r.status === 204 ? null : await r.json().catch(() => null), link: r.headers.get("link") };
};

/** Count items using per_page=1 and the `last` page in the Link header. */
function countFromLink(link: string | null, pageLen: number) {
  const m = link?.match(/[?&]page=(\d+)>;\s*rel="last"/);
  return m ? Number(m[1]) : pageLen;
}

export async function checkGithub(url: string, tokenAddress: string, gh: GhFetch = defaultGh, now = Date.now()): Promise<UrlCheckResult> {
  const observedAt = new Date(now).toISOString();
  const parsed = parseGithubRepo(url);
  const evidence: Evidence = { source: "GitHub REST API", method: "GET /repos/{owner}/{repo} (+ commits, contributors, releases, readme)", observedAt, url };
  if (!parsed) return { type: "github", url, state: "not_found", summary: "Not a github.com/{owner}/{repo} URL", facts: {}, evidence };
  const base = `/repos/${parsed.owner}/${parsed.repo}`;
  try {
    const repo = await gh(base);
    if (repo.status === 404)
      return { type: "github", url, state: "not_found", summary: "Repository not found (or private)", facts: { exists: false }, evidence };
    if (repo.status === 403 || repo.status === 429) throw new Error(`GitHub rate limited (${repo.status})`);
    if (repo.status !== 200) throw new Error(`GitHub HTTP ${repo.status}`);
    const r = repo.json as {
      private: boolean;
      stargazers_count: number;
      pushed_at: string;
      default_branch: string;
      archived: boolean;
      fork: boolean;
      full_name: string;
    };
    const since = new Date(now - 30 * 86400_000).toISOString();
    const [commits, contributors, releases, readme, latest] = await Promise.all([
      gh(`${base}/commits?since=${since}&per_page=1`),
      gh(`${base}/contributors?per_page=1&anon=1`),
      gh(`${base}/releases?per_page=1`),
      gh(`${base}/readme`),
      gh(`${base}/commits?per_page=1`),
    ]);
    const ok = (x: { status: number }) => x.status === 200;
    const arrLen = (x: { json: unknown }) => (Array.isArray(x.json) ? x.json.length : 0);
    const lastCommit =
      ok(latest) && Array.isArray(latest.json) && latest.json[0] ? (latest.json[0] as { commit: { committer: { date: string } } }).commit.committer.date : null;
    let readmeMentions = false;
    if (ok(readme)) {
      const content = (readme.json as { content?: string; encoding?: string })?.content;
      if (content) readmeMentions = Buffer.from(content, "base64").toString("utf8").toLowerCase().includes(tokenAddress.toLowerCase());
    }
    const facts = {
      exists: true,
      fullName: r.full_name,
      private: r.private,
      archived: r.archived,
      fork: r.fork,
      stars: r.stargazers_count,
      pushedAt: r.pushed_at,
      lastCommitAt: lastCommit,
      // null (not 0) when the sub-request failed
      commits30d: ok(commits) ? countFromLink(commits.link, arrLen(commits)) : null,
      contributors: ok(contributors) ? countFromLink(contributors.link, arrLen(contributors)) : contributors.status === 204 ? 0 : null,
      releases: ok(releases) ? arrLen(releases) : null,
      hasReadme: readme.status === 200 ? true : readme.status === 404 ? false : null,
      readmeMentionsContract: readmeMentions,
    };
    return {
      type: "github",
      url,
      state: "observed",
      summary: readmeMentions ? "Repository found; README references this contract address" : "Repository found",
      facts,
      evidence,
    };
  } catch (e) {
    metrics.inc("proof.github_failures");
    log("warn", "proof.github_failed", { url, error: e instanceof Error ? e.message : String(e) });
    return {
      type: "github",
      url,
      state: "unavailable",
      summary: "GitHub verification could not be completed.",
      facts: {},
      evidence: { ...evidence, detail: e instanceof Error ? e.message : String(e) },
    };
  }
}

/** Social links are recorded as creator claims only; VibeProof does not scrape social platforms. */
export function socialClaim(type: "twitter" | "discord", url: string): UrlCheckResult {
  return {
    type,
    url,
    state: "creator_claimed",
    summary: "Provided by creator; not independently checked",
    facts: {},
    evidence: { source: "Creator submission", method: "Recorded as submitted", observedAt: new Date().toISOString(), url },
  };
}
