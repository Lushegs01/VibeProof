type Level = "debug" | "info" | "warn" | "error";
const SENSITIVE = /^(signature|sig|private_?key|mnemonic|seed|secret|password|authorization|cookie|api_?key|access_?token|session(_?token)?|github_?token)$/i;

function scrub(fields: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = SENSITIVE.test(k) ? "[redacted]" : v;
  return out;
}

/** Structured JSON logger. Never pass raw secrets; keys matching SENSITIVE are redacted. */
export function log(level: Level, event: string, fields: Record<string, unknown> = {}) {
  if (level === "debug" && process.env.LOG_LEVEL !== "debug") return;
  const line = JSON.stringify(
    { ts: new Date().toISOString(), level, event, ...scrub(fields) },
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
  );
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

/** In-process counters, surfaced on /api/health. */
export const metrics = {
  counters: new Map<string, number>(),
  inc(name: string, by = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  },
  snapshot() {
    return Object.fromEntries(this.counters);
  },
};

export async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const ms = Math.round(performance.now() - start);
    metrics.inc(`${name}.calls`);
    metrics.inc(`${name}.ms_total`, ms);
    log("debug", "timing", { name, ms });
  }
}
