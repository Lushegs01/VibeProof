import { describe, expect, it } from "vitest";
import { toFunctionSelector } from "viem";
import { detectMinimalProxy, extractPush4Selectors, hasDelegatecall, matchCapabilities, matchCapabilitiesFromAbi } from "@/lib/analysis/bytecode";

const sel = (sig: string) => toFunctionSelector(`function ${sig}`).slice(2);

describe("selector extraction", () => {
  it("finds PUSH4 immediates", () => {
    const code = `0x63${sel("mint(address,uint256)")}1463${sel("transfer(address,uint256)")}14` as const;
    const s = extractPush4Selectors(code);
    expect(s.has(`0x${sel("mint(address,uint256)")}`)).toBe(true);
    expect(s.has(`0x${sel("transfer(address,uint256)")}`)).toBe(true);
  });
  it("does not treat PUSH data as opcodes", () => {
    // PUSH5 whose data contains 0x63 followed by a selector — must NOT be reported.
    const hidden = sel("pause()");
    const code = `0x6463${hidden}00` as const;
    expect(extractPush4Selectors(code).has(`0x${hidden}`)).toBe(false);
  });
  it("handles truncated trailing PUSH4 without throwing", () => {
    expect(() => extractPush4Selectors("0x63aabb")).not.toThrow();
    expect(extractPush4Selectors("0x63aabb").size).toBe(0);
  });
  it("detects DELEGATECALL only as an opcode", () => {
    expect(hasDelegatecall("0x60f4")).toBe(false); // f4 is PUSH1 data
    expect(hasDelegatecall("0x6000f4")).toBe(true);
  });
});

describe("EIP-1167 minimal proxy", () => {
  it("extracts the implementation", () => {
    const impl = "bebebebebebebebebebebebebebebebebebebebe";
    expect(detectMinimalProxy(`0x363d3d373d3d3d363d73${impl}5af43d82803e903d91602b57fd5bf3`)).toBe(`0x${impl}`);
    expect(detectMinimalProxy("0x6080604052")).toBeNull();
  });
});

describe("capability matching", () => {
  it("maps selectors to capability categories", () => {
    const set = new Set([`0x${sel("mint(address,uint256)")}`, `0x${sel("pause()")}`, `0x${sel("transferOwnership(address)")}`]);
    const caps = matchCapabilities(set);
    expect(caps.mint).toEqual(["mint(address,uint256)"]);
    expect(caps.pause).toEqual(["pause()"]);
    expect(caps.ownership).toContain("transferOwnership(address)");
    expect(caps.blacklist).toEqual([]);
    expect(caps.upgrade).toEqual([]);
  });
  it("matches against a verified ABI", () => {
    const caps = matchCapabilitiesFromAbi([
      { type: "function", name: "setBlacklist", inputs: [{ type: "address" }, { type: "bool" }] },
      { type: "function", name: "upgradeToAndCall", inputs: [{ type: "address" }, { type: "bytes" }] },
      { type: "event", name: "Transfer" },
    ]);
    expect(caps.blacklist).toEqual(["setBlacklist(address,bool)"]);
    expect(caps.upgrade).toEqual(["upgradeToAndCall(address,bytes)"]);
  });
});
