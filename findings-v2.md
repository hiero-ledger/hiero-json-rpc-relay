# Memory Optimization Findings — Round 2

**Date:** 2026-03-23
**Heap snapshot baseline:** `selective-SDK-import.Heap.20260320.001600.11.0.001` (27.2 MB)
**Status:** Research only — improvements identified but NOT yet implemented

---

## Context

After Milestone 2 (selective SDK import wrapper), the relay idle heap was reduced to ~27 MB, down significantly from the original ~50+ MB baseline. This document records a second round of deep investigation into what remains in the heap and what can still be improved.

**Conclusion upfront:** The remaining actionable improvements total only ~2.7–3.3 MB. The prior milestones captured the large structural wins. What's left in the heap is mostly unavoidable Node.js/V8 overhead from compiled code, module source strings, and closure environments.

---

## Heap Composition at Current State (27.2 MB)

| Category                | Shallow  | Retained  | %   |
| ----------------------- | -------- | --------- | --- |
| (compiled code) ×78,674 | 8,448 kB | 15,197 kB | 56% |
| (string) ×53,020        | 8,556 kB | 8,556 kB  | 31% |
| system/Context ×3,635   | 270 kB   | 6,098 kB  | 22% |
| Object ×1,740           | 1,048 kB | 4,868 kB  | 18% |
| Array ×5,391            | 1,306 kB | 3,690 kB  | 14% |

The top three categories (compiled code, strings, system/Context) are largely dictated by Node.js/V8 internals and cannot be reduced without eliminating entire library dependencies.

---

## Findings

### 1. `@noble/curves` — 3 Duplicate Copies (~1.5–2 MB)

**What:** Three separate instances of the secp256k1 Weierstrass curve implementation, each with its own wNAF precomputed point table (~700 kB each):

- `/node_modules/@noble/curves/` v1.8.1 — top-level
- `/node_modules/ethers/node_modules/@noble/curves/` v1.2.0 — bundled by ethers
- `/node_modules/ethereum-cryptography/node_modules/@noble/curves/` v1.4.2 — SDK crypto chain

**Why not deduplicated by npm:** Incompatible semver ranges (`^1.2.0`, `^1.4.0`, `^1.8.1`) prevent npm from hoisting to a single copy.

**The `BIGINT_CACHE` object (2.18 MB retained):** This is the wNAF precomputed point table array stored in `system/Context`. Three copies of it exist, one per secp256k1 instance. Fixing the deduplication reduces from 3 tables to 1.

**Proposed fix:**

```json
// root package.json
"overrides": {
  "@noble/curves": "1.8.1"
}
```

Run `npm install`, verify test suite passes. `@noble/curves` 1.x is API-stable.

**Estimated savings: ~1.5–2 MB**
**Risk: Low**

---

### 2. Redis Umbrella Package — 4 Unused Extension Modules (~150–250 kB)

**What:** `redisClientManager.ts` imports from the `'redis'` umbrella package, which at module load time eagerly registers all four Redis Stack extension modules even though the relay never uses them:

- `@redis/bloom` (bloom filters)
- `@redis/json` (JSON document storage)
- `@redis/search` (full-text search)
- `@redis/time-series` (time series)
- Plus `@redis/client/dist/lib/commands/index.js` (61.9 kB) — full command registry

The relay uses only: `GET`, `SET`, `DEL`, `KEYS`, `MULTI`, `UNLINK`, `INCRBY`, `LRANGE`, `RPUSH`.

**File:** `packages/relay/src/lib/clients/redisClientManager.ts` line 5

**Proposed fix:**

```typescript
// Before:
import { createClient, RedisClientType } from 'redis';
// After:
import { createClient, RedisClientType } from '@redis/client';
```

Also update `relay/package.json`: replace `"redis": "^5.8.0"` with `"@redis/client": "^5.10.0"`.

**Estimated savings: ~150–250 kB**
**Risk: Low** — `@redis/client` is the core of `redis`; all used APIs are identical.

---

### 3. `@ethereumjs/util` Loaded at Startup via `zeroAddress` (~50–80 kB)

**What:** `packages/relay/src/lib/services/hbarLimitService/index.ts` line 3 imports `{ zeroAddress }` from `@ethereumjs/util`. This forces the entire `@ethereumjs/util` module to load at startup, including `constants.js` which initializes 14+ `BigInt()` constants at require time (`BIGINT_0`, `BIGINT_1`, `BIGINT_2`, `MAX_UINT64`, `MAX_INTEGER`, etc.).

**Proposed fix:** Replace with a string literal. The zero address is a well-known constant.

```typescript
// Before:
import { zeroAddress } from '@ethereumjs/util';

// After — remove the import, use the string directly:
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
```

(Check if `constants.ts` already exports this — it likely does as `ZERO_ADDRESS_HEX`.)

This defers `@ethereumjs/util` loading to the first block worker invocation instead of startup.

