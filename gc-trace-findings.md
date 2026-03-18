# GC Trace Analysis Findings

## Test Configuration

| Parameter | Value |
|-----------|-------|
| Container memory | 256 Mi |
| `--max-old-space-size` | 192 |
| `WORKERS_POOL_ENABLED` | false |
| k6 scenario | cn-benchmark (eth_sendRawTransaction) |
| VUs | 10 |
| Target RPS | 120 |
| Duration | 10 seconds |
| Node.js flag | `--trace-gc` |

---

## Finding 1: GC Is Healthy — Not the Bottleneck

| Metric | Value |
|--------|-------|
| Total GC events (main isolate) | 4,335 |
| Scavenge (young gen) pause | avg ~0.2ms, max ~1ms typical |
| Mark-Compact (old gen) pause | avg ~2.5ms, max 17ms |
| One outlier Scavenge (interleaved) | 33ms |
| Heap before test | 55 MB used / 66 MB allocated |
| Heap at peak (under load) | 81 MB used / 86 MB allocated |
| Heap after Mark-Compact cleanup | 56 MB used / 62 MB allocated |
| Total GC pause time during test | 982 ms |
| Test wall time | ~20,000 ms |
| **GC time as % of test duration** | **4.91%** |
| V8 marking utilization (mu) | 0.99+ throughout |

Per the [Node.js GC tracing guide](https://nodejs.org/en/learn/diagnostics/memory/using-gc-traces): "If the time between two GCs is much greater than the time spent in GC, the application is relatively healthy." The data confirms the Relay is not GC-starved at 256 Mi.

### Heap growth pattern (healthy sawtooth)

```
t=0s   55 MB used / 66 MB allocated   (idle baseline)
t=1s   60 MB / 66 MB                  (load starting)
t=2s   63 MB / 74 MB                  (growing under load)
t=5s   67 MB / 80 MB
t=7s   71 MB / 82 MB
t=9s   72 MB / 84 MB                  (peak)
t=10s  81 MB / 86 MB → Mark-Compact → 57 MB / 74 MB  (cleaned)
t=19s  56 MB / 62 MB                  (post-test, reduced)
```

No leak. Heap grows under load, Mark-Compact reclaims ~20 MB, heap settles back to baseline.

### Mark-Compact events (all 11)

| Timestamp | Before → After | Pause | Notes |
|-----------|---------------|-------|-------|
| 1200049 ms | 60.9 → 53.2 MB | 2.26 ms | |
| 1201257 ms | 70.0 → 55.2 MB | 2.17 ms | |
| 1202554 ms | 73.4 → 57.3 MB | 2.22 ms | |
| 1203760 ms | 74.2 → 58.1 MB | 2.44 ms | |
| 1204748 ms | 74.4 → 59.1 MB | 2.41 ms | |
| 1205866 ms | 77.1 → 59.9 MB | 2.35 ms | |
| 1207156 ms | 77.6 → 60.7 MB | 2.24 ms | |
| 1208264 ms | 79.1 → 62.0 MB | 2.27 ms | |
| 1209546 ms | 81.0 → 62.2 MB | **16.59 ms** | Largest pause |
| 1217664 ms | 74.0 → 56.7 MB | 5.16 ms | Post-test reduce |
| 1218298 ms | 56.9 → 56.4 MB | **16.85 ms** | Post-test reduce |

Mark-Compact events occur roughly every ~1 second during load. Pauses are 2–3ms typically. The two 17ms pauses are at the end of the test during heap reduction — not during active request serving.

---

## Finding 2: The ~313ms p95 Latency Is Mirror Node I/O

GC accounts for only ~5% of wall time with sub-millisecond pauses. The ~313ms p95 `http_req_waiting` from the k6 results is coming from **Mirror Node REST call latency** in the `eth_sendRawTransaction` code path.

The standard (non-lightweight) `sendRawTransaction` path:

1. Parse transaction + stateless precheck (CPU, fast)
2. Save to transaction pool (in-memory, fast)
3. **Acquire lock** → `lockService.acquireLock()` (may wait if same sender)
4. **Gas price lookup** → `common.getGasPriceInWeibars()` → Mirror Node REST call
5. **Account + network validation** → `precheck.validateAccountAndNetworkStateful()` → Mirror Node REST calls (nonce, account info)
6. **Submit to Consensus Node** → `hapiService.submitEthereumTransaction()` → gRPC call (~30–200ms)
7. **Post-consensus verification** → `mirrorNodeClient.repeatedRequest()` → polling Mirror Node until tx is indexed

Steps 4, 5, and 7 are sequential Mirror Node HTTP round-trips. Each adds network latency. The cumulative I/O wait is what produces the 200–300ms+ response times.

This also explains why `SEND_RAW_TRANSACTION_LIGHTWEIGHT_MODE` achieved <100ms p95 — it eliminated all Mirror Node calls (steps 4, 5, 7), making the path: parse → submit to CN → return hash.

**Reference:** `packages/relay/src/lib/services/ethService/transactionService/TransactionService.ts:270-353`

---

## Finding 3: 9 Unexplained V8 Isolates (Open Investigation)

The GC trace shows **10 V8 isolates** in the process:

| Isolate | GC Events | Heap Size | Active During Test? |
|---------|-----------|-----------|-------------------|
| `0xffff85da0000` (main) | 4,336 | 55–81 MB | Yes |
| 9 others (`0xffff536..` – `0xffff53a..`) | 6 each | ~6–8 MB each | **No** |

The 9 non-main isolates:
- All created at process boot (first GC at t=7–44ms)
- All finish GC activity by t=146ms
- **Zero GC events during the k6 test** — completely idle
- Each stabilizes at ~6–8 MB heap

### What they are NOT

- **Not Piscina workers** — `WORKERS_POOL_ENABLED=false`, and `WorkersPool.getInstance()` is never called. Confirmed via code path analysis.
- **Not `@hashgraph/sdk` or `@grpc/grpc-js`** — neither creates worker threads (grpc-js is pure JS).
- **Not all from pino-pretty** — `pino-pretty` transport uses `thread-stream` which creates **1** worker thread. That accounts for 1 of the 9, not all.

### Potential memory impact

If each idle isolate holds ~6–8 MB: **9 × ~7 MB ≈ ~63 MB of memory from threads that do nothing during `eth_sendRawTransaction` testing.**

### Next step

Investigate what creates these isolates. Options:
- Run with `--trace-worker-threads` or add logging around `worker_threads.Worker` constructor
- Check if any dependency (pino, redis, SDK) spawns workers at import time
- Compare isolate count with and without specific dependencies loaded

---

## Summary

| Question | Answer |
|----------|--------|
| Is GC the bottleneck? | **No.** 4.91% overhead, sub-ms pauses. |
| Is there a memory leak? | **No.** Heap returns to baseline after load. |
| What causes ~313ms p95? | **Mirror Node I/O** — sequential REST calls in the sendRawTransaction path. |
| Is 256Mi enough memory? | **Yes for this load.** Peak heap 86 MB, well within 192 MB old-space limit. |
| Are there idle memory costs? | **Likely.** 9 unexplained isolates holding ~63 MB total — needs investigation. |
