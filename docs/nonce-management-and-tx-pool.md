### Nonce management and transaction pool

This document explains how a per-address pending pool adds a pending count to Mirror Node nonces for rapid multi-transaction sends.

It covers the background and motivation, configuration, storage backends, request flows, failure modes, and how this impacts `eth_getTransactionCount` and `eth_sendRawTransaction`.

---

### Background and motivation

Hedera does not maintain an Ethereum-style mempool. Mirror Node (MN) imports account state (including `ethereum_nonce`) with a slight delay. If clients fire multiple transactions rapidly and compute nonces from MN only, race conditions can lead to consensus failures (e.g., a later tx reaching the network before an earlier one).

To reduce these failures, the relay can maintain a per-address set of “pending” transactions it has seen and accepted, and expose that state to:

- Adjust the nonce precheck in `eth_sendRawTransaction`.
- Serve `eth_getTransactionCount(address, "pending")` as MN nonce + pending count for that address.

The feature is disabled by default and gated by configuration.

---

### High-level behavior

- When enabled, the relay records a transaction hash in a per-address pending set just before submitting it to a consensus node, and removes it after the transaction is observed as processed (success or failure) via Mirror Node polling.
- `eth_getTransactionCount(address, "latest")` returns the MN nonce only.
- `eth_getTransactionCount(address, "pending")` returns MN nonce + current pending count for that address (only when the feature flag is enabled).
- `eth_sendRawTransaction` precheck treats the acceptable signer nonce as MN nonce (+ pending count if enabled). If the transaction nonce is lower, the relay would throw an error.

Limitations (by design): Hedera services do not buffer transactions by nonce; users sending out-of-order nonces must resubmit later nonces after gaps are filled.

---

### Configuration

- `ENABLE_TX_POOL` (boolean; default: false)
  - Enables nonce management via the per-address pending pool.
  - Affects both precheck behavior in `eth_sendRawTransaction` and `eth_getTransactionCount(..., "pending")` responses.

- `REDIS_ENABLED` (boolean) and `REDIS_URL` (string)
  - If enabled and a valid URL is provided, the relay will attempt to connect to Redis and use it for the pending pool backend.
  - If disabled or unavailable, an in-memory local backend is used.

- `USE_ASYNC_TX_PROCESSING` (boolean)
  - If true, the relay returns the computed transaction hash immediately after prechecks. Pool bookkeeping still happens; MN polling and cleanup run in the background.

Caching notes for `eth_getTransactionCount`:
- The implementation skips cache whenever block param is a non-cachable value (e.g., `latest`/`pending`). Historical queries may be cached; `pending` relies on live MN data and in-process pending counts.

---

### Storage backends

The pool is implemented behind a small interface so operators can choose a backend.

- Local in-memory storage (default fallback)
  - Per-process `Map<string, Set<string>>` keyed by lowercase address.
  - Operations: add/remove a tx hash; get set size for count; clear all.
  - Duplicates are naturally prevented by `Set` semantics.
  - Resets on process restart; state is not shared across multiple relay instances.

- Redis storage
  - Uses Redis `SET` per address with key prefix (e.g., `pending:<address>`).
  - Operations: `SADD` (add), `SCARD` (count), `SREM` (remove), plus a SCAN-based `removeAll` for startup/maintenance.
  - Single Redis commands are atomic; this is sufficient for per-address count consistency in this design.
  - If Redis is not reachable, the relay falls back to local storage automatically (see Failure modes).

Key design choices in the current implementation:
- A per-address set is the source of truth for pending count.
- The backend stores only hashes for counting purposes; raw RLP bodies are not currently stored.

---

### Request flows

#### eth_getTransactionCount

- latest: return MN `ethereum_nonce`.
- pending: if `ENABLE_TX_POOL` is true, return `MN_nonce + pending_count(address)`; otherwise, return `MN_nonce`.

This lets users compute the next usable nonce even while MN has not yet reflected recent submissions.

#### eth_sendRawTransaction

1) Prechecks include:
   - Size/type/gas checks as before.
   - Account verification via MN.
   - Nonce precheck: define `signerNonce = MN_nonce` and, when `ENABLE_TX_POOL` is true, treat the acceptable minimum as `MN_nonce + pending_count(address)`. If `tx.nonce < signerNonce`, it fails.

2) Pool bookkeeping and submission:
   - Before submission, add the tx hash to the sender’s pending set.
   - Submit to consensus and poll Mirror Node to obtain the resulting Ethereum hash.
   - On success, remove the pending entry using the observed transaction hash.
   - On SDK timeout/connection drop, poll MN; if a record is found, remove and return its hash; if not, remove using the computed hash and return the computed hash.
   - On any terminal error, remove the pending entry and surface the error.

These rules ensure the pool reflects only transactions that the relay has accepted for submission and is robust to partial failures.

---

### Acceptance criteria mapping (abridged)

- After a tx is processed (success or failure), `pending` equals `latest` for that signer because the pending entry is removed.
- While one or more transactions are pending for a signer, `pending` is greater than `latest` when `ENABLE_TX_POOL = true`.
- With the feature disabled, behavior matches today’s MN-only semantics; race conditions (WRONG_NONCE) remain possible.


---

### FAQ

- Does this guarantee out-of-order nonce execution without resubmission?
  - No. Hedera does not maintain an execution buffer by nonce; users must resubmit later nonces if gaps existed when they were first sent.

- Is `eth_getTransactionCount` cached?
  - The method skips cache for `latest`/`pending` style requests to keep results fresh; historical queries may be cached.

- Why use a set instead of a list?
  - Sets prevent duplicates by construction and make counting O(1). The use case only needs a per-address count and membership for removal by hash.



