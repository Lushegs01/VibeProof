# Indexer technical assessment (2026-10-03)

This is the audit that preceded the real-data ingestion work. It records what the
repository did at commit `7507ee0`, what was verified against live public sources, and
which problems the subsequent changes address. Evidence that came from live calls is
marked **(live)** with the date it was observed.

## 1. What already worked

* **Launch indexing.** `VibeIndexer.indexLaunches` read factory logs per deployment,
  decoded them, filled missing ERC-20 name/symbol with one multicall per 200 tokens, and
  committed each range atomically with its per-deployment cursor.
* **Activity tail.** Topic-only `Transfer` and curve-event queries, filtered locally to
  "covered" tokens. Holder deltas were applied only for rows that were actually inserted
  (`ON CONFLICT DO NOTHING … RETURNING`), so replaying a range could not double-count.
* **Tail clamping.** The tail never passed the slowest launch cursor, so a token could not
  be marked covered while its early events were skipped.
* **On-demand backfill.** Opening a passport for an older launch queued a per-token history
  backfill that the indexer processed later.
* **Coverage model.** Counters were `null` (unknown) unless the token's complete history
  was indexed. The UI rendered `null` as "Unavailable".
* **Mutual exclusion.** A Postgres advisory lock allowed only one indexer per database
  (`npm run indexer` and `/api/cron/indexer` share it).
* **SSRF guard.** `safeFetch` validates every resolved IP inside the socket lookup
  (anti-rebinding), re-validates redirects, and caps time and body size.
* **Tests.** 144 Vitest tests and 20 Foundry tests passed at baseline.

## 2. What required configuration

* `DATABASE_URL`, plus a provider RPC URL for anything beyond development.
* `CRON_SECRET` for scheduled runs; `SESSION_SECRET` in production.
* The indexer had to be started separately. Nothing ran it automatically.

## 3. Why a newly deployed instance shows no data

1. Without `DATABASE_URL` every service returns empty or unavailable data.
2. With a database but no running indexer, `launches` and `tokens` stay empty. The web
   app never writes launches itself.
3. Even after launches are indexed, activity counters for all tokens launched before
   `head − 100,000` stayed `null` until someone opened each passport. On testnet that is
   ~99% of the ~146k launches. Discover sorts by holders or transactions therefore showed
   almost nothing.
4. The scheduled job needs both `VIBEPROOF_URL` and `CRON_SECRET` repository secrets. It
   silently does nothing without them.

## 4. Missing for a reliable initial backfill

* **No automatic historical activity backfill.** Only passport views enqueued backfills.
* **One token per backfill job.** Each job made two `eth_getLogs` calls and up to
  thousands of header calls. 146k tokens would take ~300k+ RPC calls.
* **Timestamps for sparse wide ranges.** `TimestampResolver` fetched an anchor header
  every 500 blocks across the *whole* `[min, max]` span. A 13M-block backfill would fetch
  ~26k headers even if events sat in a handful of blocks. **(live)** Both public RPCs
  return `blockTimestamp: 0x0` in `eth_getLogs`, so headers are the only source.
* **Missing token fields.** Only name/symbol were fetched, and only when the event lacked
  them. `decimals` and `totalSupply` stayed empty until a passport was opened.
* **A failed metadata multicall aborted the whole launch range.** One provider failure
  stalled launch discovery.
* **A NUL byte stalled the indexer.** A token name or symbol containing `\u0000` would
  throw in Postgres, abort the range transaction, and block the cursor permanently.
  Launch names are arbitrary user input.

## 5. Missing for continuous synchronization

* No reorg detection. Cursors were trusted unconditionally, and the indexer indexed
  right up to `latest`.
* Cursor writes were blind upserts. If the advisory-lock connection dropped, a second
  writer could interleave.
* The backfill queue had no status, attempt count, backoff, dead-letter or stale-claim
  recovery. A permanently failing token was retried every tick forever, ahead of newer
  jobs.
* There was no persisted heartbeat. `/api/health` could not say when the last successful
  tick or launch discovery happened, because indexer metrics lived in another process.
* There was no metadata ingestion at all. `metadata_uri` was stored and never fetched.

## 6. Missing for mainnet support

* `CHAIN_ID = 46630` and `"robinhood-testnet"` were hard-coded in 9 service files, the
  SIWE verifier, the request proxy, explorer links and components.
* `getChainConfig()` only knew testnet. Blockscout, RPC and analysis evidence strings all
  pointed at testnet.
* **(live)** Mainnet's public RPC enforces log-query limits the provider did not handle:
  * topic-only queries are capped at 30,000 blocks;
  * multi-address queries at 100,000 blocks;
  * the error text says how many blocks are allowed ("only 30000 are allowed").

  The old code only halved on a regex match. From the 2M-block chunks it used, that would
  have needed ~7 failed round trips per range.

## 7. Incorrect assumptions in the Vibe configuration

Verified **(live, 2026-10-03)** against the public app bundle at
`https://testnet.vibevibe.fun` (`vibevibe.fun` redirects there) and against the chain:

