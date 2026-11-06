# Engineering implementation report — updated 2026-11-06

This is a substantial implementation across the ten requested workstreams. It is not a
claim that the entire platform is production-certified or that every acceptance criterion
has been met. The local patch is reviewable; no production deployment, public-chain
transaction, live IPFS upload, external alert message, charge or outreach was performed.

Baseline: `57d9982cfe30a3619abd6ff8a5f8933d4bbd1a8f`. See [baseline](BASELINE.md),
[deployment/recovery](DEPLOYMENT.md), [security review](SECURITY.md), and
[pilot/performance budgets](PILOT.md). Full source brief was an uploaded attachment.

## Workstream results

| # | Original issue and implemented change | Main files | Tests and remaining limits | Status |
| --- | --- | --- | --- | --- |
| 01 | Missing scheduler secrets silently produced green runs. Added exact HTTPS host allowlist, configuration checks, bounded/validated responses, classified errors and safe dispatch. Jobs persist chain/cursor/head/lag/work/duration receipts. Liveness and strict freshness readiness are separate. | `.github/workflows/indexer-cron.yml`, `scripts/trigger-indexer.mjs`, `src/indexer/job.ts`, `src/indexer/result.ts`, health/readiness routes and services | Scheduler state tests, advisory lock and cursor integration tests. Hosting secrets and a live scheduled invocation remain unconfigured. | Partial; live verification blocked |
| 02 | All failed networks could return success. Added success/partial_success/skipped/failed semantics, error HTTP, visibility of metadata/repair/analysis failures, preserved completed ticks on later failures, persisted runs, protected operations view, sustained/deduplicated/cooldown/recovery alerts. Added persisted queue-growth baselines, rolling RPC/API telemetry, independent monitor job and leased signed alert outbox. | `src/indexer/{job,indexer,result}.ts`, `src/lib/services/{alert,operations,health}-service.ts`, `/operations`, `/api/ops` | State matrix, queue growth/unknown/recovery policies, PostgreSQL outbox concurrency/retry/fencing and atomic rollback failure/recovery tests pass. Logs and optional signed HTTPS delivery are implemented. Live receiver, total-outage paging, fleet metrics and representative load remain unverified. | Implemented locally; external validation outstanding |
| 03 | Mutable API proof URI could not reproduce original bytes. Preserved v1 hash format and deployed registry; store canonical historical bytes by hash, optionally pin exact IPFS raw blocks, use immutable URI in wallet flow. Independent verifier checks public receipt, current/historical record, canonical blocks, depth and exact bytes; optional launch receipt establishes authority. | `src/lib/proof/{metadata,storage,verify}.ts`, `src/lib/services/proof-service.ts`, registry ABI, evidence and verify routes, submit/passport components | Deterministic canonical/hash/CID/verifier tests and real local Anvil lifecycle and desktop/mobile wallet browser tests. Database-backed availability depends on app retention; live IPFS and public-chain proof flow unverified. The service test injects retrieval; browser tests retrieve the real local route through a development-only exact-origin/content-hash guard. | Partial; live provider validation blocked |
| 04 | Mere address mentions used generic verified label; stale checks stayed positive. Mentions are observations, with explicit assurance/expiry. Added random wallet/token/chain/target control challenges, 30-minute expiry, atomic replay protection, seven-day validity, daily bounded rechecks and historical control records. | `src/lib/proof/{checks,challenges,freshness}.ts`, control route, submit challenge UI, passport proof presentation | Unit and PostgreSQL creator/expiry/replay tests. GitHub rename/archive checks and redirect refusal are implemented; full transfer/revocation and provider-outage recovery browser scenarios remain incomplete. | Partial |
| 05 | No reproducible complete proof journey. Added local Anvil factory fixture, service journey and desktop/mobile wallet browser journey: real launch log → indexer → real SIWE → canonical document route → wallet-signed registry transaction → receipt/hash/launch verification → proof section, with replay rejection. Existing browser discovery journeys retained. | `test/fixtures/LocalLaunchFactory.sol`, `tests/integration/registry-anchor.test.ts`, production-foundation and verifier tests, `tests/wallet/*`, `playwright.wallet.config.ts` | Local EVM flow and desktop/mobile discovery are distinct evidence. Six browser tests use a controlled EIP-1193 wallet with real local signatures/transactions, including wrong-chain correction, wrong creator, signature rejection and retry without duplicate transactions. Real extension/relay compatibility remains unverified. No public testnet write was performed. Read-only live RPC tests separately passed. | Partial |
| 06 | No CI quality gate. Added lockfile install, static type/migration checks, changed-source formatting, unit/DB/Anvil tests, Foundry unit/fuzz/invariant, production/demo builds, desktop/mobile browser tests, audit and redacted secret scan. Added configuration validation and readiness smoke command. | `.github/workflows/ci.yml`, `scripts/{format,validate-environment,validate-migrations,smoke}.mjs`, package files, `.gitleaks.toml` | Commands run locally; remote Actions workflow is not executed in this session. A clean locked install reports zero npm advisories; scoped patch compatibility checks and the final browser suite cover the wallet migration. | Implemented locally; remote CI unverified |
| 07 | Untrusted forwarded-host SIWE binding, weak session revocation and production rate-limit fallback. Added fixed-origin unsafe-request checks, body cap/deadline, explicit SIWE issue/expiry/URI, chain-bound random sessions and revocation, production shared Redis fail-closed, ingress trust, recursive redaction and stricter incomplete-stream/IPv6 handling. Patched dependency advisories and removed unused/bundled wallet application stacks. | Auth/request/session/SIWE, cache limiter, API wrapper, safe fetch/URL guard, chain provider, logging, `docs/engineering/SECURITY.md` | Real-signature/session/concurrency/security tests; source/history scans. RPC trust, external penetration/audit, CSP nonce migration and real wallet extension/relay compatibility are documented residual risks. | Partial |
| 08 | Creator history lacked durable continuity evidence. Added canonical-block contract observations and known-to-known implementation/owner/admin differences with explicit limitations. Creator timeline includes source-linked launches/graduations/proofs/control/contract changes. Retained original activity definitions and unknown handling. | `src/lib/services/history-service.ts`, token/creator services, creator page, contract-observations migration | Existing creator/indexer tests cover integration. Continuous monitoring of every historical token, full confidence framework and exhaustive reorg tests for observation history remain incomplete. No wallet identity clustering or safety score added. | Partial |
| 09 | Local-only watchlists, no delivery platform. Added authenticated chain-aware watchlists and explicit local preservation/sync, paginated significant-change notifications, encrypted endpoint secrets/ownership challenge, signed leased idempotent webhook deliveries with backoff/dead state/logs/disable, API credentials/revocation/usage, v1 discovery pagination/OpenAPI/provenance, badge freshness. | Watchlist/developer/billing services, `/api/watchlist`, `/api/notifications`, `/api/developer/*`, `/api/v1/*`, `/developers`, watchlist/badge UI | PostgreSQL race, replay, ownership, retry, HMAC and encryption tests. Actual external receiver delivery and sustained historical-load latency are not verified. Broad export/org/integration capabilities remain foundations. | Partial |
| 10 | No neutral entitlement/commercial foundation. Added configurable capacity plans, subscription state, atomic server quotas and monthly API accounting, usage UI, provider-independent billing interface and explicit no-charge test adapter. Pilot/KPI/performance-budget definitions distinguish collected data from proposals. | `src/lib/billing/*`, account/developer APIs and UI, `docs/engineering/PILOT.md` | Plan/adapter and concurrent last-unit quota tests. No real provider, charges, analytics adoption/revenue or pilot outreach. These require business/provider decisions and explicit activation. | Partial; live billing intentionally inactive |

