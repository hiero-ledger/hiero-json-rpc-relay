# Compact History — Issue #4900: Reduce JSON-RPC Relay Memory Footprint

**Branch:** `4900-v4-solo-reduce-json-rpc-relay-memory-footprint`  
**Repo:** `hiero-ledger/hiero-json-rpc-relay`

---

## Background & Manager's Ask

The manager's core request:

> **"Find the smallest pod memory limit the Relay can run under while sustaining ≥100 TPS to the Consensus Node, and make it work."**

More specifically:

- The Relay is deployed in Kubernetes with a memory limit pod constraint.
- The team needs to prove it can handle a production-grade load (`eth_sendRawTransaction` at 150 RPS) inside a small pod (target: as low as **104Mi**).
- The current situation: the relay OOMKills at 128Mi under load. The root causes needed to be found and fixed in code and configuration — not just bump the limit.
- Everything must be validated with a reproducible CI benchmark pipeline using **Solo** (a local Hedera network in Kind), **k6** (load generator), and **GitHub Actions**.

---

## Phase 1 — Benchmark Pipeline (Early Sessions)

### What was built

A full CI pipeline in `.github/workflows/solo-test.yml`:

1. **Build** — Docker image of the relay tagged as `library/relay-local:0.73.0`.
2. **Solo setup** — Kind cluster, metrics-server, consensus node, mirror node, accounts, bootstrap relay.
3. **Port-forwards** — Relay (`7546`), Mirror Node REST API (`8081`), Consensus Node direct bypass (`50211`).
4. **k6 prep** (`prep-cn`) — Fund 30–150 wallets, pre-sign 500 txs each, persist to `.smartContractParams.json`.
5. **Bootstrap relay teardown** — Destroy the plain relay; launch the matrix-specific memory-constrained relay.
6. **Re-port-forwards** — Re-establish all three ports with fresh TCP connections.
7. **k6 benchmark** (`cn-benchmark`) — `constant-arrival-rate`, 150 RPS, 60s, only `eth_sendRawTransaction`.
8. **Verify TPS** (`verify-cn-tps`) — Query Mirror Node for contract results; assert measured TPS ≥ 100.
9. **Diagnostics** — Pod resource sampling every 15s, relay log streaming, OOMKill detection, V8 heap metrics, cgroup memory events, Mirror Node logs.

### Matrix strategy (10 runs in parallel)

| Memory limit | `--max-old-space-size` | VUs         |
| ------------ | ---------------------- | ----------- |
| 256Mi        | 192                    | 150, 100    |
| 128Mi        | 96                     | 100, 50     |
| 112Mi        | 84                     | 100, 50, 30 |
| 104Mi        | 78                     | 100, 50, 30 |

---

## Phase 2 — Root Cause Investigation

### Symptom

k6 reported **p95 `http_req_waiting` > 3 seconds** on `eth_sendRawTransaction`, even with `USE_ASYNC_TX_PROCESSING=true`. That flag should make the relay submit the tx and return the hash immediately — so 3+ second waits were wrong.

### Trace through the code

Traced `eth_sendRawTransaction` → `TransactionService.sendRawTransaction()` → `precheck.validateAccountAndNetworkStateful()`.

**Three Mirror Node HTTP calls were blocking the response before the txHash was returned:**

| #   | Call                                   | Location                                                      |
| --- | -------------------------------------- | ------------------------------------------------------------- |
| 1   | `mirrorNodeClient.getNetworkFees()`    | `CommonService.getGasPriceInWeibars()`                        |
| 2   | `mirrorNodeClient.getAccount(tx.from)` | `Precheck.verifyAccount()` — checks nonce + balance           |
| 3   | `mirrorNodeClient.getAccount(tx.to)`   | `Precheck.receiverAccount()` — checks `receiver_sig_required` |

All three were **uncached**, hitting Mirror Node on every single transaction.

### Timer storm root cause

Separately, the `MIRROR_NODE_REQUEST_RETRY_COUNT` (default: **10**) × `MIRROR_NODE_RETRY_DELAY` (default: **2000ms**) = up to **20 seconds of timer backpressure per failed request**. This created a V8 timer storm under load, inflating memory and stalling the event loop.

The 2001ms value seen in some logs was a hardcoded legacy value from before `ConfigService.get('MIRROR_NODE_RETRY_DELAY')` was introduced — the current build correctly reads configuration.

---

## Phase 3 — Code Fixes

### Fix 1: Gas price caching — `CommonService.getGasPriceInWeibars`