| Assumption in repo | Reality |
| --- | --- |
| v5 factory emits only `TokenLaunched` | It also emits `TokenLaunchedQuoted(…, address quoteCurrency, …)`, topic `0x34041bc5…`. One real event was found: launch 2423, token `0x30Bf…b8e3`, block 116,883,321. It was silently skipped, so that token was never indexed. |
| v5 curve `Bought`/`Sold` "not yet observed" | Observed: a recent v5 curve emitted 196 `Bought` and 813 `Sold`. |
| `CurveCompleted` means graduated | `CurveCompleted` marks the curve reaching its target. `Graduated` is the migration event. Both are emitted, so they need separate statuses. |
| v6 deploy block 123,503,237 (bundle) | The factory creation tx `0xcb766520…` is in block **123,503,472**. The first `LaunchCreated` is at 126,070,172. The bundle value is safe (earlier) but is not the creation block. |
| Protocol exclusions = zap, hook, locker, buyback, poolManager (+ v5 set) | The bundle also lists `pairPolicy` (`0x48CF…cc84`) and `giftLists` (`0xb78F…88Be`). Vibe's own UI excludes `pairPolicy` from holder lists. |
| Graduation-type events identify Vibe curves | **(live)** Topic `Graduated(bytes32,uint256,uint256)` is emitted by 2,146 distinct contracts, some before the v5 factory existed. Only events from a token's own registered curve may be used. The old code did this correctly. |
| Metadata URIs are opaque | **(live)** All sampled URIs are `ipfs://bafkrei…` (CIDv1, raw codec, sha2-256). The JSON follows the bundle schema `{schemaVersion, chainId, name, symbol, description, creator, image, socials{website,x,telegram,discord}, projectTypes}`. The v5 `metadataDigest` equals `keccak256(metadata bytes)`. Both can be verified cryptographically. |
| Any Vibe deployment on mainnet | **None found.** The bundle has deployment config only for chain 46630, and none of the factory or protocol addresses have bytecode on 4663 (only the Uniswap v4 PoolManager, which is at the same deterministic address on both chains). A full scan of mainnet blocks 0–78,940,315 for all three launch topics returned **zero** logs (2,632 × 30k-block queries, 0 failed ranges). |

Current live state:

* **v6 `run15`:** 4,069 launches (blocks 126,070,172 → 128,041,207+).
* **v5 `live`:** 142,384 `TokenLaunched` and 1 `TokenLaunchedQuoted` (blocks 115,461,989 → 127,740,433+).

Both factories were still emitting launches when checked. Neither has verified source on
Blockscout.

## 8. Data integrity risks found

| Risk | Consequence | Fix |
| --- | --- | --- |
| Chain reorg after a committed range | Events from orphaned blocks persist and holder balances drift permanently | Block-hash checkpoints, ancestor search, rollback with reversed holder deltas, cursor rewind, replay |
| Blind cursor upsert | Two writers that both believe they hold the lock interleave ranges | Compare-and-set cursor advance inside the range transaction |
| Unlimited backfill retries | A poison token is retried every tick and starves the queue | Attempts, exponential backoff, dead-letter status |
| Interpolated timestamps presented as exact | Evidence overstates precision | Store `timestamp_exact`; label interpolated timestamps |
| `\u0000` in names/metadata | Range transaction fails forever; indexer stalls | Sanitize strings before persistence |
| Metadata multicall failure | Whole launch range rolls back | Persist the launch with `null` fields and `meta_status = error`; repair later |
| `CurveCompleted` → `graduated` | Wrong graduation status and feed entries | Separate `curve_completed` status |
| RPC URL with API key in logs/health | Provider key leaks through error messages (viem includes the URL) | Redact URLs in every logged and returned error |
| Graduations not in `transaction_events` | Cannot be rolled back on reorg; not replay-addressable | Store as events keyed by `(chain_id, tx_hash, log_index)`; recompute launch status from them |
| Feed rows without block numbers | Cannot be rolled back on reorg | `feed_events.block_number` |

## 9. Provider behaviour observed (live)

| Behaviour | Testnet (`rpc.testnet…`) | Mainnet (`rpc.mainnet…`) |
| --- | --- | --- |
| `eth_chainId` | `0xb626` (46630) | `0x1237` (4663) |
| Topic-only `eth_getLogs` span | Large ranges accepted | ≤ 30,000 blocks |
| Multi-address span | Large (≤ 1,000 address+topic selectors) | ≤ 100,000 blocks |
| Single address span | Large | Large |
| Max logs per response | 10,000 (`logs matched by query exceeds limit of 10000`) | 10,000 |
| `blockTimestamp` in logs | `0x0` | `0x0` |
| Historical state (`eth_getCode` at old block) | Not available (not an archive node) | Not tested |
| Rate limiting | HTTP 429 under load | HTTP 429: 1,615 retries over 2,632 requests at concurrency 4 |
| JSON-RPC batching | Rejected | Not used |

Other explorer and gateway findings:

* `robinhoodchain.blockscout.com` (mainnet explorer) served a Cloudflare challenge page to
  this environment. VibeProof treats that as "explorer unavailable" and does not attempt
  to bypass it.
* The testnet Blockscout API is reachable.
* Public IPFS gateways are in flux. `ipfs.io` and `dweb.link` now return 429 ("switching
  to a service worker gateway"). `ipfs.filebase.io` and `*.ipfs.4everland.io` served
  content.
