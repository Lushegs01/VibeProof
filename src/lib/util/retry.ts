export type RetryOptions = { retries?: number; baseMs?: number; maxMs?: number; shouldRetry?: (e: unknown) => boolean };

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 3, baseMs = 250, maxMs = 4000, shouldRetry = () => true } = opts;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= retries || !shouldRetry(e)) throw e;
      const delay = Math.min(maxMs, baseMs * 2 ** attempt) * (0.75 + Math.random() * 0.5);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}

/** Collapse concurrent identical requests into one in-flight promise. */
const inflight = new Map<string, Promise<unknown>>();
export function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