**File:** `packages/relay/src/lib/services/ethService/ethCommonService/CommonService.ts`

Added a read-through cache for the current gas price. Gas price changes only on scheduled network intervals, so caching it is correct and safe.

- Cache key: `constants.CACHE_KEY.GAS_PRICE`
- TTL: `ETH_GET_GAS_PRICE_CACHE_TTL_MS` (default: **30 minutes**)
- Only caches when `timestamp` param is absent (i.e., "current price" requests only — historical lookups bypass cache)
- After the first warm-up call, call #1 above is eliminated for the entire TTL window

### Fix 2: Receiver account caching — `Precheck.receiverAccount`

**File:** `packages/relay/src/lib/precheck.ts`

Changed `receiverAccount` to use `this.commonService.getAccount(tx.to, ...)` (cached) instead of a direct `mirrorNodeClient.getAccount` call.

- `receiver_sig_required` is an account-level setting that almost never changes — caching it is safe
- Cache TTL: default `CACHE_TTL` (1 hour LRU)
- Eliminates call #3 above after the first hit per unique receiver address

### Fix 3 (REVERTED): Sender account — `Precheck.verifyAccount`

Initially changed `verifyAccount` to use the cached path. **Reverted** because it's incorrect:

The nonce check formula is:

```
signerNonce = mirrorAccountInfo.ethereum_nonce + pendingTransactions - 1
```

`ethereum_nonce` must be fresh — a stale cached nonce causes `NONCE_TOO_HIGH` or `NONCE_TOO_LOW` for any sequential same-wallet transaction. The `balance` field from the same response is also used for balance checking. Sender lookups remain live, uncached Mirror Node calls.

**Final caching decision table:**

| MN call                      | Cached?     | Why                                                   |
| ---------------------------- | ----------- | ----------------------------------------------------- |
| `getNetworkFees` (gas price) | ✅ 30-min   | Network-level, changes on schedule                    |
| `getAccount(tx.from)` sender | ❌ Never    | Nonce + balance must be fresh per tx                  |
| `getAccount(tx.to)` receiver | ✅ 1-hr LRU | Only `receiver_sig_required` checked; account setting |

**Net improvement:** 3 live MN calls per tx → 1 live MN call per tx after warm-up.

### Fix 4: `IAccountInfo` type — `receiver_sig_required`

**File:** `packages/relay/src/lib/types/mirrorNode.ts`

Added `receiver_sig_required?: boolean` to the `IAccountInfo` interface. The Mirror Node API returns this field but it was missing from the TypeScript type.

### Fix 5: `Precheck` constructor — injected `ICommonService`

**File:** `packages/relay/src/lib/precheck.ts`

Added `commonService: ICommonService` as the 4th constructor parameter so `receiverAccount` can use the cached path.

**File:** `packages/relay/src/lib/services/ethService/transactionService/TransactionService.ts`

Updated the instantiation: `new Precheck(mirrorNodeClient, chain, transactionPoolService, common)`.

### Fix 6: Test file updates

- **`packages/relay/tests/lib/precheck.spec.ts`** — constructor updated; creates a shared `CacheService` and `CommonService`, passes both.
- **`packages/server/tests/acceptance/equivalence.spec.ts`** — constructor stub updated with `null as any` for the unused 4th arg.

---

## Phase 4 — Workflow Configuration Fixes

### Relay config in Solo (`solo-test.yml`)

Applied via `relay-resources.yaml` heredoc passed to `solo relay node add -f`:

| Config var                            | Value set | Reason                                         |
| ------------------------------------- | --------- | ---------------------------------------------- |
| `MIRROR_NODE_REQUEST_RETRY_COUNT`     | `"1"`     | Cut retry storm (was 10 × 2000ms = 20s)        |
| `MIRROR_NODE_RETRY_DELAY`             | `"500"`   | Cut retry delay (was 2000ms default)           |
| `HAPI_CLIENT_TRANSACTION_RESET`       | `"50000"` | Avoid expensive HAPI client rebuilds           |
| `ETH_GET_TRANSACTION_COUNT_CACHE_TTL` | `"5000"`  | Reduce Mirror Node nonce lookups               |
| `USE_ASYNC_TX_PROCESSING`             | `"true"`  | Return txHash before waiting for consensus     |
| `ENABLE_NONCE_ORDERING`               | `"false"` | Reduce in-memory nonce pool overhead           |
| `WORKERS_POOL_ENABLED`                | `"false"` | Avoid worker thread overhead at small memory   |
| `RATE_LIMIT_DISABLED`                 | `"true"`  | Remove rate limiter overhead during benchmarks |
| `REDIS_ENABLED`                       | `"false"` | No Redis in Solo benchmark environment         |
| `LOG_LEVEL`                           | `"warn"`  | Reduce I/O overhead from logging               |

