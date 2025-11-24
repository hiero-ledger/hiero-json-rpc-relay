> [!NOTE]
> This is an experimental feature hidden behind a flag `ENABLE_NONCE_ORDERING`

## Nonce ordering with locks

This document explains how per-sender address locking ensures transaction ordering and prevents nonce-related failures when multiple transactions from the same sender arrive in rapid succession.

It covers the background and motivation, configuration, locking strategies, request flows, failure handling, and how this impacts `eth_sendRawTransaction`.

---

### Background and motivation

The Hedera JSON-RPC Relay processes `eth_sendRawTransaction` requests asynchronously. When multiple transactions from the same sender arrive within milliseconds of each other, asynchronous operations can cause them to reach consensus nodes out of order:

```
User submits:    Tx(nonce=0) → Tx(nonce=1) → Tx(nonce=2)
                      ↓              ↓              ↓
Async processing: [validate]    [validate]    [validate]
                      ↓              ↓              ↓
Reaches consensus: Tx(nonce=1) ← Tx(nonce=0) ← Tx(nonce=2) ❌ Wrong order!
```

**Result:** "Wrong nonce" errors because transactions reach consensus nodes out of order.

The root cause is that async calls to mirror nodes have variable latency, precheck operations complete at different speeds, and multiple relay instances can process transactions from the same sender simultaneously without any synchronization mechanism.

To address this, the relay implements a per-sender locking mechanism that serializes transaction processing per address while allowing concurrent processing for different senders.

---

### High-level behavior

- When enabled via `ENABLE_NONCE_ORDERING`, the relay acquires a per-address lock **before any async operations or side effects**, ensuring FIFO ordering.
- Lock acquisition happens before prechecks, validation, and transaction pool updates to prevent race conditions.
- Locks are automatically released immediately after consensus submission (whether successful or failure), with a maximum hold time (default: 30 seconds) to prevent deadlocks.
- If lock acquisition fails (e.g., Redis connectivity issues), the relay fails open and processes the transaction without locking to maintain availability.
- Different senders can process transactions concurrently without blocking each other, as locks are isolated per address.

Limitations (by design):

- This is not an Ethereum-style mempool. Transactions are processed in arrival order, not buffered for later reordering.
- Hedera consensus nodes reject transactions with nonce gaps; users must resubmit later transactions after gaps are filled.

---

### Configuration

- `ENABLE_NONCE_ORDERING` (boolean; default: false)
  - Master feature flag that enables the nonce ordering mechanism.
  - When disabled, transactions are processed without any locking, maintaining current behavior.
  - When enabled, transactions acquire locks before any async operations or side effects.

- `REDIS_ENABLED` (boolean) and `REDIS_URL` (string)
  - If enabled and a valid URL is provided, the relay will use Redis for distributed locking across multiple relay instances.
  - If disabled or unavailable, an in-memory local locking strategy is used (single process only).

- `LOCK_MAX_HOLD_MS` (number; default: 30000)
  - Maximum time (in milliseconds) a lock can be held before automatic force release.
  - Prevents deadlocks when transaction processing hangs or crashes.

- `LOCK_QUEUE_POLL_INTERVAL_MS` (number; default: 50)
  - Polling interval (in milliseconds) for Redis queue checks when waiting for lock acquisition.
  - Only applicable to Redis locking strategy.

- `LOCAL_LOCK_MAX_ENTRIES` (number; default: 1000)
  - Maximum number of addresses to track in the local lock cache.
  - Uses LRU eviction when limit is reached.
  - Only applicable to local locking strategy.

Strategy selection:

- If Redis is enabled and reachable, the relay uses the distributed Redis locking strategy.
- Otherwise, it falls back to the local in-memory strategy automatically.

---

### Locking strategies

The lock service uses a strategy pattern to support both local and distributed locking.

#### Local in-memory strategy

- Uses the `async-mutex` library wrapped with session key tracking and automatic expiration.
- Stores lock state in an LRU cache with configurable maximum entries.
- Guarantees FIFO ordering within a single process.
- Locks are lost on process restart; state is not shared across relay instances.

Key properties:

