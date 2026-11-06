import type { Metadata } from "next";
import { evidenceStorageDisclosure } from "@/lib/proof/storage";
import { SubmitFlow } from "./submit-flow";
import { activeNetwork } from "@/lib/chain/networks";
import { isDemoMode } from "@/lib/demo/mode";

export const metadata: Metadata = { title: "Submit project proof" };

export default async function SubmitPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const confirmations = Number(process.env.PROOF_CONFIRMATIONS ?? 12);
  if (!Number.isSafeInteger(confirmations) || confirmations < 1) throw new Error("Invalid proof confirmation policy");
  return (
    <div className="mx-auto max-w-2xl px-4 pt-10 md:px-6 md:pt-14">
      <p className="edition-label">Creator · Leave a paper trail</p>
      <h1 className="text-gradient mt-3 text-4xl font-medium leading-tight md:text-5xl">Verify your project</h1>
      <p className="mt-3 text-fg-2">
        Link the things that exist behind your token. VibeProof checks what it can independently observe and labels everything else as your claim. Only the
        wallet that launched the token can submit.
      </p>
      {isDemoMode() ? (
        <p className="mt-6 rounded-[20px] border border-claimed/30 bg-claimed/5 p-4 text-sm text-claimed">Submissions are disabled in demo mode.</p>
      ) : (
        <SubmitFlow
          initialToken={token ?? ""}
          confirmations={confirmations}
          storageDisclosure={evidenceStorageDisclosure()}
          registry={
            (activeNetwork().slug === "robinhood-mainnet" ? process.env.ROBINHOOD_MAINNET_REGISTRY_ADDRESS : process.env.NEXT_PUBLIC_REGISTRY_ADDRESS) || null
          }
        />
      )}
    </div>
  );
}
