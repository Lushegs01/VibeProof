import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, http, keccak256, toBytes, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Registry ⇄ backend: deploys the compiled VibeProofRegistry to a local anvil node
 * (chain id 46630), anchors a proof with the frontend ABI, and checks that
 * recordAnchor() only accepts a receipt with a matching creator/token/hash event.
 * Skips when anvil or the forge build output is missing.
 */
const ANVIL = [process.env.ANVIL_BIN, `${homedir()}/.foundry/bin/anvil`].find((p) => p && existsSync(p));
const ARTIFACT = "out/VibeProofRegistry.sol/VibeProofRegistry.json";
const PORT = 8547;
const RPC = `http://127.0.0.1:${PORT}`;
// anvil's well-known dev account #0 — local-only, holds nothing anywhere else.
const DEV_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const enabled = !!ANVIL && existsSync(ARTIFACT) && process.env.SKIP_DB_TESTS !== "1";

process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? "postgres://postgres@localhost:5432/vibeproof_test";
process.env.ROBINHOOD_TESTNET_RPC_URL = RPC;

let anvil: ChildProcess | undefined;
let registry: Address;
const account = privateKeyToAccount(DEV_KEY);

describe.runIf(enabled)("VibeProofRegistry anchoring (local anvil)", () => {
  let mods: {
    recordAnchor: typeof import("@/lib/services/proof-service").recordAnchor;
    ProofError: typeof import("@/lib/services/proof-service").ProofError;
    REGISTRY_ABI: typeof import("@/lib/registry/abi").REGISTRY_ABI;
    db: NonNullable<ReturnType<typeof import("@/lib/db/client").getDb>>;
    schema: typeof import("@/lib/db/client").schema;
    end: () => Promise<void>;
  };

  beforeAll(async () => {
    anvil = spawn(ANVIL!, ["--port", String(PORT), "--chain-id", "46630", "--silent"], { stdio: "ignore" });
    const pub = createPublicClient({ transport: http(RPC) });
    for (let i = 0; i < 50; i++) {
      try {
        await pub.getChainId();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const wallet = createWalletClient({ account, transport: http(RPC), chain: { id: 46630, name: "local", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } });
    const art = JSON.parse(readFileSync(ARTIFACT, "utf8"));
    const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode.object });
    registry = (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
    process.env.NEXT_PUBLIC_REGISTRY_ADDRESS = registry;

    const [ps, abi, dbm] = await Promise.all([import("@/lib/services/proof-service"), import("@/lib/registry/abi"), import("@/lib/db/client")]);
    mods = { recordAnchor: ps.recordAnchor, ProofError: ps.ProofError, REGISTRY_ABI: abi.REGISTRY_ABI, db: dbm.getDb()!, schema: dbm.schema, end: async () => void (await dbm.getSql()?.end()) };
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(mods.db, { migrationsFolder: "./drizzle" });
  });

  afterAll(async () => {
    anvil?.kill();
    await mods?.end();
  });

  it("verifies a matching onchain anchor and rejects a mismatched one", async () => {
    const pub = createPublicClient({ transport: http(RPC) });
    const wallet = createWalletClient({ account, transport: http(RPC), chain: { id: 46630, name: "local", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } });
    const token = registry; // any contract works as the "token" for the registry's code-size check
    const good = keccak256(toBytes("proof-good"));
    const { eq, and } = await import("drizzle-orm");
    await mods.db.delete(mods.schema.projectProofs).where(eq(mods.schema.projectProofs.tokenAddress, token.toLowerCase()));
    await mods.db.insert(mods.schema.projectProofs).values({ chainId: 46630, tokenAddress: token.toLowerCase(), submittedBy: account.address.toLowerCase(), submitterIsCreator: true, metadataHash: good });

    // Mismatched hash → rejected
    const badTx = await wallet.writeContract({ address: registry, abi: mods.REGISTRY_ABI, functionName: "submitProof", args: [token, keccak256(toBytes("other")), "https://x/proof"] });
    await pub.waitForTransactionReceipt({ hash: badTx });
    await expect(mods.recordAnchor(token, badTx)).rejects.toMatchObject({ code: "no_matching_event" });

    // Matching update → accepted and stored
    const okTx = await wallet.writeContract({ address: registry, abi: mods.REGISTRY_ABI, functionName: "updateProof", args: [token, good, "https://x/proof"] });
    await pub.waitForTransactionReceipt({ hash: okTx });
    await expect(mods.recordAnchor(token, okTx)).resolves.toEqual({ registryTx: okTx });
    const [row] = await mods.db.select().from(mods.schema.projectProofs).where(and(eq(mods.schema.projectProofs.chainId, 46630), eq(mods.schema.projectProofs.tokenAddress, token.toLowerCase())));
    expect(row.registryTx).toBe(okTx);
    expect(await pub.readContract({ address: registry, abi: mods.REGISTRY_ABI, functionName: "hasProof", args: [account.address, token] })).toBe(true);
  });
});
