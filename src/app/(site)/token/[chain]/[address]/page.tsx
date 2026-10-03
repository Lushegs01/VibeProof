import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAddress } from "viem";
import { getNetwork } from "@/lib/chain/networks";
import { parseAddress } from "@/lib/util/address";
import { getActivitySeries, getTokenPassport } from "@/lib/services/token-service";
import { PassportView } from "@/components/passport/passport-view";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ chain: string; address: string }> };

async function load(params: Props["params"]) {
  const { chain, address } = await params;
  const net = getNetwork(chain);
  if (!net) return null;
  const a = parseAddress(address) ?? parseAddress(address.toLowerCase());
  if (!a) return null;
  const [{ passport }, series] = await Promise.all([getTokenPassport(a, { network: net.slug }), getActivitySeries(a, 7, net.slug).catch(() => null)]);
  return passport ? { passport, series } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { chain, address } = await params;
  const net = getNetwork(chain);
  const a = parseAddress(address) ?? parseAddress(address.toLowerCase());
  if (!a || !net) return { title: "Invalid address" };
  const { passport } = await getTokenPassport(getAddress(a), { network: net.slug });
  const sym = passport?.symbol ? `$${passport.symbol}` : "Token";
  return { title: `${sym} Launch Passport`, description: `Contract facts, creator history, product proof and onchain activity for ${sym} on ${net.name}.` };
}

export default async function TokenPage({ params }: Props) {
  const data = await load(params);
  if (!data) notFound();
  return <PassportView p={data.passport} series={data.series} />;
}
