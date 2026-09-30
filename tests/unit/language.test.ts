import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildStatements } from "@/lib/services/statements";
import { demoPassport, DEMO_TOKENS } from "@/lib/demo/data";

/**
 * Product rule: never present speculation or verdicts. These words must not appear
 * in user-facing copy (JSX text and string literals in UI files).
 */
const BANNED = [/\bsafe to\b/i, /\bis safe\b/i, /\bunsafe\b/i, /\blegit\b/i, /\bscam\b/i, /\bguaranteed?\b/i, /\bpump\b/i, /\b100x\b/i, /\bmoon\b/i, /\bape\b/i, /\bbuy now\b/i, /\balpha\b/i, /\btrust score\b(?! )/i, /\bscore:\s*\d/i];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(p) ? [p] : [];
  });
}

describe("evidence-first language", () => {
  it("statement ledger never contains verdict language and always declares no inference", () => {
    for (const t of DEMO_TOKENS) {
      const s = buildStatements(demoPassport(t.addr)!);
      for (const st of s) for (const re of BANNED) expect(st.text).not.toMatch(re);
      expect(s.find((x) => x.kind === "inference")?.text).toMatch(/None provided/);
    }
  });
  it("UI source contains no banned hype/verdict phrases", () => {
    const offenders: string[] = [];
    for (const f of [...files("src/app"), ...files("src/components")]) {
      const text = readFileSync(f, "utf8");
      // Only consider JSX text and string literals, not identifiers.
      const literals = [...text.matchAll(/>([^<>{}]+)</g), ...text.matchAll(/"([^"\n]{3,})"/g)].map((m) => m[1]);
      // Disclaimers that negate a term ("does not produce a trust score") are allowed.
      for (const l of literals) if (!/\b(not|no|never)\b/i.test(l)) for (const re of BANNED) if (re.test(l)) offenders.push(`${f}: ${l.trim()}`);
    }
    expect(offenders).toEqual([]);
  });
  it("demo passports are always flagged as demo", () => {
    for (const t of DEMO_TOKENS) expect(demoPassport(t.addr)!.demo).toBe(true);
  });
});
