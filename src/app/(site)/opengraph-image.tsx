import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "VibeProof Halloween edition: Proof over ghost stories. Evidence for vibe/vibe launches on Robinhood Chain.";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: 64,
        background: "#100d16",
        backgroundImage: "radial-gradient(ellipse at 90% 40%, #463048, #100d16 70%)",
        color: "#fff1db",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 24 }}>
        <span style={{ fontWeight: 700 }}>VibeProof</span>
        <span style={{ fontSize: 17, letterSpacing: 3, color: "#c1da96" }}>HAUNT THE CHAIN / HALLOWEEN EDITION</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", flex: 1, justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 85, fontWeight: 700, letterSpacing: -4 }}>Proof over</span>
          <span style={{ fontSize: 85, fontWeight: 700, letterSpacing: -4, color: "#ffa263" }}>ghost stories.</span>
          <span style={{ fontSize: 23, color: "#c0b0ca", marginTop: 24 }}>Trace the creators. Follow the evidence.</span>
        </div>
        <svg width="240" height="290" viewBox="0 0 240 290" fill="none">
          <circle cx="161" cy="81" r="64" fill="#d7bb8e" />
          <path
            d="M53 152c0-53 25-87 68-87 42 0 65 31 65 84v41c0 22 8 36 18 49-18 3-25-4-35-12-10 19-24 20-37 5-13 18-27 18-39 0-12 15-26 13-36-3-11 10-22 13-35 7 23-24 31-45 31-84Z"
            fill="#f4f0df"
          />
          <ellipse cx="104" cy="143" rx="8" ry="12" fill="#292333" />
          <ellipse cx="145" cy="140" rx="8" ry="12" fill="#292333" />
          <path d="M113 169q10 9 20-2" stroke="#6f6178" strokeWidth="3" strokeLinecap="round" />
          <path d="m204 161 3-9 3 9 9 3-9 3-3 9-3-9-9-3ZM25 81l3-9 3 9 9 3-9 3-3 9-3-9-9-3Z" fill="#c1da96" />
        </svg>
      </div>
      <div style={{ display: "flex", borderTop: "1px solid #46334e", paddingTop: 22, justifyContent: "space-between", color: "#c0b0ca", fontSize: 18 }}>
        <span>Contract data · Creator history · Product proof</span>
        <span>Robinhood Chain</span>
      </div>
    </div>,
    size,
  );
}
