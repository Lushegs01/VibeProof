/** Bounded ten-second buckets; an idle process reports no observations, never a healthy zero. */
export class RollingWindow {
  private buckets = new Map<number, { count: number; errors: number; throttled: number; retries: number; ms: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  record({ error = false, throttled = false, retry = false, ms = 0 } = {}) {
    const at = Math.floor(this.now() / 10_000) * 10_000;
    const bucket = this.buckets.get(at) ?? { count: 0, errors: 0, throttled: 0, retries: 0, ms: 0 };
    bucket.count++;
    bucket.errors += Number(error);
    bucket.throttled += Number(throttled);
    bucket.retries += Number(retry);
    bucket.ms += Math.max(0, ms);
    this.buckets.set(at, bucket);
    this.prune();
  }
  private prune() {
    for (const at of this.buckets.keys()) if (at <= this.now() - 300_000) this.buckets.delete(at);
  }
  snapshot() {
    this.prune();
    const total = { count: 0, errors: 0, throttled: 0, retries: 0, ms: 0 };
    for (const bucket of this.buckets.values()) for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += bucket[key];
    return {
      ...total,
      errorRate: total.count ? total.errors / total.count : null,
      throttleRate: total.count ? total.throttled / total.count : null,
      retryRate: total.count ? total.retries / total.count : null,
      meanLatencyMs: total.count ? total.ms / total.count : null,
    };
  }
}
