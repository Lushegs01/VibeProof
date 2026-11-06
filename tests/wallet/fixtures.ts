import { test as base, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, http, getAddress, type Address, type Hex } from "viem";
import { MANIFEST, RPC_URL } from "./settings";
export type Manifest = {
  app: string;
  rpc: string;
  registry: Address;
  factory: Address;
  creator: Address;
  token: Address;
  launchTx: Hex;
  indexedLaunches: number;
};
export type WalletControl = {
  rejectNextSignature(): Promise<void>;
  selectAccount(index: number): Promise<void>;
  wrongChain(): Promise<void>;
  sentTransactions(): number;
  signedMessages(): string[];
};
export const test = base.extend<{ manifest: Manifest; wallet: WalletControl }>({
  manifest: async ({}, use) => {
    await use(JSON.parse(await readFile(MANIFEST, "utf8")));
  },
  wallet: async ({ page, manifest }, use) => {
    const pub = createPublicClient({ transport: http(RPC_URL) });
    const localAccounts = await createWalletClient({ transport: http(RPC_URL) }).getAddresses();
    let sent = 0;
    const messages: string[] = [];
    await page.exposeFunction("__vpWalletRequest", async ({ method, params }: { method: string; params: unknown[] }) => {
      if (method === "personal_sign") {
        const signer = getAddress(String(params[1]));
        if (!localAccounts.some((account) => account.toLowerCase() === signer.toLowerCase())) throw new Error("Unknown local signer");
        const client = createWalletClient({ account: signer, transport: http(RPC_URL) });
        const signature = await client.signMessage({ message: { raw: params[0] as Hex } });
        messages.push(Buffer.from(String(params[0]).slice(2), "hex").toString("utf8"));
        return signature;
      }
      if (method === "eth_sendTransaction") sent++;
      return pub.request({ method, params } as never);
    });
    // Real JSON-RPC is forwarded to Anvil. No public RPC response or receipt is fabricated.
    await page.route("https://rpc.testnet.chain.robinhood.com/**", async (route) => {
      const response = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: route.request().postData() });
      await route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() });
    });
    await page.addInitScript(
      ({ accounts }) => {
        let selected = accounts[0],
          connected = false,
          chainId = "0xb626",
          rejectSignature = false;
        const events = new Map<string, Set<(...args: unknown[]) => void>>();
        const emit = (event: string, ...args: unknown[]) => {
          for (const callback of events.get(event) ?? []) callback(...args);
        };
        const bridge = window as unknown as { __vpWalletRequest(args: { method: string; params: unknown[] }): Promise<unknown> };
        const provider = {
          on(event: string, callback: (...args: unknown[]) => void) {
            const callbacks = events.get(event) ?? new Set();
            callbacks.add(callback);
            events.set(event, callbacks);
            return provider;
          },
          removeListener(event: string, callback: (...args: unknown[]) => void) {
            events.get(event)?.delete(callback);
            return provider;
          },
          async request({ method, params = [] }: { method: string; params?: unknown[] }) {
            if (method === "eth_requestAccounts") {
              connected = true;
              return [selected];
            }
            if (method === "eth_accounts") return connected ? [selected] : [];
            if (method === "eth_chainId") return chainId;
            if (method === "wallet_switchEthereumChain") {
              const target = (params[0] as { chainId: string }).chainId;
              if (target !== "0xb626") throw Object.assign(new Error("Only the local fixture network is configured"), { code: 4902 });
              chainId = target;
              emit("chainChanged", chainId);
              return null;
            }
            if (method === "wallet_getPermissions" || method === "wallet_requestPermissions")
              return [{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: [selected] }] }];
            if (method === "wallet_revokePermissions") {
              connected = false;
              emit("accountsChanged", []);
              return null;
            }
            if (method === "personal_sign" && rejectSignature) {
              rejectSignature = false;
              throw Object.assign(new Error("User rejected signature"), { code: 4001 });
            }
            return bridge.__vpWalletRequest({ method, params });
          },
        };
        Object.defineProperty(window, "ethereum", { value: provider });
        Object.defineProperty(window, "__vpWalletControl", {
          value: {
            reject() {
              rejectSignature = true;
            },
            account(index: number) {
              selected = accounts[index];
              emit("accountsChanged", connected ? [selected] : []);
            },
            wrongChain() {
              chainId = "0x1";
              emit("chainChanged", chainId);
            },
          },
        });
      },
      { accounts: localAccounts },
    );
    type ControlWindow = Window & { __vpWalletControl: { reject(): void; account(index: number): void; wrongChain(): void } };
    await use({
      rejectNextSignature: () => page.evaluate(() => (window as unknown as ControlWindow).__vpWalletControl.reject()),
      selectAccount: (index) => page.evaluate((value) => (window as unknown as ControlWindow).__vpWalletControl.account(value), index),
      wrongChain: () => page.evaluate(() => (window as unknown as ControlWindow).__vpWalletControl.wrongChain()),
      sentTransactions: () => sent,
      signedMessages: () => messages,
    });
    expect(manifest.rpc).toBe(RPC_URL);
  },
});
export { expect };
