import { describe, expect, it } from "vitest";
import { HttpRequestError, InvalidInputRpcError, ResponseBodyTooLargeError, RpcRequestError, TimeoutError } from "viem";
import { classifyRpcError, redactSecrets, isRangeError } from "@/lib/chain/rpc-errors";

/** Error texts below were observed on the live Robinhood Chain RPCs or are documented provider responses. */
const rpc = (code: number, message: string) => new InvalidInputRpcError(new RpcRequestError({ body: {}, error: { code, message }, url: "https://rpc.example/v2/SECRETKEY" }));
const http = (status: number, headers?: Record<string, string>) => new HttpRequestError({ status, url: "https://rpc.example/v2/SECRETKEY", headers: new Headers(headers ?? {}), details: `HTTP ${status}` });

describe("RPC error classification", () => {
  it("TRANSIENT: HTTP 429 is rate_limited and honours Retry-After", () => {
    const i = classifyRpcError(http(429, { "retry-after": "3" }));
    expect(i.kind).toBe("rate_limited");
    expect(i.retryAfterMs).toBe(3000);
    expect(classifyRpcError(new Error("Too Many Requests")).kind).toBe("rate_limited");
    expect(classifyRpcError(rpc(-32005, "limit exceeded")).kind).toBe("rate_limited");
  });

  it("TRANSIENT: timeouts", () => {
    expect(classifyRpcError(new TimeoutError({ body: {}, url: "https://x" })).kind).toBe("timeout");
    expect(classifyRpcError(new Error("The operation timed out")).kind).toBe("timeout");
  });

  it("TRANSIENT: 502/503/504 and connection resets", () => {
    for (const s of [502, 503, 504]) expect(classifyRpcError(http(s)).kind).toBe("transient");
    expect(classifyRpcError(new Error("read ECONNRESET")).kind).toBe("transient");
    expect(classifyRpcError(new Error("fetch failed")).kind).toBe("transient");
    expect(classifyRpcError(new Error("socket hang up")).kind).toBe("transient");
  });

  it("RANGE: the mainnet 'only N are allowed' limit carries the allowed span", () => {
    const i = classifyRpcError(rpc(-32602, "query spans 5000000 blocks (0 to 4999999), but only 30000 are allowed for this request; narrow the block range, or add an address filter"));
    expect(i.kind).toBe("range_too_large");
    expect(i.maxSpan).toBe(30000n);
    expect(isRangeError(i.kind)).toBe(true);
  });

  it("RANGE: 10k-log limit, oversized bodies, Alchemy's suggested range", () => {
    expect(classifyRpcError(rpc(-32000, "logs matched by query exceeds limit of 10000")).kind).toBe("range_too_large");
    expect(classifyRpcError(new ResponseBodyTooLargeError({ maxSize: 10, size: 11 })).kind).toBe("range_too_large");
    const a = classifyRpcError(new Error("Log response size exceeded. You can make eth_getLogs requests with up to a 2K block range and no limit on the response size, or you can request any block range with a cap of 10K logs in the response. Based on your parameters, this block range should work: [0x10, 0x1f]"));
    expect(a.kind).toBe("range_too_large");
    expect(a.suggestedTo).toBe(0x1fn);
  });

  it("RANGE: too many address/topic selectors (testnet limit)", () => {
    const i = classifyRpcError(rpc(-32602, "1001 address and topic selectors specified in query, but only 1000 are allowed"));
    expect(i.kind).toBe("too_many_selectors");
    expect(i.maxSelectors).toBe(1000);
  });

  it("PERMANENT: malformed requests, invalid addresses/ranges, unsupported methods, missing archive state", () => {
    expect(classifyRpcError(rpc(-32602, "invalid argument 0: hex string has length 3, want 40 for common.Address")).kind).toBe("permanent");
    expect(classifyRpcError(new Error("invalid block range params")).kind).toBe("permanent");
    expect(classifyRpcError(rpc(-32601, "the method eth_foo does not exist/is not available")).kind).toBe("permanent");
    expect(classifyRpcError(rpc(-32000, "historical state 8939… is not available")).kind).toBe("permanent");
    expect(classifyRpcError(new Error("execution reverted")).kind).toBe("permanent");
    expect(classifyRpcError(http(400)).kind).toBe("permanent");
  });

  it("never leaks provider keys in messages", () => {
    const i = classifyRpcError(http(503));
    expect(JSON.stringify(i)).not.toContain("SECRETKEY");
    expect(redactSecrets("failed: https://robinhood-mainnet.g.alchemy.com/v2/abcDEF123 boom")).toBe("failed: https://robinhood-mainnet.g.alchemy.com/… boom");
    expect(redactSecrets("wss://u:p@host.example/ws?apikey=xyz")).not.toMatch(/xyz|u:p/);
    expect(redactSecrets("token=abc&x=1")).toBe("token=[redacted]&x=1");
  });
});