- ✅ FIFO ordering guaranteed by `async-mutex`
- ✅ Per-address isolation
- ✅ Automatic cleanup via LRU cache
- ✅ Never fails (always returns a session key)
- ❌ Single process only (no distributed locking)

#### Redis distributed strategy

- Uses Redis `SET NX` (set if not exists) with TTL for lock ownership.
- Uses Redis `LIST` for FIFO queue of waiters.
- Polling-based acquisition (checks queue position every 50ms by default).
- Automatic TTL-based expiration handles process crashes gracefully.

Key properties:

- ✅ Works across multiple relay instances
- ✅ FIFO ordering via Redis queue
- ✅ Automatic cleanup via TTL on process crashes
- ✅ Fail-open behavior on errors (returns null, transaction proceeds without lock)
- ⚠️ Requires Redis availability

Storage schema:

```
lock:{address}       → Current lock holder's session key (SET with TTL)
lock:queue:{address} → FIFO queue of waiters (LIST)
```

---

### Lock lifecycle

1. **Lock acquisition request**
   - Transaction arrives for processing.
   - Generate a unique session key (UUID) to identify this lock holder.

2. **Wait for lock**
   - Join the FIFO queue for this sender address.
   - Wait until first in queue (no timeout on waiting).
   - Acquire lock once available.

3. **Lock held**
   - Set ownership metadata (session key, acquisition time).
   - Start automatic force-release timer (default: 30 seconds).
   - Process transaction (validate, submit to consensus, poll mirror node).

4. **Lock release**
   - On successful submission or error, release lock.
   - Verify session key matches current holder (prevents hijacking).
   - Clear timer and wake next waiter in queue.

5. **Automatic force release**
   - If lock is held longer than `LOCK_MAX_HOLD_MS`, automatically release it.
   - Ensures queue progresses even if transaction processing hangs or crashes.

---

### Request flows

#### eth_sendRawTransaction

1. **Lock acquisition (before any async operations)**
   - If `ENABLE_NONCE_ORDERING` is enabled, acquire lock for sender address.
   - Normalize sender address (lowercase).
   - If acquisition fails (Redis error), returns null but proceeds without lock (fail-open).
   - Lock is acquired BEFORE any validation, side effects, or async operations to prevent race conditions.

2. **Prechecks** (protected by lock)
   - Validate transaction size, type, gas, and signature.
   - Verify account exists and nonce is valid via Mirror Node.
   - Add transaction to pending pool (if `ENABLE_TX_POOL` is enabled).

3. **Transaction processing** (protected by lock)
   - Submit transaction to consensus node.
   - Lock is released immediately after submission completes.
   - Remove transaction from pending pool.

4. **Post-submission** (lock already released)
   - Poll Mirror Node for confirmation and retrieve transaction hash.

5. **Error handling**
   - If an error occurs during prechecks or validation, release lock before throwing error.
   - Lock is always released via try-catch-finally pattern to ensure cleanup.

These rules ensure transactions from the same sender are processed in order while maintaining high availability through fail-open behavior.

---

### Fail-open behavior

When the Redis locking strategy encounters an error (e.g., network failure, connection timeout), it **fails open**:

- `acquireLock()` returns `null` instead of a session key.
- The transaction proceeds without locking.
- An error is logged for monitoring and debugging.

**Rationale:**

- Availability is prioritized over strict ordering in degraded states.
- Temporary nonce ordering issues are preferable to blocking all transactions.
- Users can still submit transactions even if Redis is down.

The local in-memory strategy never fails open because it has no external dependencies.

---

### Session keys and ownership verification

Each lock acquisition generates a unique session key (UUID) that:

- Proves ownership when releasing the lock.
- Prevents double-release bugs.
- Prevents lock hijacking by other sessions.

Only the session key holder can release a lock. Invalid release attempts are silently ignored.

Example:

```typescript
const sessionKey = await lockService.acquireLock(address); // "a1b2c3d4-5678-..."
// ... process transaction ...
await lockService.releaseLock(address, sessionKey); // Only succeeds if sessionKey matches
```

---

### Timeout strategy

