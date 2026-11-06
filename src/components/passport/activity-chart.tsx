import type { SeriesPoint } from "@/lib/services/token-service";

/** Server-rendered SVG bar chart. No client JS. */
export function ActivityChart({ series, height = 120 }: { series: SeriesPoint[]; height?: number }) {
  if (!series.length) return <p className="text-sm text-fg-2">No indexed events in the last 7 days.</p>;
  const max = Math.max(1, ...series.map((p) => p.transfers + p.buys + p.sells));
  const w = 100 / series.length;
  const total = series.reduce((a, p) => a + p.transfers + p.buys + p.sells, 0);
  return (
    <figure>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="h-[120px] w-full"
        role="img"
        aria-label={`Event activity: ${total} events across ${series.length} buckets`}
      >
        {series.map((p, i) => {
          const tH = (p.transfers / max) * (height - 4);
          const bH = (p.buys / max) * (height - 4);
          const sH = (p.sells / max) * (height - 4);
          const x = i * w + w * 0.15;
          const bw = w * 0.7;
          return (
            <g key={p.t}>
              <title>{`${new Date(p.t).toISOString().slice(0, 13).replace("T", " ")}:00 UTC · ${p.transfers} transfers · ${p.buys} buys · ${p.sells} sells`}</title>
              <rect x={x} y={height - tH} width={bw} height={tH} fill="var(--color-muted)" />
              <rect x={x} y={height - tH - bH} width={bw} height={bH} fill="var(--color-accent)" opacity={0.75} />
              <rect x={x} y={height - tH - bH - sH} width={bw} height={sH} fill="var(--color-observed)" opacity={0.7} />
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-3 flex flex-wrap gap-4 text-xs text-fg-2">
        <Legend color="var(--color-muted)" label="Transfers" />
        <Legend color="var(--color-accent)" label="Curve buys" />
        <Legend color="var(--color-observed)" label="Curve sells" />
        <span className="ml-auto font-mono">
          {new Date(series[0].t).toISOString().slice(5, 13).replace("T", " ")}h →{" "}
          {new Date(series[series.length - 1].t).toISOString().slice(5, 13).replace("T", " ")}h UTC
        </span>
      </figcaption>
    </figure>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2 rounded-[1px]" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}
