---
## Section 1: Memory-Allocating Components Identified in Code

This section inventories every component in the Relay codebase that holds persistent or significant transient state in memory. Components are organized by architectural layer, from the outermost server layer inward.
---

### 1.1 HTTP Server Layer

**Entry point:** `packages/server/src/index.ts` → `packages/server/src/server.ts`

#### 1.1.1 Koa Application & Middleware Stack

The HTTP server uses the Koa framework. On startup, the following objects are created and persist for the process lifetime:

- **`Koa` instance** — The application object holding the middleware chain. Each middleware function is retained as a closure in the stack.
- **`AsyncLocalStorage<{ requestId: string }>`** — Node.js context tracker that maintains a storage map across async continuations for every in-flight request. Memory scales with request concurrency.
- **`cors` middleware** (`@koa/cors`) — Retains configuration object.
- **10 middleware functions** registered as closures, each holding references to logger, relay, and metric objects.

**Reference:** `packages/server/src/server.ts:24`, `packages/server/src/server.ts:141-354`

#### 1.1.2 JSON-RPC Request Parsing & Dispatch

**File:** `packages/server/src/koaJsonRpc/index.ts`

The `KoaJsonRpc` class manages request body parsing and dispatch:

- **`co-body` JSON parser** — Buffers the entire HTTP request body into memory before parsing. Maximum buffer size is controlled by `INPUT_SIZE_LIMIT` (default: **1 MB**). For batch requests, this means up to 1 MB of raw JSON is held in memory per in-flight request.
- **Batch request handling** — When batch requests are enabled (`BATCH_REQUESTS_ENABLED`, default: `true`), up to `BATCH_REQUESTS_MAX_SIZE` (default: **100**) concurrent promises are created per batch. Each promise holds references to request/response objects.
- **`IPRateLimiterService` instance** — Created per `KoaJsonRpc` constructor. Holds a reference to the underlying rate limit store (see §1.5).

**Reference:** `packages/server/src/koaJsonRpc/index.ts:31-66`, `packages/server/src/koaJsonRpc/index.ts:80-87`

#### 1.1.3 `/openrpc` Endpoint

The `/openrpc` route reads the entire `docs/openrpc.json` file from disk on **every request**, parses it with `JSON.parse`, then re-serializes it with `JSON.stringify` with pretty-printing. This creates two full in-memory copies of the document per request — one parsed object and one formatted string.

**Reference:** `packages/server/src/server.ts:288-299`

---

### 1.2 Relay Core Initialization

**File:** `packages/relay/src/lib/relay.ts`

The `Relay.init()` static factory method creates and wires together the entire service graph. The following long-lived objects are instantiated once at startup and retained for the process lifetime:

| Object                          | Type                            | Purpose                                  |
| ------------------------------- | ------------------------------- | ---------------------------------------- |
| `cacheService`                  | `ICacheClient` (LRU or Redis)   | Primary request cache                    |
| `mirrorNodeClient`              | `MirrorNodeClient`              | REST client to Mirror Node               |
| `hapiService`                   | `HAPIService`                   | gRPC client to Consensus Node            |
| `ethImpl`                       | `EthImpl`                       | Ethereum RPC method implementations      |
| `debugImpl`                     | `DebugImpl`                     | Debug namespace implementations          |
| `txpoolImpl`                    | `TxPoolImpl`                    | Transaction pool API                     |
| `adminImpl`                     | `AdminImpl`                     | Admin namespace                          |
| `web3Impl`                      | `Web3Impl`                      | Web3 namespace (stateless)               |
| `netImpl`                       | `NetImpl`                       | Net namespace (stateless)                |
| `hbarLimitService`              | `HbarLimitService`              | HBAR spending limit enforcement          |
| `lockService`                   | `LockService`                   | Transaction ordering locks               |
| `metricService`                 | `MetricService`                 | Metrics collection                       |
| `transactionPoolService`        | `TransactionPoolService`        | Pending transaction storage              |
| `hbarSpendingPlanConfigService` | `HbarSpendingPlanConfigService` | Spending plan management                 |
| `rpcMethodRegistry`             | `Map<string, Function>`         | RPC method name → implementation mapping |
| `rpcMethodDispatcher`           | `RpcMethodDispatcher`           | Request routing                          |

