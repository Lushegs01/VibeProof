import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, rm } from "node:fs/promises";
import { once } from "node:events";
import { resolve } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createPublicClient, createWalletClient, http, decodeEventLog, type Address } from "viem";
import { APP_URL, RPC_URL, RPC_PORT, EXPLORER_PORT, LOCAL_ACCOUNT, REGISTRY, FACTORY, MANIFEST } from "./settings";

export default async function setup() {
  const database = process.env.WALLET_DATABASE_URL!;
  if (new URL(database).pathname !== "/vibeproof_wallet_test") throw new Error("Wallet E2E requires its dedicated disposable database");
  const adminUrl = new URL(process.env.DATABASE_URL_TEST ?? "postgres://postgres@127.0.0.1:5432/vibeproof_test");
  if (!adminUrl.pathname.endsWith("_test")) throw new Error("Use a disposable *_test database for browser tests");
  const admin = postgres(adminUrl.href, { onnotice: () => {} });
  if (!(await admin`select 1 from pg_database where datname='vibeproof_wallet_test'`).length) await admin.unsafe("create database vibeproof_wallet_test");
  await admin.end();
  const sql = postgres(database, { onnotice: () => {} });
  await sql.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public");
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  await sql.end();
  const anvil = spawn(
    process.env.ANVIL_BIN ?? resolve("node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil"),
    ["--port", String(RPC_PORT), "--chain-id", "46630", "--block-time", "1", "--silent"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let nodeError: Error | undefined;
  anvil.on("error", (error) => {
    nodeError = error;
  });
  // The explorer stub reports unavailable source; it never manufactures verified facts.
  const explorer = createServer((_req, res) => {
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"message":"No explorer data on local fixture chain"}');
  });
  explorer.listen(EXPLORER_PORT, "127.0.0.1");
  await once(explorer, "listening");
  const cleanup = async () => {
    anvil.kill("SIGTERM");
    await new Promise<void>((resolve) => explorer.close(() => resolve()));
    await rm(MANIFEST, { force: true });
  };
  try {
    const pub = createPublicClient({ transport: http(RPC_URL, { retryCount: 0, timeout: 1000 }) });
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (nodeError) throw nodeError;
      try {
        ready = (await pub.getChainId()) === 46630;
        if (ready) break;
      } catch {
        /* Startup only; bounded polling. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error("Local Anvil did not start");
    const chain = {
      id: 46630,
      name: "Local wallet test",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [RPC_URL] } },
    } as const;
    const wallet = createWalletClient({ account: LOCAL_ACCOUNT, chain, transport: http(RPC_URL) });
    const artifact = async (name: string) => JSON.parse(await readFile(`out/${name}.sol/${name}.json`, "utf8"));
    const registry = await artifact("VibeProofRegistry");
    const registryTx = await wallet.deployContract({ abi: registry.abi, bytecode: registry.bytecode.object });
    if ((await pub.waitForTransactionReceipt({ hash: registryTx })).contractAddress?.toLowerCase() !== REGISTRY.toLowerCase())
      throw new Error("Unexpected local registry address");
    const factory = JSON.parse(await readFile("out/LocalLaunchFactory.sol/LocalLaunchFactory.json", "utf8"));
    const factoryTx = await wallet.deployContract({ abi: factory.abi, bytecode: factory.bytecode.object });
    if ((await pub.waitForTransactionReceipt({ hash: factoryTx })).contractAddress?.toLowerCase() !== FACTORY.toLowerCase())
      throw new Error("Unexpected local factory address");
    const multicall = JSON.parse(await readFile("out/LocalLaunchFactory.sol/LocalMulticall3.json", "utf8"));
    await pub.request({ method: "anvil_setCode" as never, params: ["0xcA11bde05977b3631167028862bE2a173976CA11", multicall.deployedBytecode.object] as never });
    const launchTx = await wallet.writeContract({ address: FACTORY, abi: factory.abi, functionName: "deploy" });
    const receipt = await pub.waitForTransactionReceipt({ hash: launchTx });
    let token: Address | undefined;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== FACTORY.toLowerCase()) continue;
      try {
        const event = decodeEventLog({ abi: factory.abi, data: log.data, topics: log.topics }) as { eventName: string; args: { token: Address } };
        if (event.eventName === "LaunchCreated") token = (event.args as { token: Address }).token;
      } catch {
        /* ERC20 constructor log is not a factory launch. */
      }
    }
    if (!token) throw new Error("Factory launch not emitted");
    process.env.DATABASE_URL = database;
    process.env.ROBINHOOD_TESTNET_RPC_URL = RPC_URL;
    process.env.VIBE_V6_FACTORY = FACTORY;
    process.env.VIBE_V6_START_BLOCK = "1";
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    process.env.NEXT_PUBLIC_VIBEPROOF_NETWORK = "robinhood-testnet";
    const [{ getDb, getSql }, { getProvider }, { VibeIndexer }, { VIBE_DEPLOYMENTS }] = await Promise.all([
      import("../../src/lib/db/client"),
      import("../../src/lib/chain/provider"),
      import("../../src/indexer/indexer"),
      import("../../src/lib/vibe/contracts"),
    ]);
    const indexer = new VibeIndexer(
      getProvider(),
      getDb()!,
      { confirmations: 0n, initialBackfillBlocks: 100n, metadata: false, analyzePerTick: 0, tokenMetaRepairPerTick: 0, snapshotEveryMs: 0 },
      [{ ...VIBE_DEPLOYMENTS[0], startBlock: 1n }],
    );
    const indexed = await indexer.tick();
    if (indexed.newLaunches !== 1) throw new Error("Local launch was not indexed");
    await getSql()?.end();
    await writeFile(
      MANIFEST,
      JSON.stringify({
        app: APP_URL,
        rpc: RPC_URL,
        registry: REGISTRY,
        factory: FACTORY,
        creator: LOCAL_ACCOUNT,
        token,
        launchTx,
        indexedLaunches: indexed.newLaunches,
      }),
    );
    // Next dev compiles routes on demand. Finish compilation before measuring browser
    // behavior; these are real requests with checked responses, never mocked success.
    const warmup: [string, number][] = [
      [`/submit?token=${token}`, 200],
      ["/api/auth/session", 200],
      ["/api/auth/nonce", 200],
      ["/api/auth/verify", 405],
      ["/api/proofs", 405],
      ["/api/proofs/anchor", 405],
      ["/api/proofs/verify", 400],
      [`/api/evidence/0x${"0".repeat(64)}`, 404],
      [`/api/tokens/${token}/proof`, 200],
      [`/token/robinhood-testnet/${token}`, 200],
    ];
    for (const [path, status] of warmup) {
      const response = await fetch(new URL(path, APP_URL), { signal: AbortSignal.timeout(120_000) });
      await response.arrayBuffer();
      if (response.status !== status) throw new Error(`Wallet route startup failed: ${path} returned ${response.status}, expected ${status}`);
    }
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
