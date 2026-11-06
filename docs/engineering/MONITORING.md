# Operational monitoring — 2026-11-06

The indexer and monitoring jobs run independently in the existing GitHub Actions workflow.
Both validate the exact HTTPS destination allowlist and fail on missing configuration,
authentication failure, timeout, malformed/oversized responses or unsuccessful execution.
The monitor calls `/api/cron/monitor` with the existing cron bearer credential. It returns
503 for unhealthy dependencies, stale indexing, monitoring errors or unresolved alert
transport errors, including retries currently waiting in backoff. Demo mode rejects it.
No remote workflow or external paging delivery has been executed in this workspace.

## Measurements and scope

* Health exposes heartbeat age, head/cursor/lag, backfill queues, metadata failures,
  stale proof backlog, Redis and live RPC probe status.
* RPC attempts use bounded ten-second buckets covering five minutes: errors, 429s,
  retry attempts and mean attempt latency. Exhausted 429s count even when no retry remains.
  Latency includes local concurrency waiting. No observations means null rates. Persisted
  provider snapshots become unknown once their indexer heartbeat is five minutes old.
* Wrapped API routes count every response, including rejected origins, rate limits,
  returned 5xx responses and unexpected limiter errors. Five-minute API statistics describe
  the current process. They exclude route handlers that do not use the shared wrapper.
  Aggregate logs in a monitoring provider for fleet-wide API rates or percentiles.
* Backfill retry share is the fraction of queue rows updated in the last five minutes
  whose attempts exceed one. It is a recent-job snapshot, not a count of every attempt.
* Indexer heartbeats persist reorg detections, successful recoveries, failed recoveries
  and failed indexer transactions. These are counters for that indexer instance. Database
  failures propagate; a failed rollback retains all events, balances and cursor positions.
* PostgreSQL `monitoring_samples` stores chain-specific queue baselines across process
  restarts. Queue growth compares against the newest baseline at least five minutes old;
  baselines older than thirty minutes, from another chain or missing measurements are
  unknown. Unknown observations never clear an active incident.

The operations page adds heartbeat age, RPC throttling and alert-delivery counters to the
existing protected report. Its credential remains in component memory. Public readiness
and liveness remain separate; the operational report requires the cron credential.

## Policies

| Setting | Default | Meaning |
| --- | --- | --- |
| `ALERT_SUSTAIN_S` | 300 | Condition must persist before firing |
| `ALERT_COOLDOWN_S` | 3600 | Minimum reminder interval while active |
| `HEALTH_MAX_TICK_AGE_S` | 900 | Indexer heartbeat freshness limit |
| `HEALTH_MAX_LAG_BLOCKS` | 2000 | Lag threshold used by stalled-cursor detection |
| `ALERT_MAX_DEAD_LETTERS` | 0 | Absolute dead-letter count threshold |
| `ALERT_MAX_PENDING_BACKFILLS` | 10000 | Absolute pending/started queue threshold |
| `ALERT_MAX_METADATA_FAILURES` | 100 | Threshold for each failed metadata category |
| `ALERT_MAX_RPC_ERROR_RATE` | 0.25 | Failed attempts / all attempts in observed window |
| `ALERT_MAX_RPC_THROTTLE_RATE` | 0.1 | HTTP 429 attempts / all attempts in observed window |
| `ALERT_TREND_WINDOW_S` | 300 | Minimum baseline age; positive |
| `ALERT_TREND_MAX_AGE_S` | 1800 | Maximum accepted baseline age; positive |
| `ALERT_DEAD_LETTER_GROWTH` | 1 | Dead-letter increase needed to fire; positive |
| `ALERT_BACKFILL_GROWTH` | 100 | Backfill queue increase needed to fire; positive |

Database/Redis failure, stale heartbeat, RPC/network mismatch, three consecutive failed
scheduled receipts and repeated reorg recovery failures are critical. Queue growth,
metadata failures, throttling, provider errors and a lagging stationary cursor are warnings.
A stationary cursor at head is healthy. Conditions use sustained detection, reminders and
recovery events; policy state is serialized in PostgreSQL to deduplicate overlapping jobs.
Monitoring executes even when indexing or downstream maintenance throws.

## Delivery contract

By default, the durable delivery queue emits structured JSON logs. To use an owned HTTPS
receiver, explicitly configure `ALERT_WEBHOOK_URL` and a random `ALERT_WEBHOOK_SECRET`
(at least 32 characters). The endpoint must have no embedded credentials, query or fragment.
Transport refuses private/reserved DNS addresses and redirects, caps response bytes and
has a five-second deadline. Provider error bodies and credentials are never retained.

Each request carries the exact JSON condition event (`key`, `kind`, `severity`, `at`) and:

* `x-vibeproof-id`: stable durable delivery ID, reused for every retry.
* `x-vibeproof-timestamp`: Unix seconds for this delivery attempt.
* `x-vibeproof-signature`: `v1=` followed by hex HMAC-SHA256 of
  `timestamp.deliveryId.exactBody` using the configured secret.

Verify the signature over raw bytes, allow a bounded timestamp window (the existing
`validWebhookSignature` helper uses ±300 seconds) and persist delivery IDs for replay
protection. Return a 2xx response after recording the event durably. A matching signature
establishes transport authenticity; it does not establish any project's legitimacy.

Condition state and queue entries commit together. Delivery occurs outside state locks.
Workers claim with `SKIP LOCKED`, a sixty-second lease and a unique lease token. A late
worker cannot acknowledge a newer claim. Events for one alert key remain ordered; a
recovery cannot overtake an earlier pending firing event. Delivery is at least once.
Retries have fresh signatures but stable IDs. Eight claimed attempts are allowed, with
60-second exponential backoff capped at one hour. Exhaustion, including eight interrupted
leases, moves the row to `dead`. Monitoring remains degraded during failure backoff.

After fixing the receiver, an operator may requeue a reviewed delivery using its exact ID:

```sql
update operational_alert_deliveries
set status='pending', attempts=0, next_attempt_at=now(), lease_token=null, last_error=null
where id='REVIEWED_DELIVERY_ID' and status='dead';
```

If consciously accepting a lost alert, mark that exact dead row `acknowledged` and clear
`last_error`; do not mark an undelivered message `delivered`. Recovery may proceed after an
earlier event becomes dead. Configure receivers to ignore recovery for inactive incidents.

When PostgreSQL is unavailable, monitoring logs an emergency event and attempts direct
signed delivery using a stable five-minute emergency ID. This is best effort: a total
database outage cannot persist deduplication, retries or recovery state. An external
readiness monitor is still needed for durable total-outage and recovery paging, and to
notice a disabled GitHub workflow or unreachable app. No such external monitor is claimed
as configured by this patch.

## Deployment and retention

Migration 0007 adds monitoring baselines and the delivery outbox without modifying existing
proof or indexer rows. Apply it twice on staging to check repeatability. Configure the
existing workflow secrets and host allowlist as described in DEPLOYMENT.md, then inspect
both jobs and compare the monitor receipt with the protected operations view. A real
receiver must be verified by the operator; deterministic tests inject its transport and
never fabricate a successful public delivery.

Retain enough monitoring samples to exceed the configured maximum baseline age. Seven days
is a reasonable starting policy to size on staging. Archive or prune delivered/acknowledged
alert rows separately; preserve pending, processing and dead rows until reviewed. These
operator retention jobs are not automatically enabled, and immutable proof bytes must
never be pruned with operational logs.
