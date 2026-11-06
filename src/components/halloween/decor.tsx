/**
 * "Haunt the Chain" (vibe/vibe Builder Foundry, Halloween 2026) decorations.
 * Pure server-rendered SVG/CSS, decorative only: every piece is aria-hidden and
 * pointer-events-none, so none of it changes what the page says or does.
 */
import { cn } from "@/lib/util/cn";

/* ── Pixel jack-o'-lantern (a nod to the event's voxel pumpkin) ───── */
// 12×12 grid. Body rows as [y, x0, x1] spans; face pixels drawn on top.
const BODY: [number, number, number][] = [
  [2, 3, 8],
  [3, 1, 10],
  [4, 0, 11],
  [5, 0, 11],
  [6, 0, 11],
  [7, 0, 11],
  [8, 0, 11],
  [9, 0, 11],
  [10, 1, 10],
  [11, 3, 8],
];
const FACE: [number, number][] = [
  // eyes
  [3, 4], [2, 5], [3, 5], [4, 5],
  [8, 4], [7, 5], [8, 5], [9, 5],
  // grin with two teeth
  [2, 7], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8], [9, 7],
  [4, 9], [5, 9], [6, 9], [7, 9],
  [6, 8],
];

/** `size` sets explicit pixel dimensions (used by the OG image renderer, which ignores classes). */
export function PixelPumpkin({ className = "size-4", size }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} className={size ? undefined : className} shapeRendering="crispEdges" aria-hidden>
      <rect x="5" y="0" width="2" height="2" fill="#6b3d1f" />
      <rect x="7" y="0" width="2" height="1" fill="#7bc043" />
      <rect x="8" y="1" width="1" height="1" fill="#7bc043" />
      {BODY.map(([y, x0, x1]) => (
        <rect key={y} x={x0} y={y} width={x1 - x0 + 1} height="1" fill="#ff8a1f" />
      ))}
      <rect x="0" y="9" width="12" height="1" fill="#e06a0a" />
      <rect x="1" y="10" width="10" height="1" fill="#c24e00" />
      <rect x="3" y="11" width="6" height="1" fill="#a33f00" />
      {FACE.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#d9ff3d" />
      ))}
    </svg>
  );
}

/* ── Bat silhouette ─────────────────────────────────────────────── */
const BAT_PATH =
  "M32 11c-1.5 0-2.4-2.4-3.2-4.4-.6 1.7-.9 3-.9 4.2-3.5-.4-7-2.7-9.8-6.3-.2 4.3-2.5 7.3-6.1 8.1-1.7-2.9-4.7-4.7-8.2-4.3 3.7 2.5 5.7 6.5 5.5 10.8 2.9-1.6 6.1-1.4 8.6.6.6-2.7 2.9-4.5 5.5-4.5.4 2.7 2.3 4.9 4.9 5.7L32 27l3.7-6.1c2.6-.8 4.5-3 4.9-5.7 2.6 0 4.9 1.8 5.5 4.5 2.5-2 5.7-2.2 8.6-.6-.2-4.3 1.8-8.3 5.5-10.8-3.5-.4-6.5 1.4-8.2 4.3-3.6-.8-5.9-3.8-6.1-8.1-2.8 3.6-6.3 5.9-9.8 6.3 0-1.2-.3-2.5-.9-4.2-.8 2-1.7 4.4-3.2 4.4Z";

export function Bat({ className, style, fill = "#3a2140" }: { className?: string; style?: React.CSSProperties; fill?: string }) {
  return (
    <span className={cn("bat absolute block", className)} style={style}>
      <svg viewBox="0 0 64 32" className="block h-auto w-full" aria-hidden>
        <path d={BAT_PATH} fill={fill} />
      </svg>
    </span>
  );
}

/* ── Corner cobweb (anchored top-left; mirror with -scale-x-100) ─── */
const WEB_R = 200;
const WEB_ANGLES = [0, 16, 33, 50, 67, 84, 90].map((d) => (d * Math.PI) / 180);
const WEB_RINGS = [34, 66, 102, 142, 184];

