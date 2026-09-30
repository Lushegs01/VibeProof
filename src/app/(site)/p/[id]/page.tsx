import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAddress } from "viem";
import { resolveShareId } from "@/lib/services/share-service";
import { getActivitySeries, getTokenPassport } from "@/lib/services/token-service";
import { PassportView } from "@/components/passport/passport-view";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };

async function load(id: string) {
  const token = await resolveShareId(id);
  if (!token) return null;
  const a = getAddress(token);
  const [{ passport }, series] = await Promise.all([getTokenPassport(a), getActivitySeries(a).catch(() => null)]);
  return passport ? { passport, series } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const d = await load(id);
  if (!d) return { title: "Passport not found" };
  const p = d.passport;
  const sym = p.symbol ? `$${p.symbol}` : "Token";
  const parts = [
    p.contract.sourceVerified ? "Contract source verified" : "Contract source not verified",
    `Product proof: ${p.proof.score.observed}/${p.proof.score.total}`,
    p.activity.holders.value !== null ? `${Number(p.activity.holders.value).toLocaleString("en-US")} holders` : null,
    p.activity.transactions.value !== null ? `${Number(p.activity.transactions.value).toLocaleString("en-US")} transactions` : null,
  ].filter(Boolean);
  return {
    title: `${sym} Launch Passport`,
    description: parts.join(" · "),
    openGraph: { title: `VibeProof · ${sym} Launch Passport`, description: parts.join(" · ") },
    twitter: { card: "summary_large_image", title: `VibeProof · ${sym} Launch Passport`, description: parts.join(" · ") },
  };
}

export default async function SharedPassport({ params }: Props) {
  const { id } = await params;
  const d = await load(id);
  if (!d) notFound();
  return <PassportView p={d.passport} series={d.series} publicView />;
}
