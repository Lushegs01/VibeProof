import { getContractAddress } from "viem";
export const APP_PORT = 3200;
export const RPC_PORT = 8555;
export const EXPLORER_PORT = 3201;
export const APP_URL = `http://localhost:${APP_PORT}`;
export const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
// Public address of Anvil's first default unlocked account; no private key is needed.
export const LOCAL_ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;
export const REGISTRY = getContractAddress({ from: LOCAL_ACCOUNT, nonce: 0n });
export const FACTORY = getContractAddress({ from: LOCAL_ACCOUNT, nonce: 1n });
export const MANIFEST = `/tmp/vibeproof-wallet-${APP_PORT}.json`;
