import type { Metadata } from "next";
import { SubmitFlow } from "./submit-flow";
import { isDemoMode } from "@/lib/demo/mode";

export const metadata: Metadata = { title: "Submit project proof" };

export default async function SubmitPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl px-4 pt-10 md:px-6 md:pt-14">
      <p className="label">Creator</p>
      <h1 className="text-gradient mt-3 text-4xl font-medium leading-tight md:text-5xl">Verify your project</h1>
      <p className="mt-3 text-fg-2">Link the things that exist behind your token. VibeProof checks what it can independently observe and labels everything else as your claim. Only the wallet that launched the token can submit.</p>
      {isDemoMode() ? <p className="mt-6 rounded-[20px] border border-claimed/30 bg-claimed/5 p-4 text-sm text-claimed">Submissions are disabled in demo mode.</p> : <SubmitFlow initialToken={token ?? ""} registry={process.env.NEXT_PUBLIC_REGISTRY_ADDRESS || null} />}
    </div>
  );
}
