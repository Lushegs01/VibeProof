import { notFound } from "next/navigation";
import { parseAddress } from "@/lib/util/address";
import { getTokenPassport } from "@/lib/services/token-service";

export const dynamic = "force-dynamic";

/**
 * Embeddable badge (iframe): <iframe src="https://<host>/embed/badge/0x…" width="320" height="120" />
 * Facts only; links back to the full passport.
 */
export default async function Badge({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const a = parseAddress(address) ?? parseAddress(address.toLowerCase());
  if (!a) notFound();
  const { passport: p } = await getTokenPassport(a);
  if (!p) notFound();
  const app = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return (
    <a href={`${app}/token/${p.chain}/${p.address}`} target="_blank" rel="noopener noreferrer" className="fixed inset-0 flex flex-col justify-between border border-line bg-bg p-4 text-fg">
      <div className="flex items-center justify-between font-mono text-[11px] tracking-[0.18em] text-fg-2">
        VIBEPROOF {p.demo ? <span className="text-claimed">DEMO</span> : null}
      </div>
      <ul className="space-y-0.5 text-sm">
        <li>{p.contract.sourceVerified ? "Contract verified" : p.contract.sourceVerified === false ? "Contract source not verified" : "Contract: unavailable"}</li>
        <li>
          Product proof {p.proof.score.observed}/{p.proof.score.total}
        </li>
        <li>{p.activity.holders.value !== null ? `${Number(p.activity.holders.value).toLocaleString("en-US")} holders` : "Holders unavailable"}</li>
      </ul>
    </a>
  );
}