| Timeout Type      | Duration           | Purpose                                          | Behavior                    |
| ----------------- | ------------------ | ------------------------------------------------ | --------------------------- |
| **Waiting Time**  | None               | Allow queue buildup without failing transactions | Waits indefinitely in queue |
| **Max Lock Time** | 30s (configurable) | Prevent deadlocks from hung transactions         | Force release after 30s     |

**Design decision:** No timeout on waiting in queue because the max lock time provides sufficient protection. If the current holder hangs, force release kicks in after 30 seconds and the queue progresses.

---

### Compatibility with async transaction processing

The lock service is fully compatible with `USE_ASYNC_TX_PROCESSING`:

- Lock is acquired before any prechecks or validation (synchronously in the main request path).
- When async mode is enabled, the transaction hash is returned immediately after prechecks pass.
- The lock persists across the async boundary during background processing.
- The lock is released after consensus submission completes in the background.
- Session key is passed to the async processor to ensure correct ownership.
- If an error occurs during prechecks (before async processing starts), the lock is released immediately.

---

### Monitoring and observability

The lock service logs the following events at appropriate levels:

- **Debug:** Lock acquisition/release with hold times and queue lengths
- **Trace:** Detailed lock lifecycle events (queue join, polling, acquisition)
- **Error:** Lock acquisition failures with fail-open behavior

Key metrics to monitor:

- Lock hold times (should be well under 30 seconds)
- Queue lengths (high values indicate congestion)
- Failed lock acquisitions (indicates Redis issues)
- Force releases (indicates hung transactions or timeouts)

---

### FAQ

#### Does this guarantee out-of-order nonce execution without resubmission?

No. Hedera consensus nodes do not maintain an execution buffer by nonce. This feature ensures transactions are submitted in order, but if a nonce gap exists when a transaction reaches the consensus node, it will be rejected and must be resubmitted.

#### Can transactions from different senders process in parallel?

Yes! Locks are per-sender address. Different senders have independent locks and process concurrently without blocking each other.

#### What happens if a transaction crashes while holding the lock?

The automatic force-release timer (default: 30 seconds) will release the lock. The next waiter in queue will be awakened and can proceed.

#### What happens if Redis goes down?

The Redis locking strategy fails open: transactions proceed without locking. Once Redis is restored, the relay automatically resumes using distributed locks. No manual intervention is required.

#### Why no timeout on waiting in queue?

The max lock time (30 seconds) provides sufficient protection. If the current holder hangs, they'll be force-released after 30 seconds and the queue progresses. Adding a wait timeout would cause later transactions to fail unnecessarily.

#### If 100 transactions are waiting in queue and the first one hangs, won't they all timeout?

No. Each transaction gets its own fresh 30-second window **after acquiring the lock**. The timer starts only when you hold the lock, not when you join the queue:

```
t=0s:   Tx1 acquires lock → 30s timer starts for Tx1
t=1s:   Tx2-100 join queue → NO timers yet, just waiting
t=30s:  Tx1's timer expires → Force released
t=30s:  Tx2 acquires lock → NEW 30s timer starts for Tx2
t=35s:  Tx2 completes and releases
t=35s:  Tx3 acquires lock → NEW 30s timer starts for Tx3
```

Each transaction in the queue gets a full 30 seconds to process once they acquire the lock.

#### Does this work with the transaction pool feature (`ENABLE_TX_POOL`)?

Yes! The lock service and transaction pool work together:

1. Lock is acquired for the sender address (before any operations)
2. Transaction prechecks are performed (protected by lock)
3. Transaction is added to the pending pool (protected by lock)
4. Transaction is submitted to consensus node (protected by lock)
5. Lock is released immediately after submission
6. Transaction is removed from pending pool after consensus (no longer needs lock)

Both features are independent and can be enabled/disabled separately.

#### How do I enable this feature?

Set the environment variable `ENABLE_NONCE_ORDERING=true`. The feature is disabled by default to allow for gradual rollout and testing.

#### What if I don't use Redis? Do I still get ordering guarantees?

Yes, but only within a single relay instance. The local in-memory strategy ensures FIFO ordering for transactions processed by the same relay process. If you run multiple relay instances without Redis, each instance has its own locks and cannot coordinate with others.
