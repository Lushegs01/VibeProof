/**
 * RPC error classification. Decides whether a failed call is retried, split into smaller
 * ranges, or surfaced immediately. Error texts were taken from the live Robinhood Chain
 * endpoints and common providers (docs/assessment.md §9).
 *
 *   TRANSIENT (retried with backoff): rate_limited (429), timeout, transient (5xx, resets)
 *   RANGE     (caller splits the query): range_too_large, too_many_selectors
 *   PERMANENT (never retried): permanent, not_found
 */
export type RpcErrorKind = "rate_limited" | "timeout" | "transient" | "range_too_large" | "too_many_selectors" | "not_found" | "permanent" | "unknown";

export type RpcErrorInfo = {
  kind: RpcErrorKind;
  message: string;
  status?: number;
  /** From a Retry-After header, when the provider sent one. */
  retryAfterMs?: number;
  /** Largest block span the provider says it accepts ("only 30000 are allowed"). */
  maxSpan?: bigint;
  /** Provider-suggested end block for the same start (Alchemy: "this block range should work: [a, b]"). */
  suggestedTo?: bigint;
  /** Largest number of address+topic selectors the provider accepts. */
  maxSelectors?: number;
};

export class RpcError extends Error {
  constructor(
    readonly info: RpcErrorInfo,
    readonly method: string,
    options?: { cause?: unknown },
  ) {
    super(`${method}: ${info.kind}: ${info.message}`, options);
    this.name = "RpcError";
  }
}

type ErrLike = { name?: string; message?: string; shortMessage?: string; details?: string; status?: number; code?: number; headers?: { get?: (k: string) => string | null }; cause?: unknown };

function collect(e: unknown): { text: string; status?: number; codes: number[]; names: string[]; retryAfter?: string | null } {
  const parts: string[] = [];
  const codes: number[] = [];
  const names: string[] = [];
  let status: number | undefined;
  let retryAfter: string | null | undefined;
  let cur: unknown = e;
  for (let depth = 0; cur && depth < 6; depth++) {
    if (typeof cur !== "object") {
      parts.push(String(cur));
      break;
    }
    const x = cur as ErrLike;
    if (x.name) names.push(x.name);
    for (const s of [x.shortMessage, x.details, x.message]) if (typeof s === "string" && s) parts.push(s);
    if (typeof x.status === "number") status ??= x.status;
    if (typeof x.code === "number") codes.push(x.code);
    if (retryAfter === undefined && x.headers && typeof x.headers.get === "function") retryAfter = x.headers.get("retry-after");
    cur = x.cause;
  }
  return { text: parts.join(" | "), status, codes, names, retryAfter };
}

function parseRetryAfter(v: string | null | undefined): number | undefined {
  if (!v) return undefined;
  const secs = Number(v);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 120_000);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, Math.min(at - Date.now(), 120_000)) : undefined;
}

const firstLine = (s: string) => s.split("\n").find((l) => l.trim()) ?? s;

export function classifyRpcError(e: unknown): RpcErrorInfo {
  if (e instanceof RpcError) return e.info;
  const { text, status, codes, names, retryAfter } = collect(e);
  const message = redactSecrets(firstLine(text)).slice(0, 300);
  const t = text;

  // ── Range / size errors: the caller must narrow the query (never a plain retry). ──
  let m = t.match(/query spans \d+ blocks.*?only (\d+) are allowed/i);
  if (m) return { kind: "range_too_large", message, status, maxSpan: BigInt(m[1]) };
  m = t.match(/this block range should work: \[(0x[0-9a-f]+), (0x[0-9a-f]+)\]/i);
  if (m) return { kind: "range_too_large", message, status, suggestedTo: BigInt(m[2]) };
  m = t.match(/(\d+) address and topic selectors specified in query, but only (\d+) are allowed/i);
  if (m) return { kind: "too_many_selectors", message, status, maxSelectors: Number(m[2]) };
  m = t.match(/block range (?:is )?(?:too large|exceeds?)[^0-9]*(\d+)?/i) ?? t.match(/range (?:is )?too (?:large|wide)|max(?:imum)? block range[^0-9]*(\d+)?/i);
  if (m) return { kind: "range_too_large", message, status, maxSpan: m[1] ? BigInt(m[1]) : undefined };
  if (
    names.includes("ResponseBodyTooLargeError") ||
    /response body exceeded the size limit|logs matched by query exceeds limit|query returned more than \d+ results|too many (logs|results)|log response size exceeded|response size (is )?(too large|exceeded)/i.test(t)
  )
    return { kind: "range_too_large", message, status };

  // ── Rate limiting ──
  if (status === 429 || codes.includes(-32005) || /\b429\b|too many requests|rate[- ]?limit|request limit (reached|exceeded)|exceeded .*(capacity|throughput|compute units)/i.test(t))
    return { kind: "rate_limited", message, status, retryAfterMs: parseRetryAfter(retryAfter) };

  // ── Timeouts ──
  if (names.includes("TimeoutError") || /timed? ?out|timeout|ETIMEDOUT|UND_ERR_(HEADERS|BODY)_TIMEOUT/i.test(t)) return { kind: "timeout", message, status };

  // ── Permanent request problems (never retried) ──
  if (/historical state .* not available|missing trie node|pruned/i.test(t)) return { kind: "permanent", message, status };
  if (codes.includes(-32601) || /method .*(not found|not (available|supported))|unsupported method|does not exist\/is not available/i.test(t)) return { kind: "permanent", message, status };
  if (/execution reverted|invalid (address|argument|params|block range|from block|to block)|cannot unmarshal|invalid hex|fromBlock.*(greater|after) .*toBlock|invalid json/i.test(t)) return { kind: "permanent", message, status };
  if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) return { kind: "permanent", message, status };

  // ── Transient transport / server errors ──
  if ((status !== undefined && (status >= 500 || status === 408)) || /ECONNRESET|ECONNREFUSED|EPIPE|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|other side closed|network ?error|UND_ERR|\b50[0234]\b|bad gateway|service unavailable|gateway time|header not found|unknown block|internal error/i.test(t))
    return { kind: "transient", message, status };

  if (/not found|could not be found/i.test(t)) return { kind: "not_found", message, status };
  return { kind: "unknown", message, status };
}

export const isRangeError = (k: RpcErrorKind) => k === "range_too_large" || k === "too_many_selectors";

/**
 * Remove credentials from anything that may be logged or returned: provider URLs often embed
 * an API key in the path (`/v2/<key>`) or query (`?apikey=`). Keeps only scheme + host.
 */
export function redactSecrets(s: string): string {
  return s
    .replace(/(https?|wss?):\/\/([^\s"'/?#]+)[^\s"']*/gi, (_m, proto: string, host: string) => `${proto}://${host.replace(/^[^@]*@/, "")}/…`)
    .replace(/(api[_-]?key|token|key|secret)=([^&\s"']+)/gi, "$1=[redacted]");
}
