# Protocol Acceptance Tests

Tests in this directory are **protocol-parameterized**: each test runs against both the HTTP and WebSocket transports using the same assertions.

## Purpose

The relay exposes the same JSON-RPC methods over HTTP (`tests/server/acceptance/`) and WebSocket (`tests/ws-server/acceptance/`). Historically, tests for common `eth_*` methods were written separately for each transport, duplicating assertions and creating drift risk.

Tests here replace that duplication. One test file covers both transports. If a method behaves differently over HTTP vs WebSocket, the appropriate iteration fails and the other passes — making divergence immediately visible.

## What belongs here

- Any `eth_*` or `web3_*` method that is supported on both HTTP and WebSocket
- Tests that assert correctness of the RPC result, not transport-specific behavior

## What does NOT belong here

- WebSocket-specific behavior (subscriptions, connection lifecycle, frame handling) → `tests/ws-server/acceptance/`
- HTTP-specific behavior (batch requests, connection timeouts, HTTP error codes) → `tests/server/acceptance/`

## How to write a test

```typescript
import { ALL_PROTOCOL_CLIENTS } from '../helpers/protocolClient';

describe('@release @protocol-acceptance eth_yourMethod', async function () {
  for (const client of ALL_PROTOCOL_CLIENTS) {
    describe(client.label, () => {
      it('should ...', async () => {
        const result = await client.call('eth_yourMethod', [...params]);
        // assert on result
      });
    });
  }
});
```

`ALL_PROTOCOL_CLIENTS` contains one HTTP client and one WebSocket client. Both normalize the response to return the result directly and throw on RPC error.

## Migration

Existing tests in `tests/server/acceptance/` and `tests/ws-server/acceptance/` that cover the same method with duplicate assertions are candidates for migration here. When migrating, delete both originals and replace with a single file in this directory.
