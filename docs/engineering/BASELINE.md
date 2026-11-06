# Baseline and execution scope

Baseline commit: `57d9982cfe30a3619abd6ff8a5f8933d4bbd1a8f`.
Inspection date: 2026-11-05. Local execution, not a production deployment.

The source brief was supplied as an attachment. Repository inspection covered README,
architecture, migrations, launchpad adapters, launch/tail/backfill/reorg ingestion,
metadata jobs, chain providers, health, SIWE/session handling, registry and receipt
validation, passport/creator/watchlist/submit rendering, tests and the scheduler.

The launch pipeline decodes allowlisted factory logs, commits rows and cursors together,
tails only through discovered launches, and backfills older launches using retry queues.
Event identities include chain ID, transaction and log index. Reorg recovery rewinds
checkpoints and derived counts. Provider requests already have bounded concurrency,
classified retries and telemetry. Mainnet and testnet have independent keys and config.
These systems were extended rather than replaced.

Initial results before implementation:

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run test:unit` | 214 passed |
| `npm test` without local PostgreSQL | 223 passed, 10 failed, 4 skipped; database connection failures |
| Integration rerun after starting isolated PostgreSQL | 17 passed, 5 live-network failures, 1 skipped (Anvil/artifact not yet installed) |

The initial checkout already had `node_modules` and untracked Next-generated AGENTS.md
and CLAUDE.md. Those user/environment files were preserved. No supplied environment
values were printed. Initial packages included Next 16.3.7, React 19.3.0, viem 2.57.1,
Drizzle 0.45.3 and Vitest 5.0.2; see lockfile for final resolved versions.

Confirmed initial defects included false overall job success when all networks failed,
scheduler success on missing secrets, generic verified labels for address mentions,
mutable proof URIs, stale checks retaining positive status, absent CI, untrusted
forwarded-host SIWE domain selection and local production rate-limit fallback.

Local PostgreSQL 17 and Redis 7 containers were started for tests. Foundry binaries
were installed as versioned development dependencies. Solidity 0.8.28 was obtained
from ethereum/solc-bin because the environment denies binaries.soliditylang.org.
No contract was deployed to a public chain; local Anvil deployments spend no real funds.
The initial direct Node RPC failures were resolved for read-only tests by using Node’s
NODE_USE_ENV_PROXY=1 support with the inherited managed proxy; final live reads are
reported separately from the local lifecycle.

Live deployment scheduling, live IPFS pinning, alerts to an external paging provider,
and funded testnet wallet verification require operator configuration and were not
inferred from fixture results. Performance targets are budgets, not measured speedups.