function webPath() {
  const pt = (r: number, a: number) => [r * Math.cos(a), r * Math.sin(a)] as const;
  const spokes = WEB_ANGLES.map((a) => {
    const [x, y] = pt(WEB_R, a);
    return `M0 0L${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const rings = WEB_RINGS.map((r) => {
    let d = "";
    WEB_ANGLES.forEach((a, i) => {
      const [x, y] = pt(r, a);
      if (i === 0) {
        d += `M${x.toFixed(1)} ${y.toFixed(1)}`;
        return;
      }
      // Sag each strand toward the corner, like silk under its own weight.
      const mid = (WEB_ANGLES[i - 1] + a) / 2;
      const [cx, cy] = pt(r * 0.86, mid);
      d += `Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    return d;
  });
  return [...spokes, ...rings].join("");
}
const WEB_D = webPath();

export function Cobweb({ className }: { className?: string }) {
  return (
    <svg viewBox={`0 0 ${WEB_R} ${WEB_R}`} className={cn("pointer-events-none absolute", className)} fill="none" aria-hidden>
      <path d={WEB_D} stroke="#f6e3cb" strokeOpacity=".16" strokeWidth="1" />
    </svg>
  );
}

/* ── Dangling spider ─────────────────────────────────────────────── */
export function Spider({ className, drop = 120 }: { className?: string; drop?: number }) {
  return (
    <span className={cn("spider absolute block w-6", className)} aria-hidden>
      <svg viewBox={`0 0 24 ${drop + 20}`} className="block w-full overflow-visible" style={{ height: drop + 20 }}>
        <line x1="12" y1="0" x2="12" y2={drop} stroke="#f6e3cb" strokeOpacity=".28" strokeWidth=".8" />
        <g transform={`translate(12 ${drop + 6})`} stroke="#4a2b47" strokeWidth="1.3" strokeLinecap="round" fill="none">
          <path d="M-3-2-9-7-11-3M-3 0-10-1-12 3M-3 2-9 5-10 9M3-2 9-7 11-3M3 0 10-1 12 3M3 2 9 5 10 9" />
        </g>
        <ellipse cx="12" cy={drop + 6} rx="4.2" ry="5" fill="#2a1830" stroke="#4a2b47" />
        <circle cx="10.6" cy={drop + 3.4} r=".9" fill="#d9ff3d" />
        <circle cx="13.4" cy={drop + 3.4} r=".9" fill="#d9ff3d" />
      </svg>
    </span>
  );
}

/* ── Hero scene: cobweb, spider, harvest moon and a few bats ─────── */
export function HeroDecor() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
      <Cobweb className="left-0 top-0 w-32 md:w-60" />
      <Spider className="left-[4.5rem] top-0 hidden xl:block" drop={150} />
      <Cobweb className="right-0 top-0 hidden w-36 -scale-x-100 opacity-70 lg:block" />
      {/* Moon sits above the headline's first line until there is room beside it (xl). */}
      <div className="absolute right-[5%] top-6 hidden md:block xl:right-[4%] xl:top-12">
        <div className="night-orb size-24 xl:size-32" />
        <Bat className="-left-7 top-7 w-14 xl:top-10" fill="#1a0d1c" style={{ animationDelay: "-2s" }} />
      </div>
      <Bat className="right-[3%] top-60 hidden w-9 xl:block" style={{ animationDelay: "-4.5s" }} />
      <Bat className="left-[11%] top-[46%] hidden w-10 xl:block" style={{ animationDelay: "-1s" }} />
      <Bat className="right-4 top-6 w-8 md:hidden" style={{ animationDelay: "-3s" }} />
      <Bat className="right-16 top-14 w-5 md:hidden" style={{ animationDelay: "-5s" }} />
    </div>
  );
}

/* ── Event badge ─────────────────────────────────────────────────── */
export function HauntBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full border border-ghost/50 bg-ghost/[0.06] py-1.5 pl-2.5 pr-3.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ghost", className)}>
      <PixelPumpkin className="lantern-glow size-4" />
      Haunt the Chain
      <span className="hidden text-ghost/70 sm:inline">· Halloween edition</span>
    </span>
  );
}
