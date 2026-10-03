import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { backoffMs, createCaller, createViemProvider, DEFAULT_RETRY } from "@/lib/chain/provider";
import { getLogsAdaptive } from "@/lib/chain/logs";
import { RpcError } from "@/lib/chain/rpc-errors";
import { TRANSFER_EVENT } from "@/lib/vibe/abis";

const fastPolicy = { baseMs: 1, maxMs: 5, maxAttempts: DEFAULT_RETRY.maxAttempts };

describe("createCaller retry policy", () => {
  it("retries transient failures with backoff, then succeeds", async () => {
    const { call, telemetry } = createCaller({ maxConcurrency: 2, policy: fastPolicy });
    let n = 0;
    const r = await call("eth_x", async () => {
      if (++n < 3) throw Object.assign(new Error("HTTP request failed"), { status: 503 });
      return "ok";
    });
    expect(r).toBe("ok");
    expect(n).toBe(3);
    const s = telemetry.snapshot();
    expect(s.retries).toBe(2);
    expect(s.failed).toBe(0);
    expect(s.errorRate5m).toBeCloseTo(2 / 3);
  });

  it("handles 429 by pausing every request (shared cooldown) and retrying", async () => {
    const slept: number[] = [];
    const { call, telemetry } = createCaller({ maxConcurrency: 4, policy: { ...fastPolicy, baseMs: 50, maxMs: 50 }, sleepFn: async (ms) => void slept.push(ms) });
    let n = 0;
    await call("eth_x", async () => {
      if (++n === 1) throw Object.assign(new Error("Too Many Requests"), { status: 429 });
      return 1;
    });
    expect(telemetry.snapshot().rateLimited).toBe(1);
    expect(slept.length).toBeGreaterThanOrEqual(1);
  });

  it("does not retry permanent errors", async () => {
    const { call } = createCaller({ maxConcurrency: 1, policy: fastPolicy });
    let n = 0;
    await expect(
      call("eth_call", async () => {
        n++;
        throw new Error("execution reverted");
      }),
    ).rejects.toBeInstanceOf(RpcError);
    expect(n).toBe(1);
  });

  it("does not retry range errors (the caller narrows the query instead)", async () => {
    const { call, telemetry } = createCaller({ maxConcurrency: 1, policy: fastPolicy });
    let n = 0;
    const err = await call("eth_getLogs", async () => {
      n++;
      throw new Error("logs matched by query exceeds limit of 10000");
    }).catch((e) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).info.kind).toBe("range_too_large");
    expect(n).toBe(1);
    expect(telemetry.snapshot().rangeSplits).toBe(1);
  });

  it("gives up after the bounded number of attempts", async () => {
    const { call, telemetry } = createCaller({ maxConcurrency: 1, policy: { baseMs: 1, maxMs: 1, maxAttempts: { timeout: 2 } } });
    let n = 0;
    await expect(
      call("eth_blockNumber", async () => {
        n++;
        throw new Error("request timed out");
      }),
    ).rejects.toThrow(/timeout/);
    expect(n).toBe(3);
    expect(telemetry.snapshot().lastError?.kind).toBe("timeout");
  });

  it("caps concurrency", async () => {
    const { call } = createCaller({ maxConcurrency: 3, policy: fastPolicy });
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        call("x", async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 2));
          active--;
        }),
      ),
    );
    expect(peak).toBe(3);
  });

  it("backoff is exponential with jitter, capped, and never shorter than Retry-After", () => {
    const p = { baseMs: 100, maxMs: 1000, maxAttempts: {} };
    expect(backoffMs(0, p, undefined, () => 0)).toBe(50);
    expect(backoffMs(0, p, undefined, () => 1)).toBe(100);
    expect(backoffMs(3, p, undefined, () => 1)).toBe(800);
    expect(backoffMs(10, p, undefined, () => 1)).toBe(1000);
    expect(backoffMs(0, p, { kind: "rate_limited", message: "", retryAfterMs: 5000 }, () => 1)).toBe(5000);
  });
});