## Architecture and compatibility decisions

* Preserve Next/React/Drizzle/PostgreSQL/Redis/viem and launchpad/provider abstractions.
* Preserve deployed VibeProofRegistry and historical v1 canonicalization. Its permissionless
  design requires independent consumer authority checks; no contract upgrade is necessary.
* All new chain-derived rows include chain ID. Registry settings are network-specific.
* Migrations 0003–0007 add tables, nullable proof URI and supporting indexes; no production
  reset, destructive migration or historical data rewrite. Test schemas are disposable only.
* API v1 preserves existing token fields and adds provenance; discover uses bounded keyset
  pagination. Credentialed reads are not publicly cacheable and account usage atomically.
* Scalar integrity reads avoid automatic Multicall3 batching; explicit bulk multicall remains.
  Head reads use in-flight deduplication with no one-second value cache, so immediate local
  mining does not cause stale confirmation calculations. No speedup claim is made.
* Database CAS is the default exact-byte store. IPFS uploads require explicit provider config.
  Matching either hash never endorses the truth of creator claims.
* Every selected evidence backend retains the canonical document in PostgreSQL. Public
  provider hostname and persistence implications are disclosed before submission.
* WalletConnect uses its protocol provider and a local, cancellable QR dialog. Pairing
  URIs stay in memory. MetaMask and injected wallet support remain. Direct dependency
  versions are exact; scoped UUID/esbuild overrides remove remaining transitive findings.
