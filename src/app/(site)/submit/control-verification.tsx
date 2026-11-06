"use client";
import { useState } from "react";
export function ControlVerification({ token }: { token: string }) {
  const [kind, setKind] = useState("website");
  const [target, setTarget] = useState("");
  const [challenge, setChallenge] = useState<{ id: string; challenge: string; path: string; expiresAt: string } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(action: "issue" | "verify") {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/proofs/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "issue" ? { action, token, kind, target } : { action, id: challenge?.id }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error?.message ?? "Control verification unavailable");
      if (action === "issue") setChallenge(body.data);
      else {
        setMessage(`Control verified until ${body.data.validUntil}. This proves control of the published challenge only.`);
        setChallenge(null);
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-8 border-t border-line pt-6">
      <h3 className="font-medium">Verify website or repository control</h3>
      <p className="my-2 text-sm text-fg-2">Publish a wallet-bound challenge. Control verification expires after seven days and does not certify legitimacy.</p>
      <label className="block text-sm">
        Evidence type
        <select
          className="input mt-2"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setChallenge(null);
          }}
        >
          <option value="website">Website domain</option>
          <option value="github">GitHub repository</option>
        </select>
      </label>
      <label className="mt-3 block text-sm">
        Public HTTPS URL
        <input
          type="url"
          className="input mt-2"
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setChallenge(null);
          }}
        />
      </label>
      <button type="button" className="btn btn-outline mt-3 px-4" disabled={busy || !target} onClick={() => run("issue")}>
        Issue challenge
      </button>
      {challenge && (
        <div className="mt-4 text-sm">
          <p>
            Publish this exact text at <code className="break-all">{challenge.path}</code> before {challenge.expiresAt}.
          </p>
          <pre className="my-3 whitespace-pre-wrap break-all">{challenge.challenge}</pre>
          <button type="button" className="btn btn-primary px-4" disabled={busy} onClick={() => run("verify")}>
            Check published challenge
          </button>
        </div>
      )}
      {message && (
        <p className="mt-3 text-sm" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