/** A local JSON-RPC server scripted per test, to exercise the real viem HTTP transport. */
describe("viem provider against a scripted JSON-RPC endpoint", () => {
  let server: http.Server;
  let url = "";
  let script: ((body: { method: string; params: unknown[] }) => { status?: number; delayMs?: number; json?: unknown; headers?: Record<string, string> }) | null = null;
  const seen: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", async () => {
        const body = JSON.parse(raw);
        seen.push(body.method);
        const r = script!(body);
        if (r.delayMs) await new Promise((x) => setTimeout(x, r.delayMs));
        res.writeHead(r.status ?? 200, { "content-type": "application/json", ...(r.headers ?? {}) });
        res.end(JSON.stringify(r.json ?? { jsonrpc: "2.0", id: body.id, result: "0x1" }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const provider = () => createViemProvider("robinhood-testnet", { rpcUrl: url, timeoutMs: 300, policy: { baseMs: 5, maxMs: 20, maxAttempts: DEFAULT_RETRY.maxAttempts } });

  it("retries an HTTP 429 and then returns the result", async () => {
    let calls = 0;
    script = (b) => (++calls === 1 ? { status: 429, json: { error: "Too Many Requests" } } : { json: { jsonrpc: "2.0", id: 1, result: "0x2a" } });
    expect(await provider().getBlockNumber()).toBe(42n);
    expect(calls).toBe(2);
  });

  it("retries a provider 5xx", async () => {
    let calls = 0;
    script = () => (++calls <= 2 ? { status: 503, json: { error: "unavailable" } } : { json: { jsonrpc: "2.0", id: 1, result: "0xb626" } });
    expect(await provider().getChainId!()).toBe(46630);
    expect(calls).toBe(3);
  });

  it("retries a timeout and fails after bounded attempts", async () => {
    let calls = 0;
    script = () => (calls++, { delayMs: 1_000 });
    await expect(provider().getBlockNumber()).rejects.toThrow(/timeout/);
    expect(calls).toBe(DEFAULT_RETRY.maxAttempts.timeout! + 1);
  }, 15_000);

  it("splits eth_getLogs on the 10k-log limit and never skips the range", async () => {
    // Pretend every block holds 3 logs; the 'node' refuses queries matching more than 10.
    seen.length = 0;
    script = (b) => {
      if (b.method !== "eth_getLogs") return { json: { jsonrpc: "2.0", id: 1, result: "0x0" } };
      const f = (b.params[0] as { fromBlock: string; toBlock: string });
      const from = Number(BigInt(f.fromBlock));
      const to = Number(BigInt(f.toBlock));
      if ((to - from + 1) * 3 > 10) return { json: { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "logs matched by query exceeds limit of 10" } } };
      const logs = [];
      for (let n = from; n <= to; n++)
        for (let i = 0; i < 3; i++)
          logs.push({ address: "0x00000000000000000000000000000000000000aa", topics: [TRANSFER_EVENT && "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", `0x${"0".repeat(64)}`, `0x${"0".repeat(63)}1`], data: `0x${"0".repeat(63)}1`, blockNumber: `0x${n.toString(16)}`, blockHash: `0x${"1".repeat(64)}`, transactionHash: `0x${n.toString(16).padStart(62, "0")}0${i}`, transactionIndex: "0x0", logIndex: `0x${i.toString(16)}`, removed: false });
      return { json: { jsonrpc: "2.0", id: 1, result: logs } };
    };
    const logs = await getLogsAdaptive(provider(), { event: TRANSFER_EVENT }, 100n, 199n, { chunk: 100n });
    expect(logs).toHaveLength(300);
    expect(new Set(logs.map((l) => Number(l.blockNumber))).size).toBe(100);
    expect(seen.filter((m) => m === "eth_getLogs").length).toBeGreaterThan(10);
  });

  it("de-duplicates concurrent identical reads", async () => {
    seen.length = 0;
    script = () => ({ delayMs: 30, json: { jsonrpc: "2.0", id: 1, result: "0x60016000" } });
    const p = provider();
    await Promise.all([p.getBytecode("0x00000000000000000000000000000000000000aa"), p.getBytecode("0x00000000000000000000000000000000000000aa"), p.getBytecode("0x00000000000000000000000000000000000000aa")]);
    expect(seen.filter((m) => m === "eth_getCode")).toHaveLength(1);
  });
});
