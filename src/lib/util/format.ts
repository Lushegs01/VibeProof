import { formatUnits } from "viem";

export function formatInt(n: number | bigint | null | undefined) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatCompact(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
}

export function formatToken(raw: bigint | string | null | undefined, decimals = 18, maxFrac = 4) {
  if (raw === null || raw === undefined) return "—";
  const v = Number(formatUnits(BigInt(raw), decimals));
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: maxFrac, notation: v >= 1e9 ? "compact" : "standard" }).format(v);
}

export function formatPct(n: number | null | undefined, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function timeAgo(date: Date | string | number | null | undefined, now = Date.now()) {
  if (!date) return "—";
  const t = new Date(date).getTime();
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function formatUtc(date: Date | string | null | undefined) {
  if (!date) return "—";
  return new Date(date).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function signed(n: number) {
  return n > 0 ? `+${formatInt(n)}` : n < 0 ? `−${formatInt(Math.abs(n))}` : "±0";
}
