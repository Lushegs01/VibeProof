# VibeProof

**Know what was launched.** The verification layer for vibe/vibe launches on Robinhood Chain.

vibe/vibe makes launching easy. VibeProof makes launches understandable. Every launch gets a **Launch Passport** at `/token/robinhood-testnet/0x…` that combines four evidence layers:

| Layer | What it answers | Source |
| --- | --- | --- |
| **Contract** | What can this code do? Source verified? Proxy? Mint, pause, blacklist, upgrade, fee setters? Owner? | RPC bytecode and storage reads, Blockscout |
| **Creator** | What else has this wallet launched, and what happened to those launches? | vibe/vibe factory launch events |
| **Product** | Is there a reachable website, an active repository, a working demo? | SSRF-guarded HTTP probe, GitHub API |
| **Activity** | Holders, transfers, curve buys/sells, volume, and what changed since you last looked | Indexed Transfer and curve events, snapshots |

VibeProof never says a token is "safe", "legit" or "a scam", and it has **no single trust score**. Every value carries a verification state (`verified`, `observed`, `creator_claimed`, `not_found` or `unavailable`) and a "Why am I seeing this?" provenance panel with its source, block and method. A check that could not run shows **Unavailable**, never zero.

---

## What is in this repository

```
contracts/VibeProofRegistry.sol       Onchain proof-anchoring primitive (no owner, no custody)
script/DeployVibeProofRegistry.s.sol  Foundry deploy script
test/VibeProofRegistry.t.sol          Foundry tests (20 tests incl. fuzz)
drizzle/                              SQL migrations (generated from src/lib/db/schema.ts)
src/
  proxy.ts                            Next 16 request proxy: 404s malformed addresses before render
  app/(site)/…                        Pages: landing, token passport, creator, discover, activity,
                                      watchlist, submit, shared passport /p/[id] (+ OG image), methodology
  app/(embed)/embed/badge/[address]   Embeddable iframe badge
  app/api/…                           REST API (see below)
  indexer/                            Indexer: decode.ts (pure), timestamps.ts, indexer.ts, run.ts
  lib/chain/                          Chain config + ChainProvider abstraction (retry, concurrency cap, log chunking)
  lib/vibe/                           vibe/vibe contract addresses + event ABIs, with provenance
  lib/analysis/                       Contract analysis engine (selector scan, EIP-1967/1167, ownership)
  lib/proof/                          SSRF guard, safe fetcher, website/GitHub checks, metadata hashing
  lib/changes/                        "What changed?" diff engine
  lib/services/                       Passport, creator, search, discover, proof, share services
  lib/auth/                           SIWE verification + HMAC session cookies
  lib/cache/                          Redis cache (SWR, request de-dup) + rate limiting, in-memory fallback
  lib/demo/                           Deterministic DEMO DATA fixtures (demo mode only)
tests/unit, tests/integration, tests/e2e
```

## Architecture

```
Robinhood Chain Testnet (RPC)                Blockscout API        GitHub API / project sites
        │                                          │                         │
        ▼                                          │                         │
┌──────────────── indexer (npm run indexer) ─────────────────┐               │
│ 1. launches: factory logs (LaunchCreated / TokenLaunched)  │               │
│ 2. live tail: topic-only Transfer + curve-event queries,   │               │
│    filtered locally to fully covered tokens                │               │
│ 3. backfill queue: full per-token history on demand        │               │
│ 4. counters, holders, snapshots, feed; proof re-checks     │               │
└──────────────────────────┬─────────────────────────────────┘               │
                           ▼                                                 │
                     PostgreSQL ◄──── contract analysis (cached 6h) ◄────────┤
                           │                                                 │
                           ▼                                                 │
            services ─► Redis (SWR cache, rate limits) ◄── proof checks ─────┘
                           │
                           ▼
          Next.js route handlers (/api/*)  +  server-rendered pages
```

Page renders never fan out into RPC calls. A cold passport does one contract analysis: a bounded multicall, three `eth_getStorageAt` reads and two explorer requests, all persisted. Everything else comes from Postgres, and responses are cached in Redis with stale-while-revalidate. On the live testnet, a cold passport API call took 0.84s and a cached one 0.02s.

### Coverage model (why counts are sometimes "Unavailable")

The testnet has about 143k vibe/vibe launches and roughly 1.2 ERC-20 transfers per block chain-wide. Indexing all history through the public RPC would take millions of calls, so the indexer works like this:

