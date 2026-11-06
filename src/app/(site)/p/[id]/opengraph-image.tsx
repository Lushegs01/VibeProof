import { ImageResponse } from "next/og";
import { getAddress } from "viem";
import { resolveShareId } from "@/lib/services/share-service";
import { getTokenPassport } from "@/lib/services/token-service";
import { getNetworkByChainId } from "@/lib/chain/networks";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "VibeProof Launch Passport";

/** OG card: facts only. Never claims safety or investment quality. */
export default async function OgImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await resolveShareId(id);
  const network = token ? getNetworkByChainId(token.chainId) : null;
  const p = token && network ? (await getTokenPassport(getAddress(token.address), { network: network.slug })).passport : null;
  const sym = p?.symbol ? `$${p.symbol}` : "Launch";
  const rows: [string, string][] = p
    ? [
        ["Contract source", p.contract.sourceVerified === null ? "Unavailable" : p.contract.sourceVerified ? "Verified" : "Not verified"],
        ["Product proof", `${p.proof.score.observed}/${p.proof.score.total} observed`],
        ["Holders", p.activity.holders.value === null ? "Unavailable" : Number(p.activity.holders.value).toLocaleString("en-US")],
        ["Transactions", p.activity.transactions.value === null ? "Unavailable" : Number(p.activity.transactions.value).toLocaleString("en-US")],
      ]
    : [];
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#100d16",
        color: "#fff1db",
        padding: 72,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 22, letterSpacing: 6, color: "#c0b0ca" }}>
        <div
          style={{
            width: 22,
            height: 22,
            border: "2px solid #fff1db",
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffa263",
            fontSize: 16,
          }}
        >
          ✓
        </div>
        VIBEPROOF
        {p?.demo ? <span style={{ marginLeft: 16, color: "#d1b4f3" }}>· DEMO DATA</span> : null}
      </div>
      <div style={{ marginTop: 56, fontSize: 96, fontWeight: 700, letterSpacing: -2 }}>{sym}</div>
      <div style={{ fontSize: 34, color: "#c0b0ca", marginTop: 4 }}>Launch Passport · Halloween edition</div>
      <div style={{ display: "flex", marginTop: "auto", borderTop: "1px solid #493451", paddingTop: 32, gap: 56 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 18, color: "#c0b0ca", letterSpacing: 2, textTransform: "uppercase" }}>{k}</div>
            <div style={{ fontSize: 36, marginTop: 8 }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 28, fontSize: 18, color: "#c0b0ca" }}>{network?.name ?? "Robinhood Chain"} · evidence, not advice</div>
    </div>,
    size,
  );
}