### Diagnostics added

"Verify Live Memory Metrics" step confirms:

- `NODE_OPTIONS` propagated correctly to the container
- `WORKERS_POOL_ENABLED=false` confirmed
- `MIRROR_NODE_RETRY_DELAY=500` confirmed
- `MIRROR_NODE_REQUEST_RETRY_COUNT=1` confirmed
- V8 heap metrics from `/metrics` endpoint (heap_size_used, heap_size_total, RSS)

---

## Phase 5 — Port-Forward Flow Audit

### Question raised

> "Do we need to port-forward relay and mirror node, or just the consensus node 50211?"

### Analysis

In CI (everything in Kind/K8s):

- The relay pod reaches the consensus node via **internal cluster networking** — no `50211` PF needed for pod-to-pod traffic.
- **However**, the relay pod itself is a K8s pod — the runner can't reach it on `localhost:7546` without a port-forward.
- Similarly, the mirror node REST API is a K8s pod — runner can't reach `localhost:8081` without a port-forward.

The `50211` PF is needed because Solo installs a **HAProxy in front of the consensus node**. The relay's SDK client is configured (via the port-forward) to connect directly to `network-node1-0:50211`, bypassing the proxy — this matches `make port-forward` in the Makefile exactly.

Locally with `make setup-solo`, relay and mirror run as **host processes** (already on localhost), so only `50211` needs a PF. In CI, all three need PFs.

### Changes made

**Initial "Port-forward Relay and Mirror Node" step:**

- Removed an incorrect removal of the `50211` PF — it was put back correctly.
- Added `MIRROR_SVC` and `MIRROR_PORT` persistence to `GITHUB_ENV` so the re-forward step avoids a redundant `kubectl get svc` discovery round-trip.

**"Re-port-forward Relay and Mirror Node" step (formerly "Re-port-forward Relay"):**

- Was killing `50211` but **not re-establishing it** — the benchmark was therefore running without the proxy bypass.
- Now kills all three ports and re-establishes all three with fresh connections.
- Uses cached `MIRROR_SVC`/`MIRROR_PORT` from `GITHUB_ENV` with fallback re-discovery.

Final port-forward state entering the benchmark:

| Port    | Target                     | Why                                          |
| ------- | -------------------------- | -------------------------------------------- |
| `7546`  | New matrix relay pod       | New pod after bootstrap teardown             |
| `8081`  | Mirror REST svc            | Fresh connection after heavy prep-cn traffic |
| `50211` | `network-node1-0` directly | Bypass Solo HAProxy; clean connection        |

---

## Files Changed (Full List)

| File                                                                                  | Change                                                                                                     |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `packages/relay/src/lib/services/ethService/ethCommonService/CommonService.ts`        | Gas price read-through cache in `getGasPriceInWeibars`                                                     |
| `packages/relay/src/lib/precheck.ts`                                                  | 4th `ICommonService` constructor param; `receiverAccount` uses cached path; `verifyAccount` kept live      |
| `packages/relay/src/lib/services/ethService/transactionService/TransactionService.ts` | Pass `common` as 4th arg to `new Precheck()`                                                               |
| `packages/relay/src/lib/types/mirrorNode.ts`                                          | Added `receiver_sig_required?: boolean` to `IAccountInfo`                                                  |
| `packages/relay/tests/lib/precheck.spec.ts`                                           | Constructor updated for new 4th param                                                                      |
| `packages/server/tests/acceptance/equivalence.spec.ts`                                | Constructor stub updated                                                                                   |
| `.github/workflows/solo-test.yml`                                                     | Full benchmark pipeline: matrix, port-forwards, prep-cn, relay swap, re-port-forwards, diagnostics, report |

---

## Current Status

All changes are implemented and TypeScript-error-free. The branch is ready to push to trigger the 10-matrix CI benchmark run.

**Key hypothesis to validate from results:**

- P95 `http_req_waiting` should drop significantly (3 MN calls → 1 per tx after warm-up).
- 128Mi OOMKill at 100 VUs should not recur, or should occur later.
- Diagnostics will confirm `MIRROR_NODE_RETRY_DELAY=500` and `MIRROR_NODE_REQUEST_RETRY_COUNT=1` are applied in-container.
- All three port-forwards confirmed active and fresh entering the benchmark phase.
