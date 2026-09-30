import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAddress } from "viem";
import { getChainConfig } from "@/lib/chain/chains";
import { parseAddress } from "@/lib/util/address";
import { getActivitySeries, getTokenPassport } from "@/lib/services/token-service";
import { PassportView } from "@/components/passport/passport-view";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ chain: string; address: string }> };

async function load(params: Props["params"]) {
  const { chain, address } = await params;
  if (!getChainConfig(chain)) return null;
  const a = parseAddress(address) ?? parseAddress(address.toLowerCase());
  if (!a) return null;
  const [{ passport }, series] = await Promise.all([getTokenPassport(a), getActivitySeries(a).catch(() => null)]);
  return passport ? { passport, series } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address } = await params;
  const a = parseAddress(address) ?? parseAddress(address.toLowerCase());
  if (!a) return { title: "Invalid address" };
  const { passport } = await getTokenPassport(getAddress(a));
  const sym = passport?.symbol ? `$${passport.symbol}` : "Token";
  return { title: `${sym} Launch Passport`, description: `Contract facts, creator history, product proof and onchain activity for ${sym} on Robinhood Chain Testnet.` };
}

export default async function TokenPage({ params }: Props) {
  const data = await load(params);
  if (!data) notFound();
  return <PassportView p={data.passport} series={data.series} />;
}
