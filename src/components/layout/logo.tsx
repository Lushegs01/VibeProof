/** Hex-and-check mark, in its Halloween form: pumpkin-lit, with a stem and leaf. */
export function LogoMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id="vp-mark" x1="2" y1="26" x2="26" y2="2" gradientUnits="userSpaceOnUse">
          <stop stopColor="#C24E00" />
          <stop offset=".55" stopColor="#FF8A1F" />
          <stop offset="1" stopColor="#FFD29A" />
        </linearGradient>
      </defs>
      <path d="M14 3.2V1.6c0-.6.4-1.1 1-1.2" stroke="#7BC043" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M15.3 1.9c1.2-1 2.8-1.1 3.9-.3-1 1-2.6 1.2-3.9.3Z" fill="#7BC043" />
      <path d="M14 3.5 24.5 9v10.5L14 25.5 3.5 19.5V9L14 3.5Z" fill="#FF8A1F" fillOpacity=".1" stroke="url(#vp-mark)" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="m9 14.6 3.4 3.4L19.2 10.4" stroke="#F6E3CB" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
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
