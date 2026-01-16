# SDK Configuration Guide

## Overview

The Hedera JSON-RPC Relay uses the Hedera JavaScript SDK to communicate with consensus nodes for transaction submission and query execution. Proper configuration of SDK timeout and retry parameters is critical for ensuring reliable operation, especially in production environments where network conditions can vary.

This guide explains how to configure SDK timeout and retry behavior to maximize resilience and prevent premature transaction failures.

## Key Configuration Parameters

Three environment variables control SDK timeout and retry behavior:

| Parameter             | Default  | Description                                                       |
| --------------------- | -------- | ----------------------------------------------------------------- |
| `SDK_GRPC_DEADLINE`   | 10000 ms | Maximum time for each individual gRPC request to a consensus node |
| `SDK_MAX_ATTEMPTS`    | 10       | Maximum number of retry attempts across different nodes           |
| `SDK_REQUEST_TIMEOUT` | 30000 ms | Total timeout for the entire operation including all retries      |

## Recommended Configuration

### The Configuration Formula

The SDK timeout parameters must satisfy this fundamental relationship to enable effective retry logic:

```
SDK_REQUEST_TIMEOUT ≥ SDK_GRPC_DEADLINE × SDK_MAX_ATTEMPTS
```

**This is the golden rule.** All other configuration decisions flow from this principle.

### Understanding the Parameters

| Parameter             | Role                                   | Tuning Guidance                                                                         |
| --------------------- | -------------------------------------- | --------------------------------------------------------------------------------------- |
| `SDK_GRPC_DEADLINE`   | Time limit for each individual request | Lower values = faster failure detection<br>Higher values = more patient with slow nodes |
| `SDK_MAX_ATTEMPTS`    | Number of retry attempts across nodes  | Lower values = fail faster<br>Higher values = more resilience                           |
| `SDK_REQUEST_TIMEOUT` | Total time budget for all attempts     | Must be ≥ (deadline × attempts) to allow full retry cycle                               |

### How SDK Retry Logic Works & Why Configuration Matters

Understanding the retry mechanism helps explain why proper configuration matters:

1. **Initial Request**: The SDK sends a transaction/query to a consensus node
2. **Timeout/Failure**: If the request times out after `SDK_GRPC_DEADLINE` milliseconds, the node is marked as unhealthy
3. **Retry Selection**: The SDK automatically selects a different healthy node from the network
4. **Repeat**: Steps 1-3 continue until either:
   - The transaction succeeds, OR
   - `SDK_MAX_ATTEMPTS` is exhausted, OR
   - `SDK_REQUEST_TIMEOUT` is reached

**With properly configured timeouts:**

- ✅ Failed requests can be retried on healthy nodes
- ✅ Network issues or slow nodes don't immediately fail transactions
- ✅ The system remains resilient to temporary node unavailability
- ✅ Retry logic across the node pool is fully utilized

**With misconfigured timeouts (e.g., `SDK_REQUEST_TIMEOUT` too low):**

- ❌ The total timeout is reached before all retry attempts are exhausted
- ❌ Transactions fail prematurely even when healthy nodes are available
- ❌ Users experience unnecessary transaction failures
- ❌ Retry logic becomes ineffective, wasting the node pool's redundancy

## Configuration Examples

These examples demonstrate how to apply the configuration formula to different operational requirements. **Note:** The specific values shown are examples - adjust based on your network conditions and requirements.

### Balanced Configuration (Production-Ready)

Suitable for most production deployments, balancing responsiveness with resilience:

```bash
SDK_GRPC_DEADLINE=10000      # 10 seconds per request
SDK_MAX_ATTEMPTS=10          # 10 retry attempts
SDK_REQUEST_TIMEOUT=100000   # 100 seconds (satisfies: 10s × 10 = 100s)
```

**Characteristics:**

- Allows full retry cycle across all 10 attempts
- Each node gets 10 seconds to respond
- Total operation can take up to 100 seconds in worst case
- Provides good balance between speed and reliability

### Alternative: Faster Failure Detection

Prioritizes faster feedback over maximum retry resilience:

```bash
SDK_GRPC_DEADLINE=5000       # 5 seconds per request
SDK_MAX_ATTEMPTS=8           # 8 retry attempts
SDK_REQUEST_TIMEOUT=40000    # 40 seconds (satisfies: 5s × 8 = 40s)
```

**Use cases:**

- Development environments where fast feedback is valuable
- Networks with consistently responsive nodes
- Applications with shorter user timeout expectations

### Alternative: Maximum Resilience

Prioritizes transaction success over speed:

```bash
SDK_GRPC_DEADLINE=15000      # 15 seconds per request
SDK_MAX_ATTEMPTS=12          # 12 retry attempts
SDK_REQUEST_TIMEOUT=180000   # 180 seconds (satisfies: 15s × 12 = 180s)
```

**Use cases:**

- Critical production systems requiring maximum reliability
- Networks with variable latency
- Scenarios where transaction success is more important than speed
- Automated testing suites
- Development/staging environments

## Additional Resources

- [Full Configuration Reference](configuration.md) - Complete list of all relay configuration options
- [Hedera SDK Documentation](https://docs.hedera.com/hedera/sdks-and-apis/sdks) - Official Hedera SDK documentation
