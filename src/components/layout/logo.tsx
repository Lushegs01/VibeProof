import { useId } from "react";
export function LogoMark({ className = "size-6" }: { className?: string }) {
  const gradient = useId();
  return (
    <svg viewBox="0 0 28 28" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={gradient} x1="2" y1="26" x2="26" y2="2" gradientUnits="userSpaceOnUse">
          <stop stopColor="#bd5d35" />
          <stop offset=".55" stopColor="#ffa263" />
          <stop offset="1" stopColor="#ffe5b8" />
        </linearGradient>
      </defs>
      <path d="M14 2.5 24.5 8.5v11L14 25.5 3.5 19.5v-11L14 2.5Z" stroke={`url(#${gradient})`} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="m9 14.2 3.4 3.4L19.2 10" stroke="#ffe5b8" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className="font-display text-[19px] font-medium tracking-[-0.03em] text-fg">VibeProof</span>
    </span>
  );
}
