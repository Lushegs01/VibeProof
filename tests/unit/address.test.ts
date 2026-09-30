import { describe, expect, it } from "vitest";
import { isTxHash, parseAddress, shortAddress } from "@/lib/util/address";

describe("address validation", () => {
  it("accepts lowercase and valid checksummed addresses, returning checksum form", () => {
    expect(parseAddress("0xe794217880011f9ca6961340ed5c16ec9559fea0")).toBe("0xe794217880011f9cA6961340eD5c16EC9559Fea0");
    expect(parseAddress("0xe794217880011f9cA6961340eD5c16EC9559Fea0")).toBe("0xe794217880011f9cA6961340eD5c16EC9559Fea0");
  });
  it("rejects a mixed-case address with a bad checksum", () => {
    expect(parseAddress("0xE794217880011f9cA6961340eD5c16EC9559Fea0")).toBeNull();
  });
  it("rejects malformed input", () => {
    for (const bad of ["", "0x", "0x123", "e794217880011f9ca6961340ed5c16ec9559fea0", "0xg794217880011f9ca6961340ed5c16ec9559fea0", "0xe794217880011f9ca6961340ed5c16ec9559fea00", null, 42, " 0x' OR 1=1 --"]) {
      expect(parseAddress(bad as never)).toBeNull();
    }
  });
  it("trims whitespace", () => {
    expect(parseAddress("  0xe794217880011f9ca6961340ed5c16ec9559fea0\n")).not.toBeNull();
  });
  it("recognises transaction hashes", () => {
    expect(isTxHash(`0x${"a".repeat(64)}`)).toBe(true);
    expect(isTxHash(`0x${"a".repeat(63)}`)).toBe(false);
    expect(isTxHash(`0x${"a".repeat(40)}`)).toBe(false);
  });
  it("shortens", () => {
    expect(shortAddress("0xe794217880011f9cA6961340eD5c16EC9559Fea0")).toBe("0xe794…Fea0");
  });
});