* It indexes **every launch** from both factories.
* It tails **all activity from the activity start block** (default: head − 100,000 blocks on first run, configurable). A token launched after that block is `activity_covered`.
* **Older launches are backfilled on demand.** Opening their passport queues a full-history backfill of 2–10 address-filtered `eth_getLogs` calls, which the indexer processes on its next tick. Until it finishes, the passport shows Blockscout counters, labelled as such, and curve metrics as *Unavailable*.

Holder counts are only presented from our index when the token's full history is covered. Partial history is never presented as a count.

### Timestamps

This RPC returns `blockTimestamp: 0x0` in `eth_getLogs`. For batches of 64 or fewer distinct blocks, headers are fetched exactly. Larger batches interpolate linearly between header anchors every 500 blocks, which keeps the error to about 85 s or less at the observed ~0.17 s block time. See `src/indexer/timestamps.ts`.

---

## Verified Network Information

Checked on **2026-09-30** against live endpoints:

| Item | Value | How it was verified |
| --- | --- | --- |
| Network name | Robinhood Chain Testnet | Robinhood docs / explorer |
| Chain ID | `46630` (`0xb626`) | `eth_chainId` on the public RPC returned `0xb626` |
| Native currency | ETH (18 decimals) | |
| Public RPC | `https://rpc.testnet.chain.robinhood.com` | Live JSON-RPC calls. **Rate-limited**: returns HTTP 429 under load and rejects JSON-RPC batching. Use a provider (e.g. Alchemy) in production. |
| Explorer | `https://explorer.testnet.chain.robinhood.com` (Blockscout; API v2 at `/api/v2`) | Live API calls |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | Used successfully for batched reads |
| `eth_getLogs` limits | ≤ 10,000 logs per response (`logs matched by query exceeds limit of 10000`); large block ranges are otherwise accepted | Observed; the provider halves ranges automatically |

### Connecting to Robinhood Chain Testnet

1. Copy the env template: `cp .env.example .env`.
2. For development, keep `ROBINHOOD_TESTNET_RPC_URL=https://rpc.testnet.chain.robinhood.com`. For production, set it to your provider URL. All chain access goes through the `ChainProvider` interface (`src/lib/chain/provider.ts`), so nothing else changes.
3. Optionally set `ROBINHOOD_TESTNET_WSS_URL` (reserved for push-based tailing).
4. Wallet users: add the network with chain ID `46630`, RPC above, currency ETH, and explorer above. The submit page requests `wallet_switchEthereumChain` automatically.
5. Testnet ETH: `https://faucet.testnet.chain.robinhood.com/`.
6. Health check: `curl localhost:3000/api/health` shows the RPC, DB, Redis and indexer status plus lag in blocks.

---

## vibe/vibe contracts: provenance and what still needs official verification

**Nothing is invented.** vibe/vibe has not published an address list in public docs. The values in `src/lib/vibe/contracts.ts` were read from the **official vibe/vibe app bundle** served at `https://testnet.vibevibe.fun` (config keys `v6Graphs.run15` and `v5Graphs.live.deployments`) and then **confirmed onchain**: bytecode is present, and the emitted logs' topic0 equals keccak256 of the event signatures found in the same bundle. **None of these contracts has verified source on Blockscout.** Each value can be overridden via env (`VIBE_V6_FACTORY`, `VIBE_V5_FACTORY`).

| Deployment | Factory | Launch event | Deploy block | Status |
| --- | --- | --- | --- | --- |
| v6 `run15` | `0xe794217880011f9cA6961340eD5c16EC9559Fea0` | `LaunchCreated` (topic `0xa7e8032b…`) | 123,503,237 (from app bundle) | App bundle + onchain topic match. **Source unverified.** |
| v5 `live` | `0x40f1be6faf8DAB9C143cce1a0A04c2075Fb2DF59` | `TokenLaunched` (topic `0x56eef5c3…`) | 115,025,604 (from factory creation tx on Blockscout) | App bundle + onchain topic match. **Source unverified.** |

### Event signatures

