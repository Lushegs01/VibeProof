import { createConnector } from "wagmi";
import { getAddress, UserRejectedRequestError, type Address } from "viem";
import type UniversalProvider from "@walletconnect/universal-provider";

/** Pairing material stays in memory and is never sent to analytics or logged. */
export type Pairing = { uri: string; cancel: () => void };
let pairing: Pairing | null = null;
const listeners = new Set<() => void>();
export const pairingSnapshot = () => pairing;
export const serverPairingSnapshot = () => null;
export function subscribePairing(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publishPairing(value: Pairing | null) {
  pairing = value;
  for (const listener of listeners) listener();
}

type Options = {
  projectId: string;
  metadata: { name: string; description: string; url: string; icons: string[] };
  /** Provider injection makes connector behavior deterministic without real relay credentials. */
  loadProvider?: () => Promise<UniversalProvider>;
};
/** Only the WalletConnect protocol is needed; embedded wallets/payments UI are not imported. */
export function walletConnectProtocol(options: Options) {
  return createConnector<UniversalProvider>((config) => {
    let provider: UniversalProvider | undefined;
    let initializing: Promise<UniversalProvider> | undefined;
    let currentChain = config.chains[0].id;
    const chain = (id: number) => {
      const found = config.chains.find((c) => c.id === id);
      if (!found) throw new Error("WalletConnect chain is not configured");
      return found;
    };
    const accounts = (sdk: UniversalProvider) =>
      [...new Set(Object.values(sdk.session?.namespaces ?? {}).flatMap((ns) => ns.accounts ?? []))]
        .filter((account) => account.startsWith(`eip155:${currentChain}:`))
        .map((account) => getAddress(account.split(":")[2]));
    const disconnected = () => {
      publishPairing(null);
      config.emitter.emit("disconnect");
    };
    const accountsChanged = (values: string[]) => {
      if (!values.length) return disconnected();
      const normalized = values.map((value) => getAddress(value.includes(":") ? value.split(":")[2] : value));
      config.emitter.emit("change", { accounts: normalized });
    };
    const chainChanged = (id: string | number) => {
      const next = typeof id === "string" && id.startsWith("eip155:") ? Number(id.split(":")[1]) : Number(id);
      if (!Number.isSafeInteger(next)) {
        disconnected();
        return;
      }
      currentChain = next;
      config.emitter.emit("change", { chainId: next });
    };
    const getProvider = async () => {
      if (provider) return provider;
      initializing ??= (async () => {
        const sdk = options.loadProvider
          ? await options.loadProvider()
          : await (await import("@walletconnect/universal-provider")).default.init({ projectId: options.projectId, metadata: options.metadata });
        sdk.on("accountsChanged", accountsChanged);
        sdk.on("chainChanged", chainChanged);
        sdk.on("session_delete", disconnected);
        provider = sdk;
        return sdk;
      })().catch((error) => {
        initializing = undefined;
        throw error;
      });
      return initializing;
    };
    return {
      id: "walletConnect",
      name: "WalletConnect",
      type: "walletConnect",
      getProvider,
      async connect<withCapabilities extends boolean = false>(parameters?: {
        chainId?: number;
        isReconnecting?: boolean;
        withCapabilities?: withCapabilities | boolean;
      }) {
        const target = parameters?.chainId ?? config.chains[0].id;
        chain(target);
        const sdk = await getProvider();
        currentChain = target;
        if (!accounts(sdk).length) {
          if (parameters?.isReconnecting) throw new Error("WalletConnect session is unavailable for this network. Reconnect your wallet.");
          let cancel!: () => void;
          const canceled = new Promise<never>((_resolve, reject) => {
            cancel = () => {
              sdk.abortPairingAttempt();
              publishPairing(null);
              reject(new UserRejectedRequestError(new Error("Pairing canceled")));
            };
          });
          const display = (uri: string) => {
            if (!uri.startsWith("wc:") || uri.length > 4096) {
              cancel();
              return;
            }
            publishPairing({ uri, cancel });
          };
          sdk.on("display_uri", display);
          try {
            await Promise.race([
              sdk.connect({
                namespaces: {
                  eip155: {
                    chains: [`eip155:${target}`],
                    methods: ["personal_sign", "eth_sendTransaction"],
                    events: ["accountsChanged", "chainChanged"],
                    rpcMap: { [String(target)]: chain(target).rpcUrls.default.http[0] },
                  },
                },
                optionalNamespaces: {
                  eip155: {
                    chains: [`eip155:${target}`],
                    methods: ["eth_signTypedData", "eth_signTypedData_v4", "wallet_switchEthereumChain"],
                    events: ["accountsChanged", "chainChanged"],
                  },
                },
              }),
              canceled,
            ]);
          } finally {
            sdk.off("display_uri", display);
            publishPairing(null);
          }
        }
        const addresses = accounts(sdk);
        if (!addresses.length) throw new Error("Wallet did not authorize an account on the selected network");
        sdk.setDefaultChain(`eip155:${target}`);
        return {
          chainId: target,
          accounts: (parameters?.withCapabilities
            ? addresses.map((address) => ({ address, capabilities: {} }))
            : addresses) as unknown as withCapabilities extends true
            ? readonly { address: Address; capabilities: Record<string, unknown> }[]
            : readonly Address[],
        };
      },
      async disconnect() {
        const sdk = await getProvider();
        if (sdk.session) await sdk.disconnect();
        publishPairing(null);
      },
      async getAccounts() {
        return accounts(await getProvider());
      },
      async getChainId() {
        return currentChain;
      },
      async isAuthorized() {
        try {
          return accounts(await getProvider()).length > 0;
        } catch {
          return false;
        }
      },
      async switchChain({ chainId }) {
        const selected = chain(chainId);
        const sdk = await getProvider();
        if (!Object.values(sdk.session?.namespaces ?? {}).some((ns) => ns.accounts?.some((account) => account.startsWith(`eip155:${chainId}:`))))
          throw new Error("Reconnect WalletConnect to authorize this network");
        sdk.setDefaultChain(`eip155:${chainId}`);
        currentChain = chainId;
        config.emitter.emit("change", { chainId });
        return selected;
      },
      onAccountsChanged: accountsChanged,
      onChainChanged: chainChanged,
      onDisconnect: disconnected,
    };
  });
}