Additionally, three **HBAR spending plan repositories** are created, each wrapping the cache service:

- `HbarSpendingPlanRepository`
- `EvmAddressHbarSpendingPlanRepository`
- `IPAddressHbarSpendingPlanRepository`

Three **EventEmitter** instances are registered for metric tracking:

- `ethImpl.eventEmitter` → `eth_execution` events
- `hapiService.eventEmitter` → `execute_transaction` events
- `hapiService.eventEmitter` → `execute_query` events

Each listener holds a closure reference to `metricService`.

**Reference:** `packages/relay/src/lib/relay.ts:263-416`

---

### 1.3 In-Memory LRU Cache

**File:** `packages/relay/src/lib/clients/cache/localLRUCache.ts`

The `LocalLRUCache` is the primary in-memory caching layer when Redis is unavailable, and serves as the first-level cache even when Redis is enabled (through the `MeasurableCache` decorator).

#### Data Structures

- **Primary cache:** `LRUCache<string, any>` — Holds up to `CACHE_MAX` (default: **1,000**) entries with a TTL of `CACHE_TTL` (default: **3,600,000 ms** / 1 hour).
- **Reserved cache:** `LRUCache<string, any>` — Optional secondary cache for keys that should not be evicted (e.g., HBAR spending plan keys). Size is bounded by the number of reserved keys.
- **Reserved keys set:** `Set<string>` — Tracks which keys are delegated to the reserved cache.

#### Key Characteristics

- **`ttlAutopurge: false`** — Stale entries are **not** proactively removed. They remain in memory until either: (a) they are accessed (and found stale), (b) the LRU evicts them due to `max` being reached, or (c) `purgeStale()` is called explicitly. The Prometheus gauge collection callback does trigger `purgeStale()`, but only when metrics are scraped.
- **Values are `any` type** — Cached items include full deserialized Mirror Node JSON responses: blocks (with transaction arrays), contract results, logs, account balances, and more. A single block with many transactions can be a substantial JavaScript object graph.
- **Cache key prefix** — All keys are prefixed with `cache:`, adding a small per-entry overhead.

#### Cache Decorator

**File:** `packages/relay/src/lib/clients/cache/measurableCache.ts`

The `MeasurableCache` wraps either `LocalLRUCache` or `RedisCache` and adds a Prometheus `Counter` (`rpc_cache_service_methods_counter`) to track cache operations. This counter grows label cardinality with each unique `(callingMethod, cacheType, method)` combination.

**Reference:** `packages/relay/src/lib/clients/cache/localLRUCache.ts:18-334`, `packages/relay/src/lib/factories/cacheClientFactory.ts`

---

### 1.4 Mirror Node HTTP Client

**File:** `packages/relay/src/lib/clients/mirrorNodeClient.ts`

The `MirrorNodeClient` is the primary REST client for fetching historical data from the Hedera Mirror Node. It is one of the heaviest allocators in the system due to HTTP connection pooling and response buffering.

#### Axios Instances

Two separate `AxiosInstance` objects are created:

1. **`restClient`** — For standard Mirror Node REST API calls (`/api/v1/...`)
2. **`web3Client`** — For Web3-specific endpoints (configurable via `MIRROR_NODE_URL_WEB3`)

Each Axios instance holds:

- Internal configuration objects (headers, interceptors, defaults)
- Reference to an HTTP agent and an HTTPS agent

#### HTTP Connection Pools

Each Axios client has **two** connection pool agents:

```
http.Agent:
  keepAlive:        MIRROR_NODE_HTTP_KEEP_ALIVE (default: true)
  keepAliveMsecs:   MIRROR_NODE_HTTP_KEEP_ALIVE_MSECS (default: 1,000 ms)
  maxSockets:       MIRROR_NODE_HTTP_MAX_SOCKETS (default: 300)
  maxTotalSockets:  MIRROR_NODE_HTTP_MAX_TOTAL_SOCKETS (default: 300)
  timeout:          MIRROR_NODE_HTTP_SOCKET_TIMEOUT (default: 60,000 ms)

https.Agent:
  (same configuration as above)
```