**Estimated savings: ~50–80 kB**
**Risk: Very Low**

---

### 4. `better-lookup` + `@ayonli/jsext` (~150–200 kB)

**What:** `mirrorNodeClient.ts` line 6 imports `{ install as betterLookupInstall }` from `better-lookup`. This transitively loads `@ayonli/jsext/cjs/fs.js` (77.5 kB) — a multi-runtime (Node/Deno/Bun) filesystem abstraction — plus `@ayonli/jsext/runtime`, `@ayonli/jsext/string`, `@ayonli/jsext/throttle`.

`better-lookup` is used to improve DNS resolution caching on the mirror node HTTP agent. It's a real value-add in production but loads a large transitive dependency just for DNS caching.

**Proposed fix options:**

- Wrap `betterLookupInstall` in a config flag (e.g. `BETTER_LOOKUP_ENABLED`, default `false` in minimal mode)
- Replace with a lightweight native DNS cache using `node:dns/promises` + a small LRU map

**Estimated savings: ~150–200 kB**
**Risk: Medium** — only safe if container/infra handles DNS caching at a lower level, or mirror node is accessed by IP.

---

### 5. MIME Type Database — Loaded Twice via `co-body` (~400 kB)

**What:** Two 200 kB MIME type map objects (`application/vnd.amazon.mobi8-ebook`, etc.) from `mime-db`, loaded via the chain: `koa → co-body → form-data → mime-types → mime-db`. The relay only accepts `application/json` request bodies but `co-body` loads the entire MIME database unconditionally.

**File:** `packages/server/src/server.ts` — Koa middleware setup

**Proposed fix:** Replace `co-body` with a minimal JSON body reader using Node's `stream.Readable` + `JSON.parse`. The relay has no use for multipart form data parsing.

**Estimated savings: ~400 kB**
**Risk: Medium** — requires touching server middleware and testing all body parsing edge cases.

---

### 6. `EthereumTransactionData*.cjs` Eager Requires (~300–400 kB)

**What:** `hashgraph-sdk.ts` lines 168–171 eagerly `require()` all `EthereumTransactionData` variant modules so they self-register into a dispatch cache. This forces loading at startup:

- `tweetnacl/nacl-fast.js` — 82 kB (Ed25519 ops, never needed at idle)
- `forge-light/lib/util.js` — 92.6 kB (PEM key parsing; relay uses hex keys, not PEM)
- `asn1js/build/index.js` — 140 kB (ASN.1/DER parsing; same — not needed at idle)

**Why not fixed:** The dispatch pattern in `EthereumTransactionData.fromBytes()` requires all variant modules to have registered themselves before any call. Making this lazy would require redesigning the registration/dispatch mechanism. High complexity, high risk.

**Estimated savings: ~300–400 kB**
**Risk: High** — fundamental SDK client initialization pattern.

---

## What Is NOT Reducible

These remain in the heap and cannot be addressed without forking dependencies or abandoning features:

| Item                                | Retained | Reason                                          |
| ----------------------------------- | -------- | ----------------------------------------------- |
| `@hiero-ledger/proto/src/proto.js`  | ~815 kB  | SDK monolithic protobuf bundle — not splittable |
| `lru-cache`                         | ~71 kB   | Relay's own required caching layer              |
| `llhttp` WASM (undici)              | ~65 kB   | Node.js/undici internal, not controllable       |
| `ethers/transaction/transaction.js` | ~60 kB   | Minimum required; already optimized             |
| `mirrorNodeClient.js`               | ~183 kB  | Legitimate service code                         |
| Compiled code baseline              | ~13+ MB  | V8 JIT overhead for all loaded modules          |
| String source text                  | ~8.5 MB  | V8 retains module source for stack traces       |

---

## Summary

| #         | Finding                                              | Est. Savings    | Risk     | Status          |
| --------- | ---------------------------------------------------- | --------------- | -------- | --------------- |
| 1         | `@noble/curves` dedup (npm overrides)                | ~1.5–2 MB       | Low      | Not implemented |
| 2         | Redis: `'redis'` → `'@redis/client'`                 | ~150–250 kB     | Low      | Not implemented |
| 3         | `zeroAddress` → string literal in `hbarLimitService` | ~50–80 kB       | Very Low | Not implemented |
| 4         | `better-lookup` conditional/removal                  | ~150–200 kB     | Medium   | Not implemented |
| 5         | MIME types (`co-body` replacement)                   | ~400 kB         | Medium   | Not implemented |
| 6         | `EthereumTransactionData*` lazy dispatch             | ~300–400 kB     | High     | Not implemented |
| **Total** |                                                      | **~2.7–3.3 MB** |          |                 |

**Current idle heap: ~27 MB → best case ~24 MB after all improvements**

The 64 MB target has already been achieved with Milestone 2. These findings represent the remaining marginal gains. Implementation is deferred — the risk/reward ratio is low and the relay already fits comfortably within the memory budget.
