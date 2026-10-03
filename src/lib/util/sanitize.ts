/**
 * Strings from the chain (token names, symbols, metadata) are attacker-controlled.
 *
 * Postgres rejects U+0000 in `text` and `jsonb`, and lone UTF-16 surrogates cannot be encoded
 * as UTF-8. A single such launch would make its whole range transaction fail forever and stall
 * the indexer, so they are removed before persistence. For display fields we also drop other
 * control characters and bidi overrides (which can visually spoof a name, "Trojan Source").
 */
// eslint-disable-next-line no-control-regex
const STORAGE_UNSAFE = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
// eslint-disable-next-line no-control-regex
const DISPLAY_UNSAFE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‪-‮⁦-⁩‎‏؜]/g;

/** Safe to store in Postgres text/jsonb. Content otherwise preserved. */
export function storageSafe(s: string): string {
  return s.replace(STORAGE_UNSAFE, "");
}

/** Single-line display text: storage-safe, no control/bidi characters, length-capped. */
export function displayText(s: string | null | undefined, max = 200): string | null {
  if (s === null || s === undefined) return null;
  const out = storageSafe(s).replace(DISPLAY_UNSAFE, "").replace(/[\r\n\t]+/g, " ");
  return out.length > max ? out.slice(0, max) : out;
}

/** Recursively make a JSON-like value storage-safe (strings in keys and values), with depth/size caps. */
export function jsonSafe(value: unknown, depth = 0): unknown {
  if (depth > 12) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return storageSafe(value);
  if (Array.isArray(value)) return value.slice(0, 500).map((v) => jsonSafe(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value).slice(0, 500)) out[storageSafe(k)] = jsonSafe(v, depth + 1);
    return out;
  }
  return value;
}
