"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http, useAccount, useConnect, useDisconnect, useSignMessage, useSwitchChain, useWriteContract, usePublicClient } from "wagmi";
import { injected } from "wagmi/connectors";
import { createSiweMessage } from "viem/siwe";
import { Check, Loader2, Wallet } from "lucide-react";
import { robinhoodTestnet } from "@/lib/chain/chains";
import { REGISTRY_ABI } from "@/lib/registry/abi";
import { shortAddress } from "@/lib/util/address";
import { StateBadge } from "@/components/ui/state-badge";
import type { UrlCheckResult } from "@/lib/proof/checks";

const config = createConfig({ chains: [robinhoodTestnet], connectors: [injected()], transports: { [robinhoodTestnet.id]: http() }, ssr: true });
const qc = new QueryClient();

export function SubmitFlow(props: { initialToken: string; registry: string | null }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={qc}>
        <Flow {...props} />
      </QueryClientProvider>
    </WagmiProvider>
  );
}

const FIELDS = [
  { k: "websiteUrl", label: "Website", ph: "https://yourproject.xyz", hint: "Checked for reachability and TLS. Include your contract address on the page to reach “verified”." },
  { k: "githubUrl", label: "GitHub", ph: "https://github.com/org/repo", hint: "Public repository. Mention the contract address in the README to reach “verified”." },
  { k: "demoUrl", label: "Demo", ph: "https://app.yourproject.xyz", hint: "A working URL people can open." },
  { k: "docsUrl", label: "Documentation", ph: "https://docs.yourproject.xyz", hint: "" },
  { k: "twitterUrl", label: "X / Twitter", ph: "https://x.com/yourproject", hint: "Recorded as a creator claim." },
  { k: "discordUrl", label: "Discord", ph: "https://discord.gg/…", hint: "Recorded as a creator claim." },
] as const;

type Result = { metadataHash: `0x${string}`; basis: string; checks: UrlCheckResult[] };

