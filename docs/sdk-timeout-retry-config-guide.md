# SDK Timeout And Retry Configuration Guide

## Overview

The Hedera JSON-RPC Relay uses the Hedera JavaScript SDK to communicate with consensus nodes for transaction submission. Proper configuration of SDK timeout and retry parameters is critical for ensuring reliable operation, especially in production environments where network conditions can vary.

This guide explains how to configure SDK timeout and retry behavior to maximize resilience and prevent premature transaction failures.

## Key Configuration Parameters

Three environment variables control SDK timeout and retry behavior:

| Parameter             | Default  | Description                                                                   |
| --------------------- | -------- | ----------------------------------------------------------------------------- |
| `SDK_GRPC_DEADLINE`   | 10000 ms | Maximum time for each individual node transaction attempt to a consensus node |
| `SDK_MAX_ATTEMPTS`    | 10       | Maximum number of retry attempts across different nodes                       |
| `SDK_REQUEST_TIMEOUT` | 30000 ms | Total timeout for the entire operation including all retries                  |

## Recommended Configuration

### The Configuration Formula

The SDK timeout parameters should satisfy this fundamental relationship to enable effective retry logic:

```
SDK_REQUEST_TIMEOUT ≥ SDK_GRPC_DEADLINE × SDK_MAX_ATTEMPTS
```

### Understanding the Parameters

| Parameter             | Role                                                    | Tuning Guidance                                                                       |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `SDK_GRPC_DEADLINE`   | Time limit for each individual node transaction attempt | Lower values = faster failure detection; Higher values = more patient with slow nodes |
| `SDK_MAX_ATTEMPTS`    | Number of retry attempts across nodes                   | Lower values = fail faster; Higher values = more resilience                           |
| `SDK_REQUEST_TIMEOUT` | Total time budget for all attempts                      | Should be ≥ (SDK_GRPC_DEADLINE × SDK_MAX_ATTEMPTS) to allow full retry cycle          |

### How SDK Retry Logic Works & Why Configuration Matters

Understanding the retry mechanism helps explain why proper configuration matters:

1. **Initial Attempt**: The SDK sends a transaction to a consensus node
2. **Timeout/Failure**: If the attempt times out after `SDK_GRPC_DEADLINE` milliseconds, the node is marked as unhealthy
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

**With misconfigured timeouts:**

- ❌ The total timeout might be reached before all retry attempts are exhausted
- ❌ Transactions might fail prematurely even when healthy nodes are available
- ❌ Users experience unnecessary transaction failures
- ❌ Retry logic becomes ineffective, wasting the node pool's redundancy

## Configuration Examples

### Balanced Configuration (Default)

This is the default configuration. It limits the total operation time to 30 seconds to prevent long delays. Although `SDK_MAX_ATTEMPTS` is set to 10, the 30-second timeout allows for approximately 3 full attempts at 10 seconds each before the operation is cancelled. This is sufficient to handle most common network unavailability-related-issues.

```bash
SDK_GRPC_DEADLINE=10000      # 10 seconds per node transaction attempt
SDK_MAX_ATTEMPTS=10          # 10 retry attempts
SDK_REQUEST_TIMEOUT=30000    # 30 seconds total operation limit
```

**Key Features:**

- **Reasonable Timeout**: 30 seconds avoids excessive waiting for users.
- **Sufficient Retries**: Attempts 3 different nodes, which typically resolves temporary errors.
- **Fail Fast**: Prioritizes returning a result quickly over exhausting all possible retries.

### Alternative: Faster Failure Detection

This setting allows the system to cycle through nodes more quickly when encountering unresponsive peers.

```bash
SDK_GRPC_DEADLINE=6000       # 6 seconds per node transaction attempt
SDK_MAX_ATTEMPTS=9           # 9 retry attempts
SDK_REQUEST_TIMEOUT=54000    # 54 seconds
```

**Use cases:**

- Development environments
- Fast, responsive networks
- Applications requiring quick error reporting

### Alternative: Maximum Reliability

This setting allows it to be highly resilient to temporary outages at the cost of potential long wait times.

```bash
SDK_GRPC_DEADLINE=15000      # 15 seconds per node transaction attempt
SDK_MAX_ATTEMPTS=12          # 12 retry attempts
SDK_REQUEST_TIMEOUT=180000   # 180 seconds
```

**Use cases:**

- Critical systems where reliability is paramount
- Unstable networks
- Background processes where speed is not critical

## Additional Resources

- [Full Configuration Reference](configuration.md) - Complete list of all relay configuration options
- [Hedera SDK Documentation](https://docs.hedera.com/hedera/sdks-and-apis/sdks) - Official Hedera SDK documentation
