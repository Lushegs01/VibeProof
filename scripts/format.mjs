import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { check, format, resolveConfig } from "prettier";
import { readFile, writeFile } from "node:fs/promises";
const base = process.env.FORMAT_BASE_SHA || "HEAD";
// Check changed/new text only. Existing untouched formatting is preserved.
const changed = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACMR", "-z", base], { encoding: "utf8" }).split("\0");
const added = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0");
const files = [...new Set([...changed, ...added])].filter((p) => /\.(tsx?|mjs|ya?ml)$/.test(p) && existsSync(p) && !["AGENTS.md", "CLAUDE.md"].includes(p));
let failed = false;
for (const file of files) {
  const options = { ...(await resolveConfig(file)), filepath: file };
  const text = await readFile(file, "utf8");
  if (process.argv.includes("--write")) await writeFile(file, await format(text, options));
  else if (!(await check(text, options))) {
    console.error(`Formatting differs: ${file}`);
    failed = true;
  }
}
console.log(`${files.length} changed/new source files checked`);
if (failed) process.exitCode = 1;