function Flow({ initialToken, registry }: { initialToken: string; registry: string | null }) {
  const { address, isConnected, chainId } = useAccount();
  const { connect, isPending: connecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [session, setSession] = useState<string | null>(null);
  const [token, setToken] = useState(initialToken);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<null | "signin" | "submit" | "anchor">(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [anchorTx, setAnchorTx] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((j) => setSession(j.data?.address ?? null))
      .catch(() => null);
  }, []);
  const signedIn = !!session && !!address && session.toLowerCase() === address.toLowerCase();

  async function signIn() {
    if (!address) return;
    setBusy("signin");
    setError(null);
    try {
      if (chainId !== robinhoodTestnet.id) await switchChainAsync({ chainId: robinhoodTestnet.id });
      const { data } = await (await fetch("/api/auth/nonce")).json();
      const message = createSiweMessage({
        domain: location.host,
        address,
        statement: "Sign in to VibeProof to submit project proof. This signature does not authorise any transaction or spend.",
        uri: location.origin,
        version: "1",
        chainId: robinhoodTestnet.id,
        nonce: data.nonce,
        issuedAt: new Date(),
        expirationTime: new Date(Date.now() + 10 * 60_000),
      });
      const signature = await signMessageAsync({ message });
      const r = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? "Sign-in failed");
      setSession(j.data.address);
    } catch (e) {
      setError((e as Error).message.split("\n")[0]);
    } finally {
      setBusy(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy("submit");
    setError(null);
    try {
      const body = { token: token.trim(), ...Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim())) };
      const r = await fetch("/api/proofs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.issues?.map((i: { path: string; message: string }) => `${i.path}: ${i.message}`).join("; ") || j.error?.message || "Submission failed");
      setResult(j.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function anchor() {
    if (!registry || !result || !publicClient) return;
    setBusy("anchor");
    setError(null);
    try {
      const uri = `${location.origin}/api/tokens/${token.trim()}/proof`;
      const has = await publicClient.readContract({ address: registry as `0x${string}`, abi: REGISTRY_ABI, functionName: "hasProof", args: [address!, token.trim() as `0x${string}`] });
      const hash = await writeContractAsync({ address: registry as `0x${string}`, abi: REGISTRY_ABI, functionName: has ? "updateProof" : "submitProof", args: [token.trim() as `0x${string}`, result.metadataHash, uri], chainId: robinhoodTestnet.id });
      await publicClient.waitForTransactionReceipt({ hash });
      const r = await fetch("/api/proofs/anchor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: token.trim(), txHash: hash }) });
      if (!r.ok) throw new Error((await r.json()).error?.message ?? "Anchor verification failed");
      setAnchorTx(hash);
    } catch (e) {
      setError((e as Error).message.split("\n")[0]);
    } finally {
      setBusy(null);
    }
  }

  if (result)
    return (
      <div className="mt-10 rounded-md border border-line bg-surface p-6">
        <h2 className="text-xl font-medium">Your Project Passport</h2>
        <ul className="mt-6 divide-y divide-line/70">
          <li className="flex items-center justify-between py-3">
            <span>Contract</span>
            <span className="flex items-center gap-2 text-sm text-accent">
              <Check className="size-4" /> {result.basis === "launch_creator" ? "Launch creator confirmed" : "Contract owner confirmed"}
            </span>
          </li>
          {result.checks.map((c) => (
            <li key={c.type} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="capitalize">{c.type === "github" ? "GitHub" : c.type}</div>
                <div className="truncate text-xs text-fg-2">{c.summary}</div>
              </div>
              <StateBadge state={c.state} />
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-fg-2">Your submission is now observable through VibeProof. Checks are re-run periodically; nothing here is a certification.</p>
        <p className="mt-2 break-all font-mono text-xs text-muted">metadata hash {result.metadataHash}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={`/token/robinhood-testnet/${token.trim()}`} className="rounded-md border border-accent/30 bg-accent-dim px-4 py-2 text-sm text-accent">
            View Launch Passport
          </Link>
          {registry && !anchorTx ? (
            <button type="button" onClick={anchor} disabled={busy === "anchor"} className="inline-flex items-center gap-2 rounded-md border border-line px-4 py-2 text-sm hover:border-line-strong">
              {busy === "anchor" ? <Loader2 className="size-4 animate-spin" /> : null} Anchor hash onchain (optional)
            </button>
          ) : null}
          {anchorTx ? <span className="self-center font-mono text-xs text-accent">Anchored · {shortAddress(anchorTx, 6, 4)}</span> : null}
        </div>
        {error ? <p className="mt-4 text-sm text-attention">{error}</p> : null}
      </div>
    );

  return (
    <div className="mt-10 space-y-8">
      <ol className="space-y-6">
        <Step n={1} title="Connect the launch wallet" done={isConnected}>
          {isConnected ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="font-mono">{shortAddress(address!)}</span>
              <button type="button" onClick={() => disconnect()} className="text-fg-2 hover:text-fg">
                Disconnect
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => connect({ connector: injected() })} disabled={connecting} className="inline-flex items-center gap-2 rounded-md border border-line px-4 py-2 text-sm hover:border-line-strong">
              {connecting ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />} Connect browser wallet
            </button>
          )}
          {connectError ? <p className="mt-2 text-sm text-attention">{connectError.message.split("\n")[0]}</p> : null}
        </Step>
        <Step n={2} title="Sign in with Ethereum" done={signedIn}>
          {signedIn ? (
            <p className="text-sm text-fg-2">Signed in. No transaction was sent.</p>
          ) : (
            <button type="button" onClick={signIn} disabled={!isConnected || busy === "signin"} className="inline-flex items-center gap-2 rounded-md border border-line px-4 py-2 text-sm hover:border-line-strong disabled:opacity-40">
              {busy === "signin" ? <Loader2 className="size-4 animate-spin" /> : null} Sign message
            </button>
          )}
          <p className="mt-2 text-xs text-muted">VibeProof will never ask for a seed phrase or private key.</p>
        </Step>
      </ol>

      <form onSubmit={submit} className="space-y-5" aria-disabled={!signedIn}>
        <Field label="Token contract" required>
          <input value={token} onChange={(e) => setToken(e.target.value)} required pattern="^0x[0-9a-fA-F]{40}$" placeholder="0x…" className="input font-mono" aria-describedby="token-hint" />
          <p id="token-hint" className="mt-1 text-xs text-muted">
            Must be a token launched by the connected wallet.
          </p>
        </Field>
        {FIELDS.map((f) => (
          <Field key={f.k} label={f.label}>
            <input type="url" inputMode="url" value={form[f.k] ?? ""} onChange={(e) => setForm((s) => ({ ...s, [f.k]: e.target.value }))} placeholder={f.ph} className="input" aria-describedby={`${f.k}-hint`} />
            {f.hint ? (
              <p id={`${f.k}-hint`} className="mt-1 text-xs text-muted">
                {f.hint}
              </p>
            ) : null}
          </Field>
        ))}
        <Field label="Short description (shown as a creator claim)">
          <textarea value={form.description ?? ""} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} maxLength={500} rows={3} className="input" />
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-attention">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={!signedIn || busy === "submit"} className="inline-flex h-11 items-center gap-2 rounded-md bg-fg px-5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-30">
          {busy === "submit" ? <Loader2 className="size-4 animate-spin" /> : null} Generate passport
        </button>
      </form>
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs ${done ? "border-accent/50 text-accent" : "border-line text-fg-2"}`}>{done ? <Check className="size-3.5" /> : n}</span>
      <div className="flex-1">
        <h2 className="mb-2 font-medium">{title}</h2>
        {children}
      </div>
    </li>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-2 block">
        {label}
        {required ? <span className="text-attention"> *</span> : null}
      </span>
      {children}
    </label>
  );
}
