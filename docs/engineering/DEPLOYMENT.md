# Deployment, verification and recovery

This change does not deploy production infrastructure, change repository secrets, redeploy
contracts or enable charges. Review the implementation report and staging evidence first.

## Local database, cache and contracts

Use a disposable test database: the indexer integration suites deliberately recreate
its schemas. Never point DATABASE_URL_TEST at production.

```sh
npm ci
git submodule update --init --recursive
docker run -d --name vibeproof-db -p 127.0.0.1:5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=vibeproof_test postgres:17-alpine
docker run -d --name vibeproof-redis -p 127.0.0.1:6379:6379 redis:7-alpine
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/vibeproof_test
export DATABASE_URL_TEST="$DATABASE_URL"
export REDIS_URL=redis://localhost:6379
npm run db:migrate
npm run db:migrate
npm run forge:build
npm run forge:test
export ANVIL_BIN="$PWD/node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil"
npm run test:local
npm run lint
npm run format:check
npm run build
npm run test:e2e:build
npx playwright install chromium
npm run test:e2e
npm run test:wallet
```

The wallet browser harness creates/recreates only `vibeproof_wallet_test` using the
disposable DATABASE_URL_TEST administrator. It needs local PostgreSQL database-creation
permission, Chromium and compiled Foundry artifacts, and reserves ports 3200, 3201 and
8555. Route startup is warmed through real, status-checked requests before browser
assertions begin. If dependencies changed and the development server reloads repeatedly,
stop it and remove the generated `.next-wallet` directory before rerunning.
It never signs on a public network. Its EIP-1193 bridge signs with unlocked Anvil
accounts, forwarding actual RPC results rather than manufacturing successful receipts.

The Anvil test uses the public, well-known development account only on a loopback node.
Do not use that key on any public network. `npm run test:live` performs opt-in read-only
Robinhood testnet checks. Public-chain write demonstrations require a separately
configured funded wallet, review of the document/registry/network and an explicit wallet
transaction. Existing Foundry deploy scripts are unchanged; this architecture requires
no registry redeployment.

## Production configuration

Start with `.env.example`; set secrets in your hosting environment, never in Git.
Use the actual deployed HTTPS origin as NEXT_PUBLIC_APP_URL. Set SESSION_SECRET to
at least 32 random characters and CRON_SECRET to at least 16. Use `openssl rand -hex 32`.
Configure PostgreSQL and a shared Redis instance (`DATABASE_URL`/`POSTGRES_URL`,
`REDIS_URL`/`KV_URL`). Production API limiting fails closed when Redis is unavailable.

Set NEXT_PUBLIC_VIBEPROOF_NETWORK and INDEXER_NETWORKS explicitly. Each RPC must
report the expected chain ID. Use a provisioned production RPC rather than relying
on the throttled public endpoint. Set NEXT_PUBLIC_REGISTRY_ADDRESS for testnet and
ROBINHOOD_MAINNET_REGISTRY_ADDRESS separately if a mainnet registry actually exists.
Never copy the testnet deployment address to mainnet.

`TRUST_PROXY=true` trusts the *rightmost* x-forwarded-for address, and is appropriate
only behind an ingress that removes incoming forwarding headers and appends its own
client IP. Vercel uses its overwritten x-vercel-forwarded-for header. Without trusted
ingress configuration, requests share an unknown-client bucket; spoofed headers do
not create arbitrary limit buckets.

```sh
npm run env:validate
npm run db:migrate
npm run build
```

Run migrations once as a release job before assigning staging traffic. Migrations
0003–0007 are additive tables/columns/indexes. They do not rewrite historical rows.
Existing sessions must sign in again because session format is now chain-bound and
individually revocable. Historical proof hashes remain v1-compatible; mutable legacy
URLs may not contain original bytes, and are reported honestly.

## Scheduler: exact repository setup

In GitHub repository Settings → Secrets and variables → Actions:

* Secret VIBEPROOF_URL: the exact production HTTPS origin, without a path/query.
* Secret CRON_SECRET: exactly the value configured on the application.
* Variable VIBEPROOF_ALLOWED_HOSTS: comma-separated exact authorized hostnames,
  such as `vibe-proof.vercel.app`. No wildcard or suffix matching.

