import { describe, expect, it } from "vitest";
import { classifyQuery } from "@/lib/services/search-service";

describe("search classification", () => {
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["0xe794217880011f9ca6961340ed5c16ec9559fea0", "address"],
    [`0x${"ab".repeat(32)}`, "tx"],
    ["$PUNKS", "symbol"],
    ["punks vibe", "text"],
    ["0x123", "text"],
  ])("%s → %s", (q, k) => expect(classifyQuery(q)).toBe(k));
});
