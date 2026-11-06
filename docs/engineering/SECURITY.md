# Internal adversarial review and residual risks

This is an internal engineering review, not an independent security audit or a guarantee
of safety. A matching commitment is evidence integrity, not legitimacy.

| Boundary / threat | Implemented protection | Test evidence / limitation |
| --- | --- | --- |
| Scheduler silently skips | Explicit secrets/origin allowlist, redirect refusal, deadline, bounded JSON and validated execution receipts | Scheduler success, no-op, lock, timeout, auth and malformed-response cases |
| Failed networks appear successful | Explicit aggregate states and failing HTTP for partial/complete failure | State matrix and indexer integration regressions |
| Mutable anchored metadata | Deterministic v1 bytes, hash-addressed historical documents, optional explicit IPFS raw-block backend | Canonical/hash/storage tests and local EVM lifecycle |
| Permissionless registry used to impersonate creators | Document/event creator match; optional launchTx independently checks configured factory receipt | Verifier explicitly reports unverified authority without launch receipt |
| Reorg or unconfirmed anchor | Canonical block checks before/after retrieval and configurable minimum depth | Wrong-network, unconfirmed and reorg fixture tests; depth is not irreversible finality |
| Address mentions misrepresented as control | Mentions remain observed; separate random, scoped, single-use expiring challenges | Address-mention regressions, expiry/replay/creator challenge tests |
| SSRF / rebinding / redirects | Public URL validation and all-address DNS checks at socket connection; redirects revalidated; ownership and webhook redirects refused | Existing IPv4/IPv6 tests expanded for special-purpose IPv6; development-only loopback evidence retrieval is restricted to the exact configured origin and content-hash route |
| Oversized/slow bodies | 64 KiB authenticated API cap with deadline; bounded external response bytes; no response decompression; incomplete streams rejected | Boundary tests and existing safe fetch logic; external provider JSON responses still depend on configured provider trust |
| SIWE relay, replay, wrong chain | Configured origin/domain, explicit 10-minute issue/expiry window, URI host check, signature verification before atomic nonce consumption | SIWE integration with real signatures and replay cases; ERC-1271 remains RPC-dependent |
| Session theft / logout replay | HttpOnly/SameSite/Secure cookies, chain-bound random session ID, HMAC, revocation digest table | Revocation and network switch tests; compromise before logout remains session lifetime risk |
| CSRF | Unsafe route methods require exact configured origin; forwarded host is ignored | Origin regression tests; no cross-origin credentialed API writes are enabled |
| Rate-limit bypass or Redis outage | Trusted ingress header configuration; shared production Redis; fail closed on store errors | Spoofed header and production outage tests; bad ingress config can reduce fairness |
| Quota races / subscription changes | Account lock plus conditional usage increment and transaction-local entitlement lookup | Concurrent 25-request watchlist and last-unit usage tests |
| Webhook spoof / replay / leakage | Endpoint echo challenge, HTTPS SSRF-safe POST, AES-GCM secrets, timestamp+ID+body HMAC, stable IDs, leases/retries/dead state | Ownership/fanout/idempotency/retry/encryption tests; receivers must persist IDs |
| Truth sold through billing | Verification code has no paid-plan decision; test checkout never charges or grants paid state | Plan/adapter tests; real provider callbacks not implemented |
| Operational delivery spoof/replay/races | Explicit public HTTPS sink, DNS/redirect protection, raw-body HMAC, stable delivery IDs, ordered fenced leases and bounded retries | Signed transport, concurrent transitions, lease takeover and crash-exhaustion tests; receivers persist IDs |
| Secrets in logs | Recursive sensitive-key scrubbing, bearer and credential URL redaction; scanners redact output | Source Gitleaks scan; public addresses/topics and exact public Anvil key narrowly excepted |

## Release blockers and residual risks

1. A fresh locked installation now reports zero npm advisories. The bundled WalletConnect
   application UI was replaced by the protocol provider plus a local QR dialog, unused
   optional adapters were removed, and scoped UUID/esbuild fixes were compatibility-checked.
   This is dependency scanner evidence, not an independent security audit.
2. No public-chain transaction, production cron, live IPFS pin, downstream paging message,
   or real payment was performed by this patch. Configure staging and capture actual evidence.
3. Six desktop/mobile browser tests exercise the actual app, SIWE signatures, PostgreSQL,
   Anvil transactions, canonical document route and independent public verification. The
   browser wallet is a controlled EIP-1193 bridge to unlocked local accounts; extension,
   mobile deep-link and real WalletConnect relay compatibility remain external checks.
4. Registry records are permissionless and mutable by their creator. Historic receipts remain
   verifiable; current creator authority requires launch receipts or independently read ownership.
5. RPC/explorer truth is a trust boundary. Confirmation depth and repeat block checks detect
   common reorganizations but cannot prove a malicious RPC truthful. Cross-provider quorum
   and finality-tag policy need a chain-specific operational decision.
6. Database-backed content-addressed storage depends on database retention and original domain
   availability. Hash checking detects changed bytes; it cannot recover deleted content.
7. Operational transitions and deliveries use a durable outbox; queue-growth baselines survive
   serverless restarts. A separate GitHub job observes indexer failures, and direct emergency
   delivery can bypass an unavailable database. Independent readiness/workflow monitors remain
   necessary for total outages and durable outage recovery. No live receiver or remote job
   is claimed as verified. See MONITORING.md for metric scope and delivery assumptions.
8. Webhook delivery is at least once. Receivers must deduplicate stable IDs and reject stale
   timestamps. Disabling an endpoint cannot recall an already in-flight request. Event fanout
   runs in bounded scheduler batches and may lag behind large historical imports.
9. Control checks are point-in-time observations. Transfers, deleted repositories and revoked
   control are only discovered on recheck. A seven-day expiration never silently extends.
10. The CSP retains existing inline-script allowance for Next compatibility; a nonce-based CSP
    migration, distributed load testing and full penetration testing remain external audit scope.
11. Account/usage and new tables need retention, backup and recovery exercises. No production
    RPO/RTO, SLO or availability assessment has been measured.

## Recommended independent audit scope

Review SIWE ERC-1271/6492 paths, proxy ingress trust and CSRF deployment assumptions;
canonicalization and IPFS codec behavior; ownership challenge takeover/revalidation;
registry consumer authorization and receipt finality; SQL concurrency, reorg correctness
and cache invalidation; webhook leasing, encryption-key rotation and receiver replay rules;
quota/subscription provider integration; dependencies, supply chain and Vercel headers.
Use independent RPCs and adversarial controlled domains. Verify staging and production
observability separately. Do not treat this internal report as external certification.
