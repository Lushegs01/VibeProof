import { describe, expect, it } from "vitest";
import type { Log } from "viem";
import fixtures from "../fixtures/logs.json";
import { balanceDeltas, decodeLaunch, decodeTrade, decodeTransfer, logTimestamp } from "@/indexer/decode";
import { VIBE_DEPLOYMENTS } from "@/lib/vibe/contracts";

const asLog = (l: (typeof fixtures)["launchCreated"]) => ({ ...l, blockNumber: BigInt(l.blockNumber) }) as unknown as Log;

describe("vibe/vibe event decoding (real Robinhood Chain Testnet logs)", () => {
  it("decodes a v6 LaunchCreated log", () => {
    const d = decodeLaunch(asLog(fixtures.launchCreated), VIBE_DEPLOYMENTS[0]);
    expect(d).not.toBeNull();
    expect(d!.deploymentId).toBe("v6-run15");
    expect(d!.token).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(d!.creator).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(d!.curve).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(typeof d!.symbol).toBe("string");
  });
  it("decodes a v5 TokenLaunched log", () => {
    const d = decodeLaunch(asLog(fixtures.tokenLaunched), VIBE_DEPLOYMENTS[1]);
    expect(d).not.toBeNull();
    expect(d!.deploymentId).toBe("v5-live");
    expect(d!.symbol).toBeNull(); // v5 events carry no symbol; read from the token later
  });
  it("refuses to decode a log with the wrong deployment's ABI", () => {
    expect(decodeLaunch(asLog(fixtures.launchCreated), VIBE_DEPLOYMENTS[1])).toBeNull();
  });
  it("decodes a v6 CurveBuy into a buy trade", () => {
    const t = decodeTrade(asLog(fixtures.curveBuy));
    expect(t?.kind).toBe("buy");
    expect(t!.tokenAmount > 0n).toBe(true);
  });
  it("treats blockTimestamp 0x0 as unknown, never 1970", () => {
    expect(logTimestamp({ blockTimestamp: "0x0" } as never)).toBeNull();
    expect(logTimestamp({ blockTimestamp: 0n } as never)).toBeNull();
    expect(logTimestamp({ blockTimestamp: 1790000000n } as never)?.toISOString()).toBe("2026-09-21T14:13:20.000Z");
  });
});

describe("holder balance deltas", () => {
  const T = "0x00000000000000000000000000000000000000aa";
  const Z = "0x0000000000000000000000000000000000000000";
  const A = "0x00000000000000000000000000000000000000a1";
  const B = "0x00000000000000000000000000000000000000b1";
  const tr = (from: string, to: string, value: bigint, i = 0) => ({ token: T, from, to, value, txHash: "0x1", blockNumber: 1n, logIndex: i, timestamp: null }) as never;

  it("applies mints, transfers and burns, ignoring the zero address", () => {
    const d = balanceDeltas([tr(Z, A, 100n), tr(A, B, 30n, 1), tr(B, Z, 10n, 2)]);
    expect(d.get(`${T}:${A}`)).toBe(70n);
    expect(d.get(`${T}:${B}`)).toBe(20n);
    expect(d.has(`${T}:${Z}`)).toBe(false);
  });
  it("ignores zero-value and self transfers", () => {
    const d = balanceDeltas([tr(A, B, 0n), tr(A, A, 50n, 1)]);
    expect(d.size).toBe(0);
  });
  it("decodes an ERC-20 Transfer log", () => {
    const log = {
      address: T,
      topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", `0x${"0".repeat(24)}${A.slice(2)}`, `0x${"0".repeat(24)}${B.slice(2)}`],
      data: `0x${(5n).toString(16).padStart(64, "0")}`,
      blockNumber: 10n,
      transactionHash: `0x${"1".repeat(64)}`,
      logIndex: 3,
    } as unknown as Log;
    expect(decodeTransfer(log)).toMatchObject({ value: 5n, logIndex: 3 });
  });
});
