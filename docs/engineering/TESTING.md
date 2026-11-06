# Executed verification

Testing was performed locally on 2026-11-05 and 2026-11-06 with Node 24, PostgreSQL 17, Redis 7,
Foundry 1.7.1, Solidity 0.8.28, Next 16.4.5, Vitest 5.1.0 and system Chromium.
No badges or remote CI success are asserted.

The baseline and intermediate failures are described in BASELINE.md and the
implementation report. Failures exposed real issues (job aggregation, demo isolation,
raw SQL date serialization, scalar reads relying on a deployed Multicall3, stale head
reads, initial Redis connection state and browser origin configuration) and were fixed.
After a clean dependency reinstall, stale development cache caused repeated reloads;
clearing the generated `.next-wallet` directory resolved that loop. A cold run then
exposed compilation exceeding the 15-second runtime assertions. The wallet harness now
precompiles real routes using status-checked requests before browser cases; assertions
and retries remain unchanged. Warm-up never signs in or fabricates transaction results.
A test stub was corrected to model a second idle queue tick instead of endlessly
returning the same failed metadata batch. The regression still checks exact failure
counting. Final checks run sequentially after resource-contention timing failures.
Migration/Anvil setup allows 60 seconds; behavioral test timeouts remain 30 seconds.

## Commands

```sh
npm ci
npm exec forge -- build --use /tmp/vibeproof-solc-0.8.28

# Disposable database only; integration suites recreate its schemas.
DATABASE_URL_TEST=postgres://postgres@127.0.0.1:5432/vibeproof_test \
  SKIP_NETWORK_TESTS=1 \
  ANVIL_BIN="$PWD/node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil" npm test

# Read-only public testnet tests through the managed environment’s configured HTTP proxy.
NODE_USE_ENV_PROXY=1 npm run test:live

npm exec forge -- test --use /tmp/vibeproof-solc-0.8.28 -vv
npm run build
npm run test:e2e:build
PW_CHROMIUM_PATH=/usr/bin/chromium REDIS_URL=redis://127.0.0.1:6379 npm run test:e2e
PW_CHROMIUM_PATH=/usr/bin/chromium DATABASE_URL_TEST=postgres://postgres@127.0.0.1:5432/vibeproof_test \
  REDIS_URL=redis://127.0.0.1:6379 npm run test:wallet
npm run lint
npm run format:check
npm audit --audit-level=high
```

The Solidity binary override is environment-specific: it was fetched from the official
ethereum/solc-bin repository because binaries.soliditylang.org was denied by this
workspace’s network policy. Normal CI uses the pinned Foundry tool’s configured compiler
version. No network policy was bypassed and TLS verification remained enabled.

## Results

| Check | Executed result |
| --- | --- |
| Deterministic Vitest suite | **294 passed, 0 failed, 5 skipped**, 45 passing files; 51.66 seconds |
| Skipped local cases | Five live-RPC reads, run separately below; no database or Anvil cases skipped |
| Live RPC suite | **5 passed, 0 failed**, 3.08 seconds with inherited proxy support |
| Foundry | **21 passed, 0 failed, 0 skipped**; fuzz 1,024 runs; invariant 256 runs / 128,000 calls / 0 reverts |
| Legacy-data migration upgrade | Passed; included in the deterministic suite, also run independently |
| Production Next build | Passed on Next 16.4.5, including TypeScript and page generation |
| Demo browser build | Passed with the explicit localhost:3100 origin |
| Lockfile validation | Clean `npm ci` installed 333 packages successfully; remote CI execution is not asserted |
| Secret scans | Working-source snapshot and all eight existing Git commits passed Gitleaks 8.24.3 |
| Dependency security gate | **Passed:** zero reported vulnerabilities at every severity |
| Demo Playwright | **11 passed, 0 failed, 1 skipped**, desktop + mobile; 26.8 seconds |
| Wallet Playwright | **6 passed, 0 failed, 0 skipped**, desktop + mobile; 1.3 minutes with warm development cache (a prior empty-cache run also passed) |
| Skipped browser case | Mobile keyboard shortcut test, explicitly desktop-only |
| Type/static/migration checks | `npm run lint` passed; TypeScript plus all eight registered migrations |
| Formatting | Passed for 119 changed/new source and workflow files |
| Whitespace patch validation | `git diff --check` passed |