| Event | Emitter | Status |
| --- | --- | --- |
| `LaunchCreated(uint256 indexed launchId, address indexed launcher, address indexed token, address curve, string name, string symbol, string metadataURI, address pairCurrency, uint16 taxBps, uint64 packedWeights, address projectTreasury, uint256 targetPairUnits, uint256 netPersonal, uint256 giftNetTotal, bytes32 giftRoot, uint256 giftCount)` | v6 factory | **Observed**, decoded in tests from a real log |
| `TokenLaunched(uint256 indexed launchId, address indexed token, address indexed curve, address creator, address creatorFeeRecipient, address creatorVault, uint256 initialBuy, uint256 initialTokensBought, uint16 metadataSchemaVersion, bytes32 metadataDigest, string metadataURI)` | v5 factory | **Observed**, decoded in tests from a real log |
| `CurveBuy(address indexed buyer, address indexed recipient, uint256 grossTokens, uint256 netTokens, uint256 tokenFee, uint256 pairCost, uint256 pairFee, uint256 rateBps)` | v6 curve | **Observed** |
| `CurveSell(address indexed seller, address indexed recipient, uint256 grossTokens, uint256 netTokens, uint256 tokenFee, uint256 pairProceeds, uint256 pairFee)` | v6 curve | **Observed** |
| `Graduated(bytes32 indexed poolId, uint256 pairAmount, uint256 tokenAmount, uint256 leftoverBurned)` | v6 curve | **Observed** (e.g. tx `0xb8e17636…`, after which the token balance moved to the Uniswap v4 PoolManager) |
| `Bought(...)`, `Sold(...)`, `Graduated(bytes32,uint256,uint256)`, `CurveCompleted(uint256,uint256)` | v5 curve (per bundle) | **Not yet observed.** Signatures come from the app bundle only. |
| Factory topics `0x5e4996fc…`, `0x026fa567…`, `0xfec4a7b1…`; v6 curve topic `0x5b18697b…` | v6 factory / curve | **Unknown.** Seen onchain but not decoded (fee/config related) and not used. |

**Roles the original spec named that have no verified address:** `router`, `registry` and `feeController` are kept as explicit `undefined` in `VIBE_CONTRACTS`. The bundle also lists a zap, hook, locker, buyback, pairPolicy and the Uniswap v4 PoolManager (`0x8366a39C…`). These are used only to **label and exclude** protocol-held balances from holder counts, never for any other logic.

**Before production:** confirm these with the vibe/vibe team or official docs, ask them to verify source on Blockscout, and re-check whenever the app ships a new "run" (the bundle names deployments `run15`, and so on).

---

## Local setup

Requirements: Node 22+, PostgreSQL 14+, optionally Redis 6+, and Foundry for contracts.

```bash
npm install
cp .env.example .env              # then set SESSION_SECRET: openssl rand -hex 32
createdb vibeproof                # or point DATABASE_URL at any Postgres
npm run db:migrate                # applies drizzle/*.sql
npm run indexer                   # long-running; separate terminal
npm run dev                       # http://localhost:3000
```

Without Redis, cache and rate limits fall back to in-process memory (single instance only). Without Postgres the app still serves live contract analysis, but launches, creators, activity and proofs will show as unavailable.

**Demo mode.** `NEXT_PUBLIC_DEMO_MODE=true` serves a deterministic fixture set with `0xde00…` addresses, banner-labelled **DEMO DATA** on every page and `demo: true` in every API response. It never mixes with testnet data, and it is a build-time flag.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `ROBINHOOD_TESTNET_RPC_URL` | yes | JSON-RPC endpoint (public for dev, provider for prod) |
| `ROBINHOOD_TESTNET_WSS_URL` | no | Reserved for WebSocket tailing |
| `BLOCKSCOUT_API_URL` | yes | Blockscout base (`…/api`) |
| `DATABASE_URL` | yes* | Postgres |
| `REDIS_URL` | no | Shared cache and rate limiting |
| `GITHUB_TOKEN` | no | Read-only token; raises GitHub limits from 60/h to 5000/h |
| `SESSION_SECRET` | prod | ≥ 32 chars; HMAC key for session cookies |
| `NEXT_PUBLIC_APP_URL` | yes | Absolute URL for OG images, badge links |
| `NEXT_PUBLIC_DEMO_MODE` | no | `true` = demo fixtures only |
| `NEXT_PUBLIC_REGISTRY_ADDRESS` | no | `VibeProofRegistry` address; enables onchain anchoring. Testnet: `0x47b639e587FdBf9A8323d030C9930744BfbF2F2E` |
| `INDEXER_INITIAL_BACKFILL_BLOCKS` | no | Tail start on first run (default 100000) |
| `INDEXER_ACTIVITY_START` | no | Explicit activity start block (overrides the above) |
| `INDEXER_MAX_TAIL_BLOCKS` | no | Max blocks the tail advances per tick (default 20000) |
| `INDEXER_POLL_MS` | no | Poll interval at head (default 4000) |
| `RPC_MAX_CONCURRENCY` | no | Per-process in-flight RPC cap (default 12) |
| `VIBE_V6_FACTORY`, `VIBE_V5_FACTORY` | no | Override factory addresses |

