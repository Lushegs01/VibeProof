"use client";
import { useState } from "react";
type Result = { status: string; metadataHash: string; metadataUri: string; checkedAt: string; explanation: string; creatorAuthority: string };
export function IndependentProof({
  chain,
  token,
  creator,
  txHash,
  launchTx,
}: {
  chain: string;
  token: string;
  creator: string;
  txHash: string;
  launchTx?: string;
}) {
  const [result, setResult] = useState<Result | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function verify() {
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams({ network: chain, token, creator, txHash, ...(launchTx ? { launchTx } : {}) });
      const response = await fetch(`/api/proofs/verify?${query}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Verification unavailable");
      setResult(body.data);
    } catch (e) {
      setResult(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 text-xs">
      <button type="button" onClick={verify} disabled={busy} className="btn btn-outline h-9 px-3">
        {busy ? "Verifying…" : "Independently verify commitment"}
      </button>
      <div role="status" className="mt-2">
        {error ||
          (!result ? (
            "Independent verification has not been run in this view."
          ) : (
            <>
              <strong>{result.status.replaceAll("_", " ")}</strong>
              <p className="mt-1 break-all">Hash: {result.metadataHash}</p>
              <p className="break-all">Document: {result.metadataUri}</p>
              <p>
                Checked {result.checkedAt} · Creator authority: {result.creatorAuthority.replaceAll("_", " ")}
              </p>
              <p className="mt-1 text-fg-2">{result.explanation}</p>
            </>
          ))}
      </div>
    </div>
  );
}