All executed local quality gates pass. Live public-chain writes and external providers
remain unverified as disclosed; local results are not a production readiness certification.

## Test scope

* Unit: canonical JSON/hash/CID, verifier negative cases, URL/IP boundaries, job states,
  scheduling failures, alert transitions, session/origin/trusted-ingress policies,
  WalletConnect chain/session/cancellation, development evidence-origin restrictions,
  IPFS upload/readback/integrity/provider disclosure,
  webhook signature/replay/encryption and billing state.
* Database: event idempotency and reorg recovery, lock/cursor semantics, actual job failure
  aggregation and partial progress, proof bytes/history, challenge ownership/replay,
  quota races, session revocation, webhook challenge/fanout/retry/deduplication.
* Migration upgrade: a new disposable database receives migrations 0000–0002, then real
  token/proof rows, then migrations 0003–0007 twice. Original data and commitment hashes
  remain unchanged, legacy URI is null, and new tables exist.
* Local EVM: real local factory launch log → indexer → SIWE → canonical document HTTP
  route → wallet transaction → anchor recording → independent receipt/hash/launch check.
  Retrieval is injected from the local document route so production SSRF remains strict.
* Browser demo: desktop and mobile discovery, search, passport, provenance, contract/creator,
  activity, sharing, local watchlist and demo operational/account boundaries.
* Browser wallet: actual indexed launch, SIWE, evidence API, wallet transaction, public
  passport and independent verification on desktop and mobile. A controlled EIP-1193 bridge
  signs using unlocked Anvil accounts and forwards actual RPC results. Includes wrong-chain
  correction, rejected signatures, wrong-creator denial, wallet change and a verification
  failure followed by retry with exactly one transaction. The app fetches its exact local
  evidence route through a development-only configured-origin guard; production remains
  restricted to public HTTPS. The test explorer explicitly reports source unavailable.
* Foundry: original registry unit tests, 1,024-run fuzz property and stateful invariant
  (256 runs, 128,000 calls, zero reverts).
* Live reads: network ID, factory code, historical launch logs and real token analysis.
  These do not send transactions or prove the new live creator/proof flow.

Real browser-extension and mobile WalletConnect relay compatibility, live IPFS uploads,
an external webhook receiver, downstream paging, real billing and remote GitHub Actions
execution were not live-verified. No production performance improvement was measured;
PILOT.md contains proposed budgets only.

## Monitoring follow-up

The new cases cover bounded rolling-window expiry; terminal RPC 429 counting; queue
baseline age, network binding, growth and unknowns; signed alert requests and destination
refusal; returned/early API errors; failed-indexer monitoring; database-outage fallback;
atomic alert enqueueing, concurrent workers, event order, stable retry IDs, exhaustion,
lease takeover and stale acknowledgements; persisted report baselines and backoff status.
A PostgreSQL trigger forces an actual rollback failure: events, balances and cursor remain
unchanged, then the same reorg recovers after the failure is removed. The legacy upgrade
test now verifies the monitoring tables as well as existing proof data.

One existing Anvil integration case exposed a timestamp-dependent gas estimate: a
36,374-gas estimate exhausted exactly that limit after advancing the next block timestamp.
The fixture now deliberately crosses that boundary and uses a 20% gas margin. It keeps
all receipt/hash assertions and adds no automatic test retries. The full rerun passed.
No Solidity or production transaction-gas policy was changed.

## Dependency remediation and compatibility

The original critical/high/moderate audit findings have been removed. Direct versions are
pinned; unused optional adapters and the bundled WalletConnect application UI are absent
from the fresh lockfile. The protocol connector uses a local QR dialog. Scoped UUID and
esbuild updates pass the actual MetaMask filesystem consumer and Drizzle CLI checks.
[Audit summary](dependency-audit-summary.json) records the zero-advisory result and limits.
High/critical findings still fail CI; no advisory suppression or scanner allowlist was added.
