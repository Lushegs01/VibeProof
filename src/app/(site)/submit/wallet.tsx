"use client";

import { useEffect, useState } from "react";
import { createConfig, http, useConnect, useConnectors, type Connector } from "wagmi";
import { injected, metaMask, walletConnect } from "wagmi/connectors";
import { Loader2, Smartphone, Wallet } from "lucide-react";
import { robinhoodTestnet } from "@/lib/chain/chains";

const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vibeproof.app";

/**
 * Connectors:
 *  - injected(): the generic window.ethereum wallet. EIP-6963 discovery (on by default) adds one
 *    connector per installed extension (MetaMask, Rabby, Coinbase Wallet, …) with its own name/icon.
 *  - metaMask(): works WITHOUT an extension — QR code / deep link to the MetaMask mobile app.
 *  - walletConnect(): any mobile wallet via QR; only when NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is set.
 */
export const wagmiConfig = createConfig({
  chains: [robinhoodTestnet],
  connectors: [
    injected(),
    metaMask({ dappMetadata: { name: "VibeProof", url: appUrl } }),
    ...(wcProjectId ? [walletConnect({ projectId: wcProjectId, metadata: { name: "VibeProof", description: "Submit project proof for a vibe/vibe launch", url: appUrl, icons: [] }, showQrModal: true })] : []),
  ],
  transports: { [robinhoodTestnet.id]: http() },
  ssr: true,
});

/** Human-readable wallet errors instead of raw library messages. */
export function walletErrorMessage(e: unknown): string {
  const err = e as { name?: string; message?: string; shortMessage?: string; code?: number } | null;
  const name = err?.name ?? "";
  const msg = err?.shortMessage ?? err?.message ?? "";
  if (name === "ProviderNotFoundError" || /provider not found/i.test(msg)) return "No browser wallet was found in this browser. Use one of the options below.";
  if (name === "UserRejectedRequestError" || err?.code === 4001 || /user rejected|denied/i.test(msg)) return "The request was rejected in your wallet.";
  if (/already pending|-32002/i.test(msg) || err?.code === -32002) return "Your wallet already has a pending request. Open the wallet to continue.";
  return msg.split("\n")[0] || "The wallet could not connect.";
}

function hasInjectedProvider() {
  return typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum;
}

function isMobile() {
  return typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function WalletPicker() {
  const connectors = useConnectors();
  const { connect, isPending, variables, error } = useConnect();
  const [env, setEnv] = useState<{ injected: boolean; mobile: boolean; href: string } | null>(null);
  useEffect(() => setEnv({ injected: hasInjectedProvider(), mobile: isMobile(), href: location.href }), []);

  // EIP-6963-announced extensions have their own ids (e.g. "io.metamask", "io.rabby").
  const announced = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  const generic = connectors.find((c) => c.id === "injected");
  const mmSdk = connectors.find((c) => c.type === "metaMask");
  const wc = connectors.find((c) => c.type === "walletConnect");
  const pendingId = isPending ? (variables?.connector as Connector | undefined)?.id : undefined;

  const options: { connector: Connector; label: string; hint?: string; icon?: string }[] = [
    ...announced.map((c) => ({ connector: c, label: c.name, icon: c.icon })),
    ...(generic && env?.injected && !announced.length ? [{ connector: generic, label: "Browser wallet" }] : []),
    ...(mmSdk ? [{ connector: mmSdk, label: announced.some((c) => /metamask/i.test(c.name)) ? "MetaMask mobile" : "MetaMask", hint: env?.mobile ? "Opens the MetaMask app" : "Scan a QR code with the MetaMask mobile app" }] : []),
    ...(wc ? [{ connector: wc, label: "WalletConnect", hint: "Any mobile wallet, via QR code" }] : []),
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {options.map(({ connector, label, hint, icon }) => (
          <button
            key={connector.uid}
            type="button"
            onClick={() => connect({ connector })}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-md border border-line px-4 py-2 text-sm transition-colors hover:border-line-strong disabled:opacity-50"
            title={hint}
          >
            {pendingId === connector.id ? (
              <Loader2 className="size-4 animate-spin" />
            ) : icon ? (
              // eslint-disable-next-line @next/next/no-img-element -- wallet icons are data: URIs announced by the extension
              <img src={icon} alt="" className="size-4" />
            ) : connector.type === "metaMask" || connector.type === "walletConnect" ? (
              <Smartphone className="size-4" />
            ) : (
              <Wallet className="size-4" />
            )}
            {label}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-attention">
          {walletErrorMessage(error)}
        </p>
      ) : null}
      {env && !env.injected && !announced.length ? (
        <div className="rounded-md border border-line bg-surface p-3 text-xs leading-relaxed text-fg-2">
          <p>No wallet extension was detected in this browser. You can:</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            {env.mobile ? (
              <li>
                <a className="text-fg underline underline-offset-2" href={`https://metamask.app.link/dapp/${env.href.replace(/^https?:\/\//, "")}`}>
                  Open this page in the MetaMask app
                </a>{" "}
                (or your wallet app&apos;s built-in browser).
              </li>
            ) : (
              <li>
                Install a wallet extension such as{" "}
                <a className="text-fg underline underline-offset-2" href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">
                  MetaMask
                </a>{" "}
                or{" "}
                <a className="text-fg underline underline-offset-2" href="https://rabby.io/" target="_blank" rel="noopener noreferrer">
                  Rabby
                </a>
                , then reload.
              </li>
            )}
            <li>Use “MetaMask” above to connect the MetaMask mobile app{env.mobile ? "" : " with a QR code"}.</li>
          </ul>
          <p className="mt-1.5">You must connect the same wallet that launched the token.</p>
        </div>
      ) : null}
    </div>
  );
}
