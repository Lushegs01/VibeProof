import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfig, http } from "wagmi";
import type UniversalProvider from "@walletconnect/universal-provider";
import { robinhoodTestnet } from "@/lib/chain/networks";
import { pairingSnapshot, walletConnectProtocol } from "@/lib/wallet/walletconnect";
const account = `0x${"1".repeat(40)}` as const;
class Protocol extends EventEmitter {
  session: { namespaces: { eip155: { accounts: string[] } } } | undefined;
  aborted = false;
  request = vi.fn(async () => "0x1");
  setDefaultChain = vi.fn();
  connect = vi.fn(async (_options: unknown) => {
    this.session = { namespaces: { eip155: { accounts: [`eip155:46630:${account}`] } } };
    return this.session;
  });
  abortPairingAttempt() {
    this.aborted = true;
  }
  async disconnect() {
    this.session = undefined;
    this.emit("session_delete");
  }
}
const setup = (sdk = new Protocol()) => {
  const load = vi.fn(async () => sdk as unknown as UniversalProvider);
  const config = createConfig({
    chains: [robinhoodTestnet],
    connectors: [
      walletConnectProtocol({
        projectId: "local-connector-test",
        metadata: { name: "Local test", description: "No relay calls", url: "http://localhost", icons: [] },
        loadProvider: load,
      }),
    ],
    transports: { [46630]: http() },
    ssr: true,
  });
  return { sdk, connector: config.connectors[0], load };
};
afterEach(() => {
  pairingSnapshot()?.cancel();
  vi.restoreAllMocks();
});
describe("WalletConnect protocol connector", () => {
  it("lazily loads and binds sessions and requests to the configured chain", async () => {
    const { sdk, connector, load } = setup();
    expect(load).not.toHaveBeenCalled();
    expect(await connector.connect()).toEqual({ chainId: 46630, accounts: [account] });
    expect(sdk.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        namespaces: expect.objectContaining({
          eip155: expect.objectContaining({ chains: ["eip155:46630"], methods: ["personal_sign", "eth_sendTransaction"] }),
        }),
      }),
    );
    expect(sdk.setDefaultChain).toHaveBeenCalledWith("eip155:46630");
    expect(await connector.isAuthorized()).toBe(true);
    await connector.disconnect();
    expect(await connector.isAuthorized()).toBe(false);
  });
  it("does not reconnect or switch to an unauthorized network", async () => {
    const { sdk, connector } = setup();
    sdk.session = { namespaces: { eip155: { accounts: [`eip155:1:${account}`] } } };
    expect(await connector.isAuthorized()).toBe(false);
    await expect(connector.connect({ isReconnecting: true })).rejects.toThrow("unavailable");
    await expect(connector.switchChain!({ chainId: 1 })).rejects.toThrow("not configured");
    expect(sdk.connect).not.toHaveBeenCalled();
  });
  it("cancels QR pairing without leaving the connection pending", async () => {
    const sdk = new Protocol();
    sdk.connect = vi.fn(async () => {
      sdk.emit("display_uri", "wc:local-test-pairing");
      return await new Promise<never>(() => {});
    });
    const { connector } = setup(sdk);
    const connecting = connector.connect();
    const rejected = expect(connecting).rejects.toMatchObject({ name: "UserRejectedRequestError" });
    await vi.waitFor(() => expect(pairingSnapshot()?.uri).toBe("wc:local-test-pairing"));
    pairingSnapshot()!.cancel();
    await rejected;
    expect(sdk.aborted).toBe(true);
    expect(pairingSnapshot()).toBeNull();
    expect(sdk.listenerCount("display_uri")).toBe(0);
  });
  it("rejects a session that grants only the wrong chain", async () => {
    const sdk = new Protocol();
    sdk.connect = vi.fn(async () => {
      sdk.session = { namespaces: { eip155: { accounts: [`eip155:1:${account}`] } } };
      return sdk.session;
    });
    const { connector } = setup(sdk);
    await expect(connector.connect()).rejects.toThrow("did not authorize");
  });
});
