# Commercial pilot and measurable product validation

Paid capacity must never determine factual verification labels. Public passports,
basic histories and standard evidence checks remain available to all tiers.
Plans currently define capacities, not prices, revenue or market demand. Checkout is
explicitly a test adapter and cannot activate a subscription or charge a wallet.

## Six-week pilot proposal (not an executed campaign)

| Audience | Pilot task | Evidence of usefulness |
| --- | --- | --- |
| Token creators | Submit canonical evidence and complete control + anchor verification | Completed submissions and reproducible commitments |
| Launchpads | Integrate passport links and launch discovery | Traceable launches and returning linked visits |
| Researchers | Inspect creator timeline and evidence history | Repeat investigations and cited source records |
| Trading communities | Watch network-specific assets and review significant changes | Weekly retained watchlists and useful notifications |
| Wallet developers | Integrate API v1 and an iframe badge | Successful API consumers and readable provenance |
| Analytics teams | Receive signed event webhooks | Delivery acceptance, retries, replay handling and conversion interest |

Week 1: recruit a small, explicitly consented cohort through operator-owned channels.
Weeks 2–3: observe tasks and fix failed journeys, measure response and infrastructure cost.
Weeks 4–5: compare free/professional/developer workflow capacities without changing truth.
Week 6: interview participants, review measured retention and costs, and decide pricing
and which provider to integrate. No outreach or invitation messages were sent by this task.

## KPI definitions and collection state

| Metric | Definition | Actual collection currently available |
| --- | --- | --- |
| Verified creators | Distinct creator wallets with current control evidence, separately from anchored integrity | Query ownership_challenges and independently verified receipts; not a safety metric |
| Proof submissions | Count of retained canonical documents plus current project submissions | proof_documents / project_proofs; not invented adoption |
| Independently verified anchors | Successful verifier results with network, hash and confirmation policy | Endpoint response; durable analytics collection not implemented |
| Returning visitors | Consented repeat visits to passports | Not collected; privacy-preserving analytics decision needed |
| Watchlist retention | Wallet watchlists remaining active week-to-week | Current wallet_watchlist; longitudinal analytics snapshots not implemented |
| API usage | Count of credentialed API requests by month | Atomic usage_counters; anonymous traffic is separately rate-limited |
| Notification engagement | Opened/acted-on significant notifications | Not instrumented as marketing analytics |
| Webhook reliability | Accepted, retried, dead deliveries per subscriber/event | webhook_deliveries |
| Pilot conversion | Consented pilots requesting a paid capacity tier | Not collected; test checkout reference is not a sale |
| Cost per asset | Actual provider/database/hosting cost divided by indexed assets | Requires real invoices and measured ingestion; no cost claims made |

No users, revenue, conversion, demand, testimonials or retention values are asserted.
Implement authenticated provider webhooks and billing idempotency only after a provider
and pricing are approved. A reviewed operator allocation can provision pilot capacity;
a client request cannot self-upgrade account_plans.

## Performance budgets to validate on staging

These are targets for evaluation, not observed results or promised improvements:

| Operation | Proposed budget | Measurement |
| --- | --- | --- |
| Cached passport | p95 < 250 ms | External HTTP timings with cache provenance |
| Cold passport | p95 < 5 s on provisioned RPC | Trace database, explorer and bounded RPC separately |
| Search | p95 < 500 ms | Realistic indexed dataset, escaped queries and concurrency |
| Typical indexed lookup | p95 < 100 ms | PostgreSQL explain/analyze and connection wait |
| Indexer / backfill | Stay within configured lag and retry budget | Persisted execution receipts, cursor movement, queue age |
| API | p95 < 1 s for stored-data routes | Per-route latency and failures, separate cache hit/miss |
| RPC retries | Bounded attempts and backoff as provider policy | Provider telemetry including 429/error kinds |
| Notifications / webhooks | p95 < 10 minutes after committed event at normal load | Event observation to delivery timestamps; five-minute scheduler baseline |
| Initial page / mobile interactions | Core Web Vitals budgets: LCP < 2.5 s, INP < 200 ms | Consented field data plus controlled desktop/mobile runs |

The baseline README's historical latency samples are not a current benchmark.
No before/after production load test or field performance result was collected here.