Run Actions → Indexer cron → Run workflow. Manual dispatch uses the same allowlist
and validation as the five-minute schedule. The workflow cannot accept an arbitrary
request destination. Missing configuration fails; it never prints the bearer token
or raw responses. Authentication, timeout, configuration, malformed-response and
execution errors are classified separately. Partial execution returns non-2xx, so
it cannot produce a successful scheduler result. An advisory-lock skip is acceptable
only with the exact lock reason. A caught-up zero-work execution is successful.

INDEXER_JOB_BUDGET_S must be 120–300. Ninety seconds are reserved for bounded
maintenance and operational checks. RPC calls already in flight can exceed a polling
boundary; use a dedicated long-running worker for larger ingestion workloads and
choose hosting time limits accordingly.

Validate `/api/live` for HTTP availability, `/api/ready` for database, Redis, RPC chain
binding and fresh indexing. `/api/health` supports legacy operational summaries;
`/api/ops` requires the cron bearer credential. `/operations` can display the protected
report without persisting credentials in browser storage. Do not share that credential
with untrusted browsers. Use a separate ingress authorization layer for operator access
where appropriate. A no-deployments network is explicitly identified, not counted as
indexed launches.

## Immutable evidence storage

Default `EVIDENCE_STORAGE=database` stores exact canonical bytes in append-only
content-addressed rows and serves `/api/evidence/0x…`. The URI includes the keccak256
hash and responses enforce the hash before serving immutable cache headers. This
requires continued application/database availability: it is not decentralized storage.
Back up proof_documents and keep old origins routed when changing domains.

For independently hosted content use `EVIDENCE_STORAGE=ipfs` with an explicitly
chosen HTTPS Kubo block API in IPFS_WRITE_API and optional IPFS_WRITE_TOKEN.
The operator must obtain the creator’s consent to that provider’s terms. The app
discloses the public provider hostname before submission, retains canonical bytes in
PostgreSQL, uploads exact raw blocks using CIDv1/raw/sha2-256, pins them, checks the returned CID
and verifies retrieval before returning an anchoring URI. Set IPFS_GATEWAYS to trusted
HTTPS gateway templates using `{cid}` and `{path}`. No arbitrary service is selected
for uploads. Other CID codecs are never compared naively to raw SHA-256 hashes.

PROOF_CONFIRMATIONS defaults to 12. This is a confirmation-depth policy, not a claim
of irreversible consensus finality. Set it after assessing chain finality and RPC trust.
The verifier checks receipt success, matching registry event, canonical block hash,
confirmation depth, current versus historical registry record, canonical bytes and
network/token/creator consistency. Provide launchTx to independently verify creator
identity against a configured launchpad’s public receipt. Without it creator authority
is explicitly unverified. The registry is permissionless: a matching commitment alone
does not prove the submitter launched a token.

Example read-only verification (no database trust):

```sh
curl --get 'https://YOUR_ORIGIN/api/proofs/verify' \
  --data-urlencode 'network=robinhood-testnet' \
  --data-urlencode 'txHash=YOUR_REAL_ANCHOR_TX' \
  --data-urlencode 'token=YOUR_TOKEN' \
  --data-urlencode 'creator=YOUR_CREATOR' \
  --data-urlencode 'launchTx=YOUR_REAL_LAUNCH_TX'
```

## Control challenges and freshness

Sign in on `/submit`, submit evidence and use “Verify website or repository control”.
Publish the random text at the displayed `/.well-known/vibeproof/{id}.txt` path.
GitHub challenges require that path committed on the repository’s default branch.
Challenges expire in 30 minutes, consume atomically once, and bind creator/token/chain/
target. Successful control evidence expires in seven days and is rechecked daily in
bounded scheduler batches. Address mentions are observations only. Reissue after
transfers or renames; no redirects are followed for ownership challenges. A successful
challenge cannot establish that a product works, is legitimate, or is safe.

## Monitoring and alerting