This means up to **4 connection pool agents** total (http + https for each of restClient and web3Client). With `maxSockets: 300`, the system can hold up to **300 keep-alive TCP connections** per agent, each with associated socket buffers in Node.js native memory (external to the V8 heap).

#### DNS Caching

When `MIRROR_NODE_AGENT_CACHEABLE_DNS` is `true` (default), the `better-lookup` library patches the HTTP agents to cache DNS resolution results. This adds an in-memory DNS cache per agent.

**Reference:** `packages/relay/src/lib/clients/mirrorNodeClient.ts:169-216`

#### Response Transformation

Mirror Node responses are processed through a custom `transformResponse` function that uses `JSONBigInt.parse()` to handle numbers exceeding JavaScript's `Number.MAX_SAFE_INTEGER`. This means each response is:

1. Received as a raw `string` buffer by Axios
2. Parsed by `JSONBigInt.parse()` into a JavaScript object (creating a second in-memory representation)
3. The raw string buffer then becomes eligible for GC

For large paginated responses (e.g., contract results with 200+ entries), this creates substantial transient memory pressure.

**Reference:** `packages/relay/src/lib/clients/mirrorNodeClient.ts:387-394`

#### Retry Logic

`axios-retry` is configured per client with retry state held in closures. Retries are controlled by `MIRROR_NODE_RETRIES` (default: **0** — retries disabled by default).

---

### 1.5 Rate Limiting

#### 1.5.1 IP Rate Limiter

**File:** `packages/relay/src/lib/services/rateLimiterService/rateLimiterService.ts`

The `IPRateLimiterService` is instantiated in the `KoaJsonRpc` constructor and checks rate limits on every incoming request.

#### 1.5.2 LRU Rate Limit Store (In-Memory)

**File:** `packages/relay/src/lib/services/rateLimiterService/LruRateLimitStore.ts`

When Redis is not available, rate limit state is stored in-memory:

```typescript
database: Object.create(null); // plain object used as dictionary
```

Structure:

```
database[ip_address] = {
  reset: <timestamp>,
  methodInfo: {
    [method_name]: {
      methodName: string,
      remaining: number,
      total: number
    }
  }
}
```

**Key concern:** This store has **no eviction mechanism and no maximum size**. Entries are created for each unique IP address and reset only when their time window expires. However, old entries are never removed — the `reset()` method resets counters but does not delete the IP entry. Under sustained traffic from many distinct IPs, this object grows monotonically.

The time window duration is `LIMIT_DURATION` (default: **60,000 ms**).

**Reference:** `packages/relay/src/lib/services/rateLimiterService/LruRateLimitStore.ts:20-162`

#### 1.5.3 Redis Rate Limit Store

**File:** `packages/relay/src/lib/services/rateLimiterService/RedisRateLimitStore.ts`

When Redis is available, rate limit state is stored externally with TTL-based expiration, consuming no significant process memory.

---

### 1.6 Piscina Worker Thread Pool

**File:** `packages/relay/src/lib/services/workersService/WorkersPool.ts`

