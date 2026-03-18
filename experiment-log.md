# Experiment Log

Running log of measurements, observations, and results from memory optimization work on the Hedera JSON-RPC Relay.

---

## 2026-03-17: Heap Snapshot Analysis (256 Mi, old=192, 120 RPS, 180s)

**Config:** `mem_limit=256`, `old=192`, `WORKERS_POOL_ENABLED=false`, `LOG_LEVEL=silent`, standard mode (LIGHTWEIGHT_MODE=false)

**Snapshot Results:**

| Snapshot            | Heap Size |
| ------------------- | --------- |
| Idle                | 47.8 MB   |
| Mid-Load 1 (t=45s)  | 78.1 MB   |
| Mid-Load 2 (t=90s)  | 75.3 MB   |
| Mid-Load 3 (t=135s) | 77.8 MB   |
| Post-Load (pre-GC)  | 73.8 MB   |
| Post-Load (post-GC) | 69.0 MB   |

**Key observations:**

- No memory leaks — heap oscillates 75–78 MB under sustained load
- Transient peak: +30.3 MB above idle (gRPC buffers, JSON strings, parsed objects, promises)
- Retained after GC: +21 MB above idle (LRU cache entries + JIT code)
- Full breakdown documented in `memory-allocation-analysis.md`

---

## 2026-03-17: GC Trace Analysis (256 Mi, old=192, 120 RPS, 10s)

**Config:** Same as above but 10-second load test with `--trace-gc`

**Results:**

| Metric             | Value                        |
| ------------------ | ---------------------------- |
| GC overhead        | 4.91% of wall time           |
| Mark-Compact pause | 2–3 ms typical, max 17 ms    |
| Heap idle          | 55 MB used / 66 MB allocated |
| Heap peak          | 81 MB used / 86 MB allocated |
| Heap after GC      | 56 MB used / 62 MB allocated |

**Key observations:**

- GC is healthy — not the bottleneck
- ~313 ms p95 latency is Mirror Node I/O, not GC pauses
- 9 unexplained V8 isolates at boot (~6–8 MB each, ~63 MB total, completely idle during load)

---

## 2026-03-17: Container Sizing Math (from GC monitoring)

From live GC monitoring during load tests, observed heap behavior:

| State               | Heap Used | Heap Allocated |
| ------------------- | --------- | -------------- |
| Idle (just started) | ~44–50 MB | ~50–55 MB      |
| Peak under load     | ~78–81 MB | ~84–86 MB      |
| After GC cleanup    | ~55–56 MB | ~62 MB         |

**Minimum container sizing formula:**

```
Container limit = V8 heap allocated (peak) + Native memory overhead

Native memory overhead ≈ 37–40 MB (V8 engine, libuv, OpenSSL, ICU, thread stacks)
```

**For sustained load (120 RPS, standard mode):**

- Peak heap allocated: ~84 MB
- Native overhead: ~40 MB
- Minimum container: **~124 MB** (comfortably fits 128 Mi)
- `--max-old-space-size=84` would cap V8 at observed peak

**For idle / just to start the pod:**

- Idle heap allocated: ~50 MB
- Native overhead: ~40 MB
- Minimum container: **~90 MB** (fits 96 Mi)
- `--max-old-space-size=50` would allow startup

**Note:** These numbers are with `CACHE_MAX=1000` (default), `WORKERS_POOL_ENABLED=false`, standard mode. Reducing cache and enabling LIGHTWEIGHT_MODE would lower the peak significantly.

---

## 2026-03-17: Dockerfile Changes

- Added `tini` as PID 1 init process (required for SIGUSR2 signal delivery for heap snapshots)
- Added `--heapsnapshot-signal=SIGUSR2` to ENTRYPOINT
- Added `chown node:node /home/node/app` for write permission (heap snapshot files)
- Kept `--trace-gc` for ongoing monitoring

---

## 2026-03-17: Makefile Changes

- Added `CACHE_MAX: "50"` and `CACHE_TTL: "900"` to relay config in `run-relay` target
- Fixed `extract-heap-snapshots` target to look in `/home/node/app/` (CWD) instead of `/home/node/app/packages/server/`
