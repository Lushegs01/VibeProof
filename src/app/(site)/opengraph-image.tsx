import { ImageResponse } from "next/og";
import { PixelPumpkin } from "@/components/halloween/decor";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "VibeProof · Know what was launched on Robinhood Chain (Haunt the Chain edition)";

/** Site share card, Halloween edition. Static: no data, no claims about any token. */
export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          background: "radial-gradient(ellipse 110% 70% at 50% 124%, #ff7a1a 0%, #c24e00 26%, #4a1a3e 52%, #07040a 78%)",
          color: "#f8efe4",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            right: 90,
            top: 70,
            width: 150,
            height: 150,
            borderRadius: 9999,
            background: "radial-gradient(circle at 38% 34%, #fff8ea 0%, #f8e2bb 48%, #e2bf8a 100%)",
            boxShadow: "0 0 80px 20px #ffd9a033",
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            alignSelf: "flex-start",
            border: "2px solid #d9ff3d88",
            borderRadius: 9999,
            padding: "10px 22px 10px 14px",
            fontSize: 22,
            letterSpacing: 4,
            color: "#d9ff3d",
          }}
        >
          <PixelPumpkin size={30} />
          HAUNT THE CHAIN · HALLOWEEN EDITION
        </div>
        <div style={{ display: "flex", marginTop: 56, fontSize: 104, fontWeight: 700, letterSpacing: -3 }}>VibeProof</div>
        <div style={{ display: "flex", fontSize: 44, marginTop: 8, color: "#ffbf80" }}>Know what was launched on Robinhood Chain.</div>
        <div style={{ display: "flex", marginTop: "auto", fontSize: 24, color: "#f6e3cb" }}>Launch Passports for vibe/vibe launches · evidence, not verdicts</div>
      </div>
    ),
    size,
  );
}