The GitHub workflow has separate indexer and monitor jobs. The monitor calls the protected
`/api/cron/monitor` endpoint, validates the response and fails on dependency, freshness or
alert-delivery problems. It runs even when the indexer job fails. Configure the same
repository secrets and exact host allowlist for both jobs.

Migration 0007 adds persisted queue baselines and an ordered, leased operational delivery
outbox. Structured logs are the default destination. Explicit `ALERT_WEBHOOK_URL` and
`ALERT_WEBHOOK_SECRET` enable a signed public HTTPS receiver. State changes and delivery
queueing commit together; HTTP sends occur outside database locks. Failed/backoff/dead
deliveries remain visible and degraded.

See [MONITORING.md](MONITORING.md) for all thresholds, metric scope, receiver signature
verification, retry/recovery behavior, dead-letter review and retention. A dead workflow
or total application/database outage still needs an independently hosted readiness
monitor. Emergency direct delivery is best effort. Actual external notification delivery
and remote workflow execution have not been verified here.

## Developer platform and billing

`/developers` provides usage, test checkout, developer credentials and webhook setup.
Public API is documented at `/api/v1/openapi`. API keys are shown once; only SHA-256
digests remain stored. Revoke through DELETE /api/developer/keys. Supplied invalid keys
never fall back to anonymous identity. Quotas and usage counters update under an account
lock; subscription capacity is read inside that transaction. Anonymous reads retain IP
limits. Authenticated usage responses are no-store.

Watchlists are persistent per SIWE wallet and network. The Watchlist page imports
local entries explicitly without deleting the local data. Legacy local entries are
interpreted as testnet, the network supported by the original local watchlist.
A plan quota failure preserves local items. Significant notifications come from
observed event kinds rather than routine transfer noise.

Webhooks require WEBHOOK_ENCRYPTION_KEY: 32 random bytes, hex encoded. Keep it in
secret storage and back it up; losing it makes stored signing secrets unrecoverable.
Endpoint secrets use AES-256-GCM at rest. Endpoints must be public HTTPS, cannot
redirect and must echo the signed endpoint challenge before activation. Deliveries
are leased, HMAC-SHA256 signed and retried up to eight times with exponential backoff;
exhausted attempts enter dead state. Disable endpoints using DELETE
/api/developer/webhooks. GET returns redacted delivery history. Consumers must verify
`v1=` signature over `timestamp.deliveryId.exactBody`, enforce ±300 seconds, then store
delivery IDs durably for idempotency. A fresh timestamp on retry does not mean a new event.

Plans are capacity definitions in src/lib/billing/plans.ts. The billing adapter is
explicitly test-only and never upgrades an account or charges. Operator-approved pilot
access may be provisioned by a reviewed account_plans change; a live billing integration
must verify provider callbacks and idempotency before enabling subscription changes.
No verification service reads paid status to determine factual results.

## Release, rollback, recovery and retention

1. Back up database and record current deployment, schema version and indexer cursors.
2. Run all quality gates; fail release on high/critical dependency advisories.
3. Validate environment and run additive migrations on staging; migrate twice to test repeatability.
4. Run deterministic tests, then the opt-in live RPC and funded-wallet procedure as appropriate.
5. Invoke the staging cron, compare execution receipts with persisted cursors and health.
6. Run `VIBEPROOF_URL=https://STAGING npm run smoke`. Review partial jobs and queues.
7. Obtain production deployment approval; deploy using the organization’s existing process.
8. Run smoke and inspect progress/freshness after deployment. Do not infer success from HTTP alone.

To roll back application code, restore the previous compatible deployment and leave the
additive tables/columns intact. Old code ignores them. Pause the scheduler before changing
indexer versions; advisory locks protect overlap but cannot replace release coordination.
Never drop proof documents to roll back. Restore backups to a separate database, verify
cursors/checkpoints and resume using normal reorg recovery. Requeue dead backfills using
the existing `--retry-dead` worker option after fixing the underlying cause.

Set a retention policy for indexer_runs, operational logs, delivered webhooks and expired
session revocations. Do not prune immutable evidence. Size test retention jobs on staging
before automating deletion. Retention automation and independent external audits remain
operator deployment work, not evidence of production validation in this patch.