* Wallet changes discard stale submissions. Retry after receipt verification failure reuses
  the original transaction and the configured confirmation depth is passed from the server.
* Operational monitoring persists queue baselines and condition transitions in PostgreSQL.
  A separate job probes it even if indexing fails. Signed delivery uses a fenced outbox;
  retry backoff and exhausted deliveries remain degraded. Unknown data never clears incidents.
  RPC/API rolling measurements explicitly identify their process and observation scope.
* Paid capacities remain outside verification decisions; checkout cannot self-upgrade users.

## Verification results

Current validation passed 294 deterministic tests, five separate live read tests, 21 Foundry tests and 17 desktop/mobile browser tests across the demo and wallet suites, with no failures in those final runs. Production/demo builds, TypeScript/static checks, migration checks, formatting and secret scanning passed. The clean installed dependency tree reports zero npm advisories. Historical failures
were corrected, rather than excluded for a green result. Live RPC checks are explicitly
opt-in; CI uses deterministic local services. No fixture is presented as live-chain evidence.

See [TESTING.md](TESTING.md) for exact commands, skips, counts and remaining external validation. The operational follow-up is detailed in [MONITORING.md](MONITORING.md). Changes are also exported as `/workspace/vibeproof-review.patch`; the existing user/environment AGENTS.md and CLAUDE.md are excluded.

## Live read-only observations

Five live Robinhood testnet read tests passed using the managed environment’s inherited
HTTP proxy. A separate read on 2026-11-05 observed chain ID 46630 and head block
148959021, with 3,870 bytes of runtime code at registry
`0x47b639e587FdBf9A8323d030C9930744BfbF2F2E`.
See [recorded observations](live-read-observations.json). This proves those reads only:
it does not demonstrate live scheduled execution or the new complete proof lifecycle.
No public-chain transaction was sent. The testnet registry’s historical explorer link
remains [publicly inspectable](https://explorer.testnet.chain.robinhood.com/address/0x47b639e587FdBf9A8323d030C9930744BfbF2F2E).

## Engineering scorecard

Ratings describe the current patch, not an external evaluation. They are deliberately
limited by incomplete operational and end-to-end verification.

| Dimension | Rating / 10 | Evidence and ceiling |
| --- | --- | --- |
| Architecture | 7 | Existing boundaries retained, typed stores/adapters, additive schema; maintenance paths still coupled to cron |
| Security | 7 | Auth/SSRF/session/quota protections, adversarial tests and zero reported dependency advisories; independent review remains |
| Blockchain correctness | 7 | Atomic indexing/reorg regressions, local EVM receipts and commitment checks; no new live-chain acceptance evidence |
| Evidence integrity | 8 | Canonical exact bytes, historical CAS, codec-aware IPFS, independent reproduction; availability/provider/finality trust remains |
| Reliability | 7 | Honest statuses, durable queue-growth samples, independent probes, ordered/fenced alert delivery and tested recovery; external total-outage paging remains unverified |
| Scalability | 6 | Bounded queries, queues, account locking, API pagination and watchlist fetch concurrency; no representative load test |
| Performance | 5 | Existing caching and bounded RPC retained, budgets documented; no current before/after production measurements |
| Testing | 8 | Unit, DB, real-signature, Anvil, Foundry fuzz/invariant and desktop/mobile wallet browser journeys; public-chain write and real external providers unverified |
| User experience | 6 | Integrated challenge/proof/freshness/status/watchlist/developer flows; real relay/extension compatibility and accessibility audit incomplete |
| Developer experience | 7 | Reproducible commands, migrations, API spec, CI and recovery guide; remote CI execution remains unverified |
| Commercial readiness | 4 | Neutral plans, quotas, usage and test billing/pilot framework; no real billing provider, customer validation or economics |

The project must not be described as 10/10, independently audited, fully secure or
production-ready based on these changes. Review and resolve the listed release blockers,
then capture staging and live evidence before production rollout.
