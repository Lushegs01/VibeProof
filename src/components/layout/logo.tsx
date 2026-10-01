export function LogoMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id="vp-mark" x1="2" y1="26" x2="26" y2="2" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0B65A3" />
          <stop offset=".55" stopColor="#5CC6EA" />
          <stop offset="1" stopColor="#D3E3E6" />
        </linearGradient>
      </defs>
      <path d="M14 2.5 24.5 8.5v11L14 25.5 3.5 19.5v-11L14 2.5Z" stroke="url(#vp-mark)" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="m9 14.2 3.4 3.4L19.2 10" stroke="#D3E3E6" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
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