The `WorkersPool` is a singleton wrapper around a [Piscina](https://github.com/piscinajs/piscina) thread pool. When enabled (`WORKERS_POOL_ENABLED`, default: `true`), it offloads heavy computation to worker threads.

#### Thread Pool Configuration

```
minThreads: WORKERS_POOL_MIN_THREADS (default: 2)
maxThreads: WORKERS_POOL_MAX_THREADS (default: 4)
atomics:    'disabled'
```

#### Per-Worker Thread Memory

**Critical:** Each Piscina worker thread runs in its own **V8 isolate** with a completely separate heap. Worker threads **cannot share** complex objects (like HTTP clients with sockets) by reference. Therefore, each worker thread independently instantiates:

| Object                                                                      | File                |
| --------------------------------------------------------------------------- | ------------------- |
| `pino` logger                                                               | `blockWorker.ts:35` |
| `Registry` (Prometheus)                                                     | `blockWorker.ts:36` |
| `CacheClientFactory.create()` → `MeasurableCache` wrapping `LocalLRUCache`  | `blockWorker.ts:37` |
| `MirrorNodeClient` (with its own Axios instances and HTTP connection pools) | `blockWorker.ts:38` |
| `CommonService`                                                             | `blockWorker.ts:39` |

The same set of objects is created in `commonWorker.ts` for the `getLogs` worker.

**This means total process memory = main thread heap + (N × per-worker heap), where N is the number of active worker threads.** Each worker has its own LRU cache (up to `CACHE_MAX` entries), its own Axios HTTP agents (up to 300 sockets each), and its own DNS cache.

#### Worker Task Queue

When all worker threads are busy, incoming tasks queue in the Piscina internal queue. This queue is **unbounded** — under heavy load, queued tasks hold references to their input parameters until a thread becomes available.

#### Metric Forwarding

Worker threads cannot directly update the main thread's Prometheus registry. Instead, they send metric updates via `parentPort.postMessage()`, and the main thread's `WorkersPool.instance.on('message', ...)` handler routes these updates to the appropriate metric objects. This pattern avoids shared-memory issues but adds per-message object allocation overhead.

**Reference:** `packages/relay/src/lib/services/workersService/WorkersPool.ts:113-146`, `packages/relay/src/lib/services/ethService/blockService/blockWorker.ts:35-39`

#### Workers-Disabled Mode

When `WORKERS_POOL_ENABLED` is `false`, tasks execute on the main thread. The worker modules are loaded lazily on first use via dynamic `import()`. The module-level client instances (logger, cache, mirror node client, common service) are created once and reused across all subsequent calls. This avoids the per-thread duplication but shares the main thread's event loop.

---

### 1.7 Hedera SDK Client (gRPC)

**File:** `packages/relay/src/lib/clients/sdkClient.ts`

The `SDKClient` wraps the `@hashgraph/sdk` library for gRPC communication with the Hedera Consensus Node.

#### Connection State

- **`clientMain`** — A `Client` instance from `@hashgraph/sdk`, holding gRPC channel(s) to one or more consensus nodes. This includes TLS state, connection buffers, and protobuf serialization context.
- **`paymasterClients`** — A `Map<string, Client>` with one additional `Client` instance per configured paymaster account (from `PAYMASTER_ACCOUNTS` config). Each `Client` maintains its own gRPC connections and operator key state.

#### Memory Characteristics

The `@hashgraph/sdk` is a substantial dependency that loads protobuf definitions and maintains gRPC connection state. The `Client` object retains references to the network topology, node addresses, and retry state. The amount of external (non-heap) memory used for gRPC socket buffers depends on the number of in-flight transactions.

**Reference:** `packages/relay/src/lib/clients/sdkClient.ts:39-71`

---

### 1.8 HAPI Service

**File:** `packages/relay/src/lib/services/hapiService/hapiService.ts`

The `HAPIService` manages the lifecycle of the `SDKClient`:

- **`client`** — Reference to the current `SDKClient` instance (can be re-initialized on errors)
- **`transactionCount`** — Integer counter, reset periodically
- **`errorCodes`** — Array of error codes from `HAPI_CLIENT_ERROR_RESET` config
- **`EventEmitter<TypedEvents>`** — Emits `execute_transaction` and `execute_query` events, with listeners held by `metricService`

**Reference:** `packages/relay/src/lib/services/hapiService/hapiService.ts`

---

### 1.9 Transaction Pool Service

**File:** `packages/relay/src/lib/services/transactionPoolService/LocalPendingTransactionStorage.ts`

When `eth_sendRawTransaction` processes a transaction (with `SEND_RAW_TRANSACTION_LIGHTWEIGHT_MODE` set to `false`, the default), the transaction is added to the pending pool.

#### Local Storage (In-Memory)

```typescript
pendingTransactions: Map<string, Set<string>>; // address → Set of RLP hex payloads
globalTransactionIndex: Set<string>; // all pending RLP hex payloads
```

**Key concerns:**

- **No maximum size limit** — The `Map` and `Set` grow without bound as transactions are submitted. The only removal mechanism is explicit `removeFromList()` calls when transactions are confirmed or fail.
- **Dual storage** — Each RLP hex string is stored **twice**: once in the per-address `Set` and once in the `globalTransactionIndex`. A typical RLP-encoded transaction hex string is 200–400 characters (100–200 bytes).
- **Empty set cleanup** — Empty per-address `Set` objects are deleted when the last transaction for that address is removed, preventing unbounded `Map` key growth.

#### Transaction Processing Path (Standard Mode)

When `SEND_RAW_TRANSACTION_LIGHTWEIGHT_MODE` is `false` (default), the `TransactionService.sendRawTransaction()` method:

1. Parses the raw transaction with `ethers.Transaction` (creates `EthersTransaction` object)
2. Runs precheck validations against the Mirror Node (creates request/response buffers)
3. Stores the transaction in the `TransactionPoolService` (adds to Map + Set)
4. Acquires a lock via `LockService` (creates `Mutex`, session key, timeout)
5. Submits to the consensus node via `HAPIService` (creates gRPC request buffers)
6. Waits for the transaction receipt (creates response objects)

Each step creates intermediate objects that are eligible for garbage collection after completion, but under high concurrency, many such object graphs can exist simultaneously.

**Reference:** `packages/relay/src/lib/services/transactionPoolService/LocalPendingTransactionStorage.ts:12-115`

---

### 1.10 Lock Service

**File:** `packages/relay/src/lib/services/lockService/LocalLockStrategy.ts`

The `LocalLockStrategy` manages per-address mutex locks for transaction ordering:

```typescript
localLockStates: LRUCache<string, LockState>;
// where LockState = { mutex: Mutex, sessionKey: string | null, lockTimeoutId: NodeJS.Timeout | null }
```

- **Max entries:** `LOCAL_LOCK_MAX_ENTRIES` (default: **1,000**)
- **Per entry:** One `Mutex` instance (from `async-mutex`), one string session key, one `setTimeout` timer reference
- **Auto-release:** Locks auto-release after `LOCK_MAX_HOLD_MS` (default: **30,000 ms**) via `setTimeout`
- **Eviction:** LRU-based — oldest locks are evicted when `max` is reached

**Reference:** `packages/relay/src/lib/services/lockService/LocalLockStrategy.ts:28-34`

---

### 1.11 HBAR Limit Service

**File:** `packages/relay/src/lib/services/hbarLimitService/index.ts`

The `HbarLimitService` enforces spending limits. Its primary state is stored via the cache service (§1.3), not in its own data structures. It maintains:

- **Static tier limits:** `Record<SubscriptionTier, Hbar>` — 4 tier entries (BASIC, EXTENDED, PRIVILEGED, OPERATOR)
- **Three repository references** — `HbarSpendingPlanRepository`, `EvmAddressHbarSpendingPlanRepository`, `IPAddressHbarSpendingPlanRepository` — all delegate storage to the cache service
- **Prometheus metrics:** Multiple `Counter` and `Gauge` instances per subscription tier (see §1.12)

**Reference:** `packages/relay/src/lib/services/hbarLimitService/index.ts`

---

### 1.12 Prometheus Metrics Registry

**File:** `packages/relay/src/lib/factories/registryFactory.ts` and throughout the codebase

A single `Registry` instance (from `prom-client`) is shared across the entire process. All metrics registered to it live in the V8 heap for the process lifetime.

#### Histograms

| Metric Name                                | Labels                            | Buckets | Location                |
| ------------------------------------------ | --------------------------------- | ------- | ----------------------- |
| `rpc_relay_method_response`                | method, statusCode                | 16      | `server.ts`             |
| `rpc_relay_method_result`                  | method, statusCode, isPartOfBatch | 16      | `koaJsonRpc/index.ts`   |
| `rpc_relay_mirror_response`                | method, statusCode                | 13      | `mirrorNodeClient.ts`   |
| `rpc_relay_consensusnode_response`         | mode, type, status                | -       | `metricService.ts`      |
| `rpc_relay_consensusnode_gasfee`           | mode, type, status                | -       | `metricService.ts`      |
| `rpc_relay_worker_task_duration_seconds`   | function                          | 21      | `WorkersPool.ts`        |
| `rpc_relay_worker_queue_wait_time_seconds` | (none)                            | 19      | `WorkersPool.ts`        |
| `rpc_relay_lock_wait_time_seconds`         | strategy                          | -       | `LockMetricsService.ts` |
| `rpc_relay_lock_hold_duration_seconds`     | strategy                          | -       | `LockMetricsService.ts` |

Each histogram stores an array of bucket counters **per unique label combination**. For `rpc_relay_method_response` with ~80 RPC methods × multiple status codes × 16 buckets, this can amount to thousands of in-memory counter objects.

#### Counters

| Metric Name                                   | Labels                           | Location                    |
| --------------------------------------------- | -------------------------------- | --------------------------- |
| `rpc_relay_mirror_node_http_error_code_count` | method, statusCode               | `mirrorNodeClient.ts`       |
| `rpc_relay_rate_limit_store_failures`         | storeType, operation             | `server.ts`                 |
| `rpc_relay_ip_rate_limit`                     | methodName, storeType            | `rateLimiterService.ts`     |
| `rpc_relay_eth_executions`                    | method                           | `metricService.ts`          |
| `rpc_relay_client_service`                    | transactions, errors             | `hapiService.ts`            |
| `rpc_relay_worker_tasks_completed_total`      | function                         | `WorkersPool.ts`            |
| `rpc_relay_worker_task_failures_total`        | function, error_type             | `WorkersPool.ts`            |
| `rpc_relay_txpool_operations_total`           | operation                        | `transactionPoolService.ts` |
| `rpc_relay_txpool_storage_errors_total`       | operation, backend               | `transactionPoolService.ts` |
| `rpc_relay_lock_acquisitions_total`           | strategy, status                 | `LockMetricsService.ts`     |
| `rpc_relay_lock_timeout_releases_total`       | strategy                         | `LockMetricsService.ts`     |
| `rpc_relay_lock_zombie_cleanups_total`        | (none)                           | `LockMetricsService.ts`     |
| `rpc_relay_lock_redis_errors_total`           | operation                        | `LockMetricsService.ts`     |
| `rpc_cache_service_methods_counter`           | callingMethod, cacheType, method | `measurableCache.ts`        |
| Per-tier `hbarLimitCounter`                   | mode, methodName                 | `hbarLimitService`          |
| Per-tier `uniqueSpendingPlansCounter`         | (per tier)                       | `hbarLimitService`          |

#### Gauges

| Metric Name                                    | Labels                | Location                    |
| ---------------------------------------------- | --------------------- | --------------------------- |
| `rpc_relay_cache`                              | (none)                | `localLRUCache.ts`          |
| `rpc_relay_operator_balance`                   | mode, type, accountId | `relay.ts`                  |
| `rpc_relay_worker_pool_utilization`            | (none)                | `WorkersPool.ts`            |
| `rpc_relay_worker_pool_active_threads`         | (none)                | `WorkersPool.ts`            |
| `rpc_relay_worker_pool_queue_size`             | (none)                | `WorkersPool.ts`            |
| `rpc_relay_txpool_pending_count`               | (none)                | `transactionPoolService.ts` |
| `rpc_relay_txpool_active_addresses`            | (none)                | `transactionPoolService.ts` |
| `rpc_relay_lock_waiting_txns`                  | strategy              | `LockMetricsService.ts`     |
| `rpc_relay_lock_active_count`                  | strategy              | `LockMetricsService.ts`     |
| Per-tier `hbarLimitRemainingGauge`             | (per tier)            | `hbarLimitService`          |
| Per-tier `totalHbarLimitGauge`                 | (per tier)            | `hbarLimitService`          |
| Per-tier `averageSpendingPlanAmountSpentGauge` | (per tier)            | `hbarLimitService`          |

Additionally, `collectDefaultMetrics({ prefix: 'rpc_relay_' })` registers **11+ standard Node.js metrics** (GC duration, event loop lag, active handles, etc.).

The `rpc_relay_operator_balance` gauge's `collect()` callback makes an async Mirror Node API call on every Prometheus scrape. This creates transient request/response objects on each scrape cycle.

**Reference:** Metrics are scattered across the codebase. The `RegistryFactory` at `packages/relay/src/lib/factories/registryFactory.ts` manages the singleton registry.

---

### 1.13 Logging Infrastructure

**Library:** `pino` (v10)

The main process creates a root `pino` logger in `server.ts` with multiple child loggers:

- `rpc-server` (server.ts)
- `relay` → `relay-eth`, `mirror-node`, `cache-service`, `hbar-rate-limit`, `rate-limit-store`, `transaction-pool-service`, `hbar-spending-plan-repository`, `evm-address-spending-plan-repository`, `ip-address-spending-plan-repository`, `koa-rpc`, `hbar-spending-plan-config-service`

Each child logger is a lightweight object holding a reference to the parent and any added bindings.

When `PRETTY_LOGS_ENABLED` is `true` (default in non-production), `pino-pretty` spawns a **separate worker thread** for log formatting. This adds an additional V8 isolate and thread to the process.

Each worker thread also creates its own `pino` logger instance.

**Reference:** `packages/server/src/server.ts:28-49`

---

### 1.14 Redis Client

**File:** `packages/relay/src/lib/clients/redisClientManager.ts`

When `REDIS_ENABLED` is `true` (default), a singleton Redis client is created:

- **`RedisClientType`** — Single persistent TCP connection to Redis at `REDIS_URL` (default: `redis://127.0.0.1:6379`)
- **Reconnection strategy** — Exponential backoff with `REDIS_RECONNECT_DELAY_MS` (default: 1,000 ms)
- **Three event listeners** — `ready`, `end`, `error` — registered as closures holding logger references
- **Command queue** — The Redis client library internally queues commands during reconnection, holding request data in memory

The Redis client itself is lightweight in terms of V8 heap, but the TCP socket consumes external (native) memory for send/receive buffers.

**Reference:** `packages/relay/src/lib/clients/redisClientManager.ts`

---

### 1.15 Ethereum Service Sub-Services

**File:** `packages/relay/src/lib/eth.ts`

The `EthImpl` class creates the following sub-services, each holding references to shared infrastructure (cache, mirror node client, logger):

| Service              | File                                       | Notable State                                                                                                                                             |
| -------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CommonService`      | `ethCommonService/CommonService.ts`        | Static `PAYMASTER_ACCOUNTS_MAP: Map<string, PaymasterAccount>`, `PAYMASTER_ACCOUNTS_WHITELISTS_MAP: Map<string, string>`, `PAYMASTER_WHITELIST: string[]` |
| `FilterService`      | `ethFilterService/FilterService.ts`        | Filters stored in cache service (no separate in-memory state)                                                                                             |
| `FeeService`         | `feeService/FeeService.ts`                 | Stateless; creates temporary arrays per `eth_feeHistory` request                                                                                          |
| `ContractService`    | `contractService/ContractService.ts`       | Holds `defaultGas` string                                                                                                                                 |
| `BlockService`       | `blockService/BlockService.ts`             | Stateless; delegates to worker pool                                                                                                                       |
| `TransactionService` | `transactionService/TransactionService.ts` | Holds `wrongNonceMetric: Counter`                                                                                                                         |
| `AccountService`     | `accountService/AccountService.ts`         | Stateless                                                                                                                                                 |

The `CommonService` static maps are populated at class load time from the `PAYMASTER_ACCOUNTS` config. Size depends on the number of configured paymaster accounts.

**Reference:** `packages/relay/src/lib/eth.ts`, `packages/relay/src/lib/services/ethService/ethCommonService/CommonService.ts`

---

### 1.16 Per-Request Transient Allocations

Beyond persistent objects, each RPC request creates transient data structures that live for the request duration:

#### Block Requests (`eth_getBlockByNumber`, `eth_getBlockByHash`)

- **`Block` object** — Contains hex-encoded fields and a `transactions` array (either hash strings or full `Transaction` objects)
- **`Transaction` objects** (when `showDetails=true`) — One per transaction in the block, with all fields as hex strings
- **`Log` objects** — One per event log, each containing a `topics: string[]` array
- **Receipt root calculation** — Creates a `Trie` instance (from `@ethereumjs/trie`), multiple `Uint8Array` buffers for RLP encoding, and `hexToBytes()` conversions
- **Lookup maps** — `Map<string, Log[]>` for logs-by-hash, `Map<string, any>` for contract results, `Set<string>` for deduplication

These allocations happen inside worker threads (if enabled), so they consume worker heap memory.

**Reference:** `packages/relay/src/lib/services/ethService/blockService/blockWorker.ts`

#### Log Requests (`eth_getLogs`)

- Mirror Node response arrays — potentially thousands of log entries per query
- Timestamp slicing — `MIRROR_NODE_TIMESTAMP_SLICING_CONCURRENCY` (default: **30**) parallel Mirror Node requests, each buffering a full response

#### Transaction Submission (`eth_sendRawTransaction`)

- `EthersTransaction` parsed object
- Precheck validation intermediate objects
- Lock acquisition state (`Mutex`, session key, `setTimeout`)
- gRPC request/response buffers
- Cache writes (transaction hash → receipt mapping)

---

### 1.17 Docker Configuration

**File:** `Dockerfile`, `docker-compose.yml`

#### Dockerfile

- **Base image:** `node:22-alpine` — Minimal runtime
- **No V8 memory flags** in the `ENTRYPOINT`:
  ```dockerfile
  ENTRYPOINT ["node", "--env-file=/home/node/app/.env.release"]
  ```
  No `--max-old-space-size`, `--max-semi-space-size`, or `--optimize-for-size` flags are set. Node.js 22 on a 64-bit system defaults to approximately 1.5 GB for old-space, or auto-detects the container memory limit via cgroup if one is set.

#### docker-compose.yml

- **No `mem_limit`** is specified on the `relay` container. The container can use all available host memory.
- **No `NODE_OPTIONS`** environment variable is set for V8 tuning.

**Reference:** `Dockerfile:75-76`, `docker-compose.yml`

---

### 1.18 Summary: Component Inventory

The following table summarizes all persistent memory-allocating components, their storage mechanism, and whether they have a bounded maximum size:

| #   | Component                        | Storage Type                  | Bounded?                         | Bound Config                     |
| --- | -------------------------------- | ----------------------------- | -------------------------------- | -------------------------------- |
| 1   | LRU Cache (primary)              | `LRUCache<string, any>`       | Yes                              | `CACHE_MAX` (1,000)              |
| 2   | LRU Cache (reserved)             | `LRUCache<string, any>`       | Yes                              | # of reserved keys               |
| 3   | Rate Limit Store (local)         | `Object.create(null)`         | **No**                           | —                                |
| 4   | Pending Transaction Pool (local) | `Map` + `Set`                 | **No**                           | —                                |
| 5   | Lock States                      | `LRUCache<string, LockState>` | Yes                              | `LOCAL_LOCK_MAX_ENTRIES` (1,000) |
| 6   | Worker Thread Pool               | Piscina (V8 isolates)         | Yes                              | `WORKERS_POOL_MAX_THREADS` (4)   |
| 7   | Per-Worker LRU Cache             | `LRUCache<string, any>`       | Yes                              | `CACHE_MAX` × N threads          |
| 8   | Per-Worker HTTP Agents           | `http.Agent` pools            | Yes                              | `maxSockets` (300) × N threads   |
| 9   | Main Thread HTTP Agents          | `http.Agent` pools            | Yes                              | `maxSockets` (300)               |
| 10  | Prometheus Metrics Registry      | `Registry`                    | **Grows with label cardinality** | —                                |
| 11  | DNS Cache (better-lookup)        | Internal cache                | Impl-dependent                   | —                                |
| 12  | gRPC Client State                | `@hashgraph/sdk Client`       | Yes (per network)                | —                                |
| 13  | Paymaster Clients                | `Map<string, Client>`         | Yes                              | # of paymaster accounts          |
| 14  | Redis Client                     | TCP socket + queue            | Bounded by Redis                 | —                                |
| 15  | AsyncLocalStorage                | Per-request context           | Bounded by concurrency           | —                                |
| 16  | Koa Middleware Stack             | Closure chain                 | Fixed at startup                 | —                                |
| 17  | RPC Method Registry              | `Map<string, Function>`       | Fixed at startup                 | —                                |
| 18  | EventEmitter Listeners           | Callback references           | Fixed at startup                 | —                                |
| 19  | Pino Logger Tree                 | Parent/child refs             | Fixed at startup                 | —                                |

Items marked **"No"** or **"Grows with label cardinality"** in the Bounded column are potential unbounded growth risks that warrant further investigation through runtime profiling.
