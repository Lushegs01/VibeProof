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
    const wallet = createWalletClient({
      account,
      transport: http(RPC),
      chain: { id: 46630, name: "local", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } },
    });
    const art = JSON.parse(readFileSync(ARTIFACT, "utf8"));
    const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode.object });
    registry = (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
    process.env.NEXT_PUBLIC_REGISTRY_ADDRESS = registry;
    const factoryArtifact = JSON.parse(readFileSync("out/LocalLaunchFactory.sol/LocalLaunchFactory.json", "utf8"));
    const factoryHash = await wallet.deployContract({ abi: factoryArtifact.abi, bytecode: factoryArtifact.bytecode.object });
    const factory = (await pub.waitForTransactionReceipt({ hash: factoryHash })).contractAddress!;
    process.env.VIBE_V6_FACTORY = factory;
    process.env.VIBE_V6_START_BLOCK = "1";

    const [ps, abi, dbm] = await Promise.all([import("@/lib/services/proof-service"), import("@/lib/registry/abi"), import("@/lib/db/client")]);
    mods = {
      recordAnchor: ps.recordAnchor,
      ProofError: ps.ProofError,
      REGISTRY_ABI: abi.REGISTRY_ABI,
      db: dbm.getDb()!,
      schema: dbm.schema,
      end: async () => void (await dbm.getSql()?.end()),
    };
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")) throw new Error("Registry integration requires a disposable *_test database");
    const { sql } = await import("drizzle-orm");
    await mods.db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
    await migrate(mods.db, { migrationsFolder: "./drizzle" });
  }, 60_000);

  afterAll(async () => {
    anvil?.kill();
    await mods?.end();
  });

  it("verifies a matching onchain anchor and rejects a mismatched one", async () => {
    const pub = createPublicClient({ transport: http(RPC) });
    const wallet = createWalletClient({
      account,
      transport: http(RPC),
      chain: { id: 46630, name: "local", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } },
    });
    const token = registry; // any contract works as the "token" for the registry's code-size check
    const good = keccak256(toBytes("proof-good"));
    const { eq, and } = await import("drizzle-orm");
    await mods.db.delete(mods.schema.projectProofs).where(eq(mods.schema.projectProofs.tokenAddress, token.toLowerCase()));
    await mods.db
      .insert(mods.schema.projectProofs)
      .values({ chainId: 46630, tokenAddress: token.toLowerCase(), submittedBy: account.address.toLowerCase(), submitterIsCreator: true, metadataHash: good });

    // Mismatched hash → rejected
    const badTx = await wallet.writeContract({
      address: registry,
      abi: mods.REGISTRY_ABI,
      functionName: "submitProof",
      args: [token, keccak256(toBytes("other")), "https://x/proof"],
    });
    const badReceipt = await pub.waitForTransactionReceipt({ hash: badTx });
    expect(badReceipt.status).toBe("success");
    await expect(mods.recordAnchor(token, badTx)).rejects.toMatchObject({ code: "no_matching_event" });

    // Matching update → accepted and stored
    const update = { address: registry, abi: mods.REGISTRY_ABI, functionName: "updateProof" as const, args: [token, good, "https://x/proof"] as const };
    const estimated = await pub.estimateContractGas({ ...update, account: account.address });
    // A timestamp change turns the updatedAt SSTORE from a no-op into a write.
    // Reproduce that boundary deliberately and reserve a 20% gas margin.
    const previous = await pub.getBlock({ blockNumber: badReceipt.blockNumber });
    await pub.request({ method: "evm_setNextBlockTimestamp" as never, params: [Number(previous.timestamp) + 10] as never });
    const okTx = await wallet.writeContract({ ...update, gas: estimated + estimated / 5n });
    expect((await pub.waitForTransactionReceipt({ hash: okTx })).status).toBe("success");
    await expect(mods.recordAnchor(token, okTx)).resolves.toEqual({ registryTx: okTx });
    const [row] = await mods.db
      .select()
      .from(mods.schema.projectProofs)
      .where(and(eq(mods.schema.projectProofs.chainId, 46630), eq(mods.schema.projectProofs.tokenAddress, token.toLowerCase())));
    expect(row.registryTx).toBe(okTx);
    expect(await pub.readContract({ address: registry, abi: mods.REGISTRY_ABI, functionName: "hasProof", args: [account.address, token] })).toBe(true);
  });
  it("detects a real local launch, authenticates the creator, stores canonical evidence and verifies its EVM commitment", async () => {
    const [dbm, chain, indexing, proof, auth, siwe, metadata, verifier, documents, tokenService] = await Promise.all([
      import("@/lib/db/client"),
      import("@/lib/chain/provider"),
      import("@/indexer/indexer"),
      import("@/lib/services/proof-service"),
      import("@/lib/auth/session"),
      import("@/lib/auth/siwe"),
      import("@/lib/proof/metadata"),
      import("@/lib/proof/verify"),
      import("@/app/api/evidence/[hash]/route"),
      import("@/lib/services/token-service"),
    ]);
    const { createSiweMessage } = await import("viem/siwe");
    const { VIBE_DEPLOYMENTS } = await import("@/lib/vibe/contracts");
    const pub = createPublicClient({ transport: http(RPC) });
    const wallet = createWalletClient({
      account,
      transport: http(RPC),
      chain: { id: 46630, name: "local", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } },
    });
    const factoryArtifact = JSON.parse(readFileSync("out/LocalLaunchFactory.sol/LocalLaunchFactory.json", "utf8"));
    const launchTx = await wallet.writeContract({
      address: process.env.VIBE_V6_FACTORY as Address,
      abi: factoryArtifact.abi,
      functionName: "launch",
      args: [registry],
    });
    await pub.waitForTransactionReceipt({ hash: launchTx });
    const provider = chain.getProvider();
    const indexer = new indexing.VibeIndexer(
      provider,
      dbm.getDb()!,
      { confirmations: 0n, initialBackfillBlocks: 100n, metadata: false, analyzePerTick: 0, backfillPerTick: 0, tokenMetaRepairPerTick: 0, snapshotEveryMs: 0 },
      [{ ...VIBE_DEPLOYMENTS[0], startBlock: 1n }],
    );
    const tick = await indexer.tick();
    expect(tick.newLaunches).toBe(1);
    const nonce = await auth.issueNonce();
    const message = createSiweMessage({
      domain: "vibeproof.test",
      uri: "https://vibeproof.test",
      address: account.address,
      chainId: 46630,
      version: "1",
      nonce,
      issuedAt: new Date(),
      expirationTime: new Date(Date.now() + 600000),
    });
    expect((await siwe.verifySiwe(message, await account.signMessage({ message }), "vibeproof.test")).ok).toBe(true);
    process.env.NEXT_PUBLIC_APP_URL = "https://vibeproof.test";
    process.env.PROOF_CONFIRMATIONS = "1";
    const submitted = await proof.submitProof(account.address, { token: registry, description: "Local lifecycle integration" });
    const retrieve = async (uri: string) => {
      const hash = new URL(uri).pathname.split("/").at(-1)!;
      const response = await documents.GET(new Request(uri), { params: Promise.resolve({ hash }) });
      expect(response.status).toBe(200);
      return new Uint8Array(await response.arrayBuffer());
    };
    const canonical = await retrieve(submitted.metadataUri);
    expect(metadata.parseCanonicalProof(canonical).creator).toBe(account.address.toLowerCase());
    const update = {
      address: registry,
      abi: mods.REGISTRY_ABI,
      functionName: "updateProof" as const,
      args: [registry, submitted.metadataHash, submitted.metadataUri] as const,
    };
    const estimated = await pub.estimateContractGas({ ...update, account: account.address });
    const anchor = await wallet.writeContract({ ...update, gas: estimated + estimated / 5n });
    await pub.waitForTransactionReceipt({ hash: anchor });
    await proof.recordAnchor(registry, anchor, { retrieve });
    const verified = await verifier.verifyProof(
      { registry, token: registry, creator: account.address, txHash: anchor, launchTx, chainId: 46630, confirmations: 1n },
      provider,
      retrieve,
    );
    expect(verified.status).toBe("cryptographically_verified");
    expect(verified.creatorAuthority).toBe("launch_creator");
    const passportProof = await tokenService.getProofSection(registry);
    expect(passportProof.registryTx).toBe(anchor);
    expect(passportProof.metadataUri).toBe(submitted.metadataUri);
    expect((await siwe.verifySiwe(message, await account.signMessage({ message }), "vibeproof.test")).ok).toBe(false);
  });
});