`.env.example` contains no secrets. Never commit `.env`.

## Indexer

```bash
npm run indexer           # run forever (catches up, then polls)
npm run indexer:once      # run until caught up to head, then exit
npm run indexer:recount   # recompute counters for all covered tokens (after rule changes)
```

State lives in the `indexer_state` table: per-factory launch cursors, `activity_start` and the `activity` cursor. Each range commits atomically with its cursor, so a crash resumes cleanly. Holder deltas are applied only for newly inserted events, so re-processing a range can never double-count (covered by an integration test). Run exactly **one** indexer process per database. Proof checks older than 6 h are re-run every 10 minutes.

## Contract deployment (VibeProofRegistry)

**Deployed on Robinhood Chain Testnet:** [`0x47b639e587FdBf9A8323d030C9930744BfbF2F2E`](https://explorer.testnet.chain.robinhood.com/address/0x47b639e587FdBf9A8323d030C9930744BfbF2F2E?tab=contract). It was deployed in block 126,651,474 (tx `0x2eabd62b…`), and its source is verified on Blockscout (solc 0.8.28). A live smoke test (`submitProof` → `hasProof` → server-side receipt verification) passed, and a mismatched hash was rejected. Details are in [`deployments/robinhood-testnet.json`](deployments/robinhood-testnet.json). The contract has no owner, so the deployer address holds no privileges.

The registry is a **proof-anchoring primitive**: it stores `creator`, `token`, `metadataHash`, `metadataURI` and timestamps, and nothing subjective. It has no owner, admin, pause, upgrade path, payable function or token custody. Records are keyed by `(msg.sender, token)`; VibeProof only credits records whose `creator` equals the indexed launcher.

```bash
forge install                         # forge-std is a git submodule: git submodule update --init
npm run forge:test                    # 20 tests, incl. 1,024-run fuzz
cast wallet import vibeproof-deployer --interactive   # encrypted keystore; never put keys in env/source
ROBINHOOD_TESTNET_RPC_URL=https://rpc.testnet.chain.robinhood.com npm run deploy:testnet
REGISTRY_ADDRESS=0x… npm run verify:testnet            # Blockscout verification
# then set NEXT_PUBLIC_REGISTRY_ADDRESS=0x… and rebuild
```

The anchoring flow: the creator submits proof (SIWE-authenticated), then optionally calls `submitProof(token, metadataHash, uri)` from their wallet. The server independently fetches the receipt and records the anchor **only if** it contains a matching `ProofSubmitted`/`ProofUpdated` event from the configured registry.

## API

Every response has the shape `{ data, meta: { source, observedAt, cached, block?, demo } }`. Errors use `{ error: { code, message } }`. All endpoints are IP rate-limited (HTTP 429 with `resetAt`).

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/tokens/[address]` | Full Launch Passport |
| GET | `/api/tokens/[address]/contract?refresh=1` | Contract analysis (refresh: 1 per 5 min per IP) |
| GET | `/api/tokens/[address]/holders` | Holder metric + top 10 (labelled protocol contracts) |
| GET | `/api/tokens/[address]/activity` | Activity metrics + recent events |
| GET | `/api/tokens/[address]/changes?since=ISO` | Snapshot diff + events since |
| GET | `/api/tokens/[address]/proof` | Product proof section |
| POST | `/api/tokens/[address]/proof/recheck` | Re-run checks (1 per token per 10 min) |
| POST | `/api/tokens/[address]/share` | Returns `{ id, path: "/p/{id}" }` |
| GET | `/api/creators/[address]` | Creator Passport |
| GET | `/api/search?q=` | Token address, `$SYMBOL`, name, creator wallet, tx hash |
| GET | `/api/discover?sort=&category=` | Sorts: newest, transactions, holders, active, verified, graduated |
| GET | `/api/activity` | Ecosystem feed |
| GET | `/api/auth/nonce` · POST `/api/auth/verify` · GET `/api/auth/session` · POST `/api/auth/logout` | SIWE |
| POST | `/api/proofs` | Submit proof (session required; creator only) |
| POST | `/api/proofs/anchor` | `{ token, txHash }`; verifies the registry receipt |
| GET | `/api/v1/tokens/[address]` | Stable developer API subset, CORS `*` |
| GET | `/api/health` | DB / Redis / RPC / indexer status, lag, metrics |

The embeddable badge is `<iframe src="https://<host>/embed/badge/0x…" width="320" height="120"></iframe>`.

## Security notes

* **SSRF.** Creator URLs must be https on standard ports, with no credentials and no internal hostnames. IP literals are checked against all private and reserved IPv4 and IPv6 ranges (including mapped and NAT64 forms, and decimal/hex/octal IPv4). DNS results are checked **inside the socket's lookup**, which defeats rebinding: `localtest.me` → 127.0.0.1 is refused at connect time. Redirects are re-validated (max 3), with an 8 s timeout and a 512 KB body cap. GitHub is allowlisted to `github.com/{owner}/{repo}`.
* **Auth.** SIWE (EIP-4361) with checks on domain, chain ID (46630) and time window. The nonce is single-use and consumed atomically, and only after a valid signature, so a bad signature can't burn it. ERC-1271 smart-wallet signatures are supported. Sessions are an HMAC-SHA256 cookie (`HttpOnly`, `SameSite=Lax`, `Secure` in prod) that contains no wallet signature. VibeProof never asks for seed phrases or keys.
* **Input.** Strict address validation (checksum enforced for mixed case), Zod schemas on every body, and parameterised SQL via Drizzle; LIKE wildcards are escaped. RPC and explorer responses are schema-validated.
* **Headers.** CSP, HSTS, `X-Frame-Options: DENY` (except `/embed/*`), `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
* **Resource protection.** Redis rate limits per IP and per wallet, a per-process RPC concurrency cap, request de-duplication, and caching.
* **Logging.** Structured JSON; fields named like secrets, signatures or cookies are redacted.

## Testing

```bash
npm test                    # unit + integration (Vitest): 138 tests
npm run test:unit           # pure logic: address/URL validation, selector scan, decoding, diff, hashing, checks…
npm run test:integration    # Postgres (DATABASE_URL_TEST, default vibeproof_test), live RPC, SIWE, anvil registry
npm run forge:test          # Solidity (20 tests)
npm run test:e2e:build && npm run test:e2e   # Playwright, desktop + mobile, against a demo-mode build
```

`SKIP_NETWORK_TESTS=1` and `SKIP_DB_TESTS=1` skip the live-RPC and database suites. Set `PW_CHROMIUM_PATH` to use a preinstalled Chromium.

## Deployment

* **Web:** any Node host that runs `next build && next start` (Vercel, Fly, Render). Set the env vars above. Point `DATABASE_URL` at managed Postgres and `REDIS_URL` at Upstash or another Redis.
* **Indexer:** a single long-running worker (`npm run indexer`) against the same database. Scale the web tier freely; run exactly one indexer.
* **RPC:** use a provider endpoint in production. The public RPC rate-limits.

## Current status (honest)

* **Tested and working against the live Robinhood Chain Testnet:**
  * Launch indexing from both factories (about 143k launches).
  * The live activity tail and on-demand backfill.
  * Holder balances match Blockscout address-for-address on the tokens spot-checked. Counts differ only by the documented exclusions (the curve and protocol contracts).
  * Contract analysis, passport pages, creator pages, discover, feed and change detection.
  * Website checks against real sites.
* **Registry:** deployed to Robinhood Chain Testnet at `0x47b639e587FdBf9A8323d030C9930744BfbF2F2E`. Source is verified on Blockscout, and the anchor round-trip (submit onchain → server verifies the receipt; mismatched hash rejected) passed against the live chain. The wallet UI step that calls it has not been clicked through with a browser wallet.
* **Not tested live:** GitHub checks (unit-tested against mocked API responses; the API was not reachable from the build sandbox) and the wallet-driven SIWE UI flow (signature verification itself is integration-tested with real signatures).
* **Roadmap (Phase 2+):** wallet-linked watchlists, notifications, WebSocket tailing, project comparison, ecosystem graph (observed funding relationships only), Discord/Telegram bots, webhooks, and an optional AI summary layer constrained to cite evidence.
