# Spec: Single Package Migration & Unified Transport Entrypoint

## Overview

Migrate the relay from a Lerna-managed multi-package monorepo to a single npm package with modular internal structure and a unified transport entrypoint. The work is split into 4 stages, each independently shippable and testable.

---

## Stage 1: Remove Lerna, Replace with npm Workspaces

**Goal:** Eliminate the Lerna dependency while keeping everything else identical. This is a no-behavior-change refactoring that unblocks all subsequent stages.

### 1.1 Replace root package.json scripts

In `package.json`, replace every `npx lerna run/exec` invocation:

```
"build":      "npx lerna run build"           →  "npm run build --workspaces"
"test":       "npx lerna run test"            →  "npm run test --workspaces"
"clean":      "npx lerna run clean"           →  "npm run clean --workspaces"
"compile":    "npx lerna run compile"         →  "npm run compile --workspaces"
"lint":       "npx lerna run lint"            →  "npm run lint --workspaces"
"format":     "npx lerna run format"          →  "npm run format --workspaces --if-present"
"build-and-test": "npx lerna run build && npx lerna run test"
                                              →  "npm run build --workspaces && npm run test --workspaces"
"start":      "npx lerna exec --scope @hashgraph/json-rpc-server -- npm run start"
                                              →  "npm run start -w @hashgraph/json-rpc-server"
"start:ws":   "npx lerna exec --scope @hashgraph/json-rpc-ws-server -- npm run start"
                                              →  "npm run start -w @hashgraph/json-rpc-ws-server"
"print-env":  "npx lerna exec --scope @hashgraph/json-rpc-config-service -- npm run print-env"
                                              →  "npm run print-env -w @hashgraph/json-rpc-config-service"
```

**Why `--if-present` for format:** The `format` script only exists in `config-service` and `relay`, not in `server` or `ws-server`. `lerna run` silently skips missing scripts; `npm run --workspaces` does not.

### 1.2 Make workspace ordering explicit

Replace the glob-based workspace declaration with an explicit ordered list that matches the dependency graph:

```json
"workspaces": [
  "packages/config-service",
  "packages/relay",
  "packages/server",
  "packages/ws-server"
]
```

**Why:** `npm run --workspaces` does NOT perform topological sorting. It runs in the order workspaces are listed. The current glob `"packages/**"` happens to resolve alphabetically in the correct order, but this is fragile.

### 1.3 Remove Lerna artifacts

- Delete `lerna.json`
- Remove `"lerna": "^9.0.0"` from `dependencies` in root `package.json`

### 1.4 Update Dockerfile

In `Dockerfile`, remove:
```dockerfile
COPY lerna.json ./
```

### 1.5 Update CI workflows

Replace `npx lerna run build` with `npm run build` in these workflow files (they call the root script which now uses workspaces internally):

- `.github/workflows/acceptance-workflow.yml` (line 83)
- `.github/workflows/conformity-workflow.yml` (line 80)
- `.github/workflows/dapp.yml` (line 50)
- `.github/workflows/dev-tool-workflow.yml` (line 53)
- `.github/workflows/hoppscotch.yml` (line 54)
- `.github/workflows/release-acceptance.yml` (line 69)

### 1.6 Verification

- `npm ci` succeeds
- `npm run build` builds all 4 packages in correct order
- `npm run test` runs all unit tests
- `npm run start` starts HTTP server
- `npm run start:ws` starts WS server
- `docker build .` succeeds
- CI passes (all workflows green)

### Files changed (Stage 1)

| File | Action |
|---|---|
| `package.json` | Edit scripts, remove lerna dep, explicit workspaces |
| `lerna.json` | Delete |
| `Dockerfile` | Remove 1 line |
| 6 workflow `.yml` files | Replace `npx lerna run build` → `npm run build` |

---

## Stage 2: Collapse into Single Package

**Goal:** Merge all 4 workspace packages into a single npm package. The `packages/` directory structure is kept but treated as internal modules with relative imports instead of npm package references.

### 2.1 Target directory structure

```
src/
  config-service/       ← was packages/config-service/src/
    services/
    commands/
  relay/                ← was packages/relay/src/
    index.ts
    formatters.ts
    utils.ts
    logsBloomUtils.ts
    lib/
  server/               ← was packages/server/src/
    index.ts            ← kept for reference, will be replaced by unified entrypoint in Stage 3
    server.ts
    formatters.ts
    koaJsonRpc/
  ws-server/            ← was packages/ws-server/src/
    index.ts            ← kept for reference, will be replaced by unified entrypoint in Stage 3
    webSocketServer.ts
    controllers/
    metrics/
    service/
    utils/
tests/
  config-service/       ← was packages/config-service/tests/
  relay/                ← was packages/relay/tests/
  server/               ← was packages/server/tests/
  ws-server/            ← was packages/ws-server/tests/
```

### 2.2 Move source files

For each package, move `src/` contents into `src/<module>/` and `tests/` into `tests/<module>/`:

```bash
# config-service
mv packages/config-service/src/* src/config-service/
mv packages/config-service/tests/* tests/config-service/

# relay
mv packages/relay/src/* src/relay/
mv packages/relay/tests/* tests/relay/

# server
mv packages/server/src/* src/server/
mv packages/server/tests/* tests/server/

# ws-server
mv packages/ws-server/src/* src/ws-server/
mv packages/ws-server/tests/* tests/ws-server/
```

### 2.3 Rewrite cross-package imports

There are **335 cross-package import statements across 134 files** (96 in source, 239 in tests). Each falls into one of 4 categories:

**Category A: `@hashgraph/json-rpc-config-service` → relative path to `config-service/`**

Pattern (most common):
```typescript
// BEFORE (appears in ~45 files across relay, server, ws-server)
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';

// AFTER (example from src/relay/lib/relay.ts)
import { ConfigService } from '../../config-service/services';
```

The `/dist/` segment is always dropped — we're importing source directly now, not compiled output.

**Category B: `@hashgraph/json-rpc-relay` → relative path to `relay/`**

Pattern (most common):
```typescript
// BEFORE (appears in ~70 files across server, ws-server, and relay's own tests)
import { Relay } from '@hashgraph/json-rpc-relay/dist';
import { RedisClientManager } from '@hashgraph/json-rpc-relay/dist/lib/clients/redisClientManager';
import constants from '@hashgraph/json-rpc-relay/dist/lib/constants';
import { RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';

// AFTER (example from src/server/server.ts)
import { Relay } from '../relay';
import { RedisClientManager } from '../relay/lib/clients/redisClientManager';
import constants from '../relay/lib/constants';
import { RequestDetails } from '../relay/lib/types';
```

Note: `@hashgraph/json-rpc-relay/dist` maps to `relay/index.ts` (the barrel export).

**Category C: `@hashgraph/json-rpc-server` → relative path to `server/`**

Pattern (appears in ~30 files, mostly ws-server):
```typescript
// BEFORE
import KoaJsonRpc from '@hashgraph/json-rpc-server/dist/koaJsonRpc';
import { IJsonRpcRequest } from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/IJsonRpcRequest';
import { spec } from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/RpcError';

// AFTER (example from src/ws-server/webSocketServer.ts)
import KoaJsonRpc from '../server/koaJsonRpc';
import { IJsonRpcRequest } from '../server/koaJsonRpc/lib/IJsonRpcRequest';
import { spec } from '../server/koaJsonRpc/lib/RpcError';
```

**Category D: Cross-package test imports (tests referencing another package's tests)**

Pattern (appears in ws-server acceptance tests importing server test helpers):
```typescript
// BEFORE
import MirrorClient from '@hashgraph/json-rpc-server/tests/clients/mirrorClient';
import { Utils } from '@hashgraph/json-rpc-server/tests/helpers/utils';
import { AliasAccount } from '@hashgraph/json-rpc-server/tests/types/AliasAccount';

// AFTER (example from tests/ws-server/acceptance/getBalance.spec.ts)
import MirrorClient from '../../server/clients/mirrorClient';
import { Utils } from '../../server/helpers/utils';
import { AliasAccount } from '../../server/types/AliasAccount';
```

### 2.4 Merge package.json files

Consolidate all dependencies from the 4 sub-package `package.json` files into the root `package.json`. Deduplicate — where versions differ, use the highest.

Key dependencies currently scoped to sub-packages that must move to root:

| Dependency | Currently in | Type |
|---|---|---|
| `@hashgraph/sdk` | relay, server (dev), ws-server (dev) | dependencies |
| `axios`, `axios-retry` | relay | dependencies |
| `ethers` | relay | dependencies |
| `lru-cache` | relay, ws-server | dependencies |
| `async-mutex` | relay | dependencies |
| `@koa/cors`, `koa` | server, ws-server | dependencies |
| `koa-websocket` | ws-server (already in root) | dependencies |
| `co-body` | server, ws-server | dependencies |
| `uuid` | server | dependencies |
| `dotenv`, `find-config` | config-service, relay | dependencies |
| `sinon`, `proxyquire` | relay (dev) | devDependencies |
| `redis-memory-server` | relay (dev) | devDependencies |

Remove the `"workspaces"` field entirely from root `package.json`.

### 2.5 Merge tsconfig files

All 4 sub-package tsconfigs are nearly identical (same `target`, `module`, `moduleResolution`, `strict`, etc.). Minor differences:

| Option | config-service | relay | server | ws-server |
|---|---|---|---|---|
| `skipLibCheck` | absent | `true` | `true` | `true` |
| `resolveJsonModule` | absent | absent | `true` | absent |

Create a single root `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "es6",
    "lib": ["es6"],
    "module": "commonjs",
    "rootDir": "src/",
    "moduleResolution": "node",
    "outDir": "./dist",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "noImplicitAny": false,
    "declaration": true,
    "strict": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

Add a separate `tsconfig.test.json` that extends it and includes `tests/` if needed for test compilation.

### 2.6 Update root package.json scripts

```json
{
  "build": "npm run clean && npm run compile",
  "clean": "rm -rf ./dist && rm -rf tsconfig.tsbuildinfo",
  "compile": "tsc -b tsconfig.json",
  "test": "c8 ts-mocha --recursive './tests/**/*.spec.ts' --exit",
  "test:relay": "c8 ts-mocha --recursive './tests/relay/**/*.spec.ts' --exit",
  "test:server": "c8 ts-mocha --recursive './tests/server/integration/**/*.spec.ts' --exit",
  "test:ws-server": "c8 ts-mocha --recursive './tests/ws-server/unit/**/*.spec.ts' --exit",
  "lint": "npx eslint .",
  "format": "npx prettier --write \"src/**/*.+(js|ts|json)\" \"tests/**/*.+(js|ts|json)\"",
  "start": "node dist/server/index.js",
  "start:ws": "node dist/ws-server/index.js"
}
```

Note: `start` and `start:ws` are temporary — Stage 3 replaces them with a unified entrypoint.

### 2.7 Update Dockerfile

```dockerfile
COPY package*.json ./
COPY --chown=node:node ./src ./src
COPY --chown=node:node ./tsconfig.json ./tsconfig.json
```

The `ENTRYPOINT` temporarily stays as `["node", "dist/server/index.js"]` until Stage 3.

### 2.8 Update bump-version script

In `scripts/.bump-version.js`, update the `paths` array:
```javascript
// BEFORE
paths: [
  "package.json",
  "packages/config-service/package.json",
  "packages/relay/package.json",
  "packages/server/package.json",
  "docs/openrpc.json",
  "packages/ws-server/package.json",
]

// AFTER
paths: [
  "package.json",
  "docs/openrpc.json",
]
```

### 2.9 Update CI workflows

- All `npm run build` / `npm run test` calls continue to work (same script names)
- The acceptance test commands in root `package.json` need path updates from `packages/server/tests/` → `tests/server/` and `packages/ws-server/tests/` → `tests/ws-server/`

### 2.10 Update file path references in source code

Check for hardcoded paths that reference the old structure:
```typescript
// In server.ts — openrpc.json path
fs.readFileSync(path.resolve(__dirname, '../../../docs/openrpc.json'))
// Must be updated to reflect new __dirname location after move
```

### 2.11 Delete old package structure

- Delete `packages/config-service/package.json`, `packages/relay/package.json`, `packages/server/package.json`, `packages/ws-server/package.json`
- Delete all 4 sub-package `tsconfig.json` files
- Delete empty `packages/` directory

### 2.12 Verification

- `npm ci` succeeds (single `package.json`)
- `tsc -b tsconfig.json` compiles all source with zero errors
- `npm run test` passes all unit tests
- `npm run start` starts HTTP server
- `npm run start:ws` starts WS server
- `docker build .` succeeds
- Acceptance tests pass

### Impact summary (Stage 2)

| Metric | Count |
|---|---|
| Import statements rewritten | ~335 |
| Files with import changes | ~134 |
| `package.json` files removed | 4 |
| `tsconfig.json` files removed | 4 |
| New/modified tsconfig files | 1 |

---

## Stage 3: Unified Transport Entrypoint

**Goal:** Replace the two separate entry points (`server/index.ts`, `ws-server/index.ts`) with a single `src/index.ts` that starts HTTP, WebSocket, or both based on configuration.

### 3.1 New config variables

Add to `GlobalConfig` in `src/config-service/services/globalConfig.ts`:

```typescript
RPC_HTTP_ENABLED: {
  envName: 'RPC_HTTP_ENABLED',
  type: 'boolean',
  required: false,
  defaultValue: true,
},
RPC_WS_ENABLED: {
  envName: 'RPC_WS_ENABLED',
  type: 'boolean',
  required: false,
  defaultValue: false,
},
```

### 3.2 Refactor server initialization to accept shared dependencies

Currently both `initializeServer()` and `initializeWsServer()` independently create:
- A `Relay` instance
- A Redis client connection
- A rate limit store
- A `prom-client` metrics registry
- `unhandledRejection` / `uncaughtException` handlers

Refactor both to accept these as parameters:

```typescript
// src/server/server.ts
export async function initializeServer(
  relay: Relay,
  register: Registry,
  redisClient?: RedisClient,
): Promise<{ app: Koa; relay: Relay }> {
  // ... use provided relay, register, redisClient instead of creating new ones
}

// src/ws-server/webSocketServer.ts
export async function initializeWsServer(
  relay: Relay,
  register: Registry,
  redisClient?: RedisClient,
): Promise<{ app: Koa; httpApp: Koa }> {
  // ... use provided relay, register, redisClient instead of creating new ones
}
```

### 3.3 Create unified entrypoint

Create `src/index.ts`:

```typescript
async function main() {
  // 1. Shared initialization (done once)
  const relay = await Relay.init(logger, register);
  const redisClient = RedisClientManager.isRedisEnabled()
    ? await RedisClientManager.getClient(logger) : undefined;

  const httpEnabled = ConfigService.get('RPC_HTTP_ENABLED');
  const wsEnabled = ConfigService.get('RPC_WS_ENABLED');

  if (!httpEnabled && !wsEnabled) {
    logger.fatal('At least one transport must be enabled (RPC_HTTP_ENABLED or RPC_WS_ENABLED)');
    process.exit(1);
  }

  const servers: Array<{ stop(): Promise<void> }> = [];

  // 2. Start HTTP transport
  if (httpEnabled) {
    const { app } = await initializeServer(relay, register, redisClient);
    const server = app.listen({
      port: ConfigService.get('SERVER_PORT'),
      host: ConfigService.get('SERVER_HOST'),
    });
    setServerTimeout(server);
    servers.push({ stop: () => new Promise(resolve => server.close(resolve)) });
    logger.info(`HTTP JSON-RPC server listening on port ${ConfigService.get('SERVER_PORT')}`);
  }

  // 3. Start WebSocket transport
  if (wsEnabled) {
    const { app, httpApp } = await initializeWsServer(relay, register, redisClient);
    const host = ConfigService.get('SERVER_HOST');

    const wsServer = app.listen({ port: ConfigService.get('WEB_SOCKET_PORT'), host });
    servers.push({ stop: () => new Promise(resolve => wsServer.close(resolve)) });
    logger.info(`WebSocket server listening on port ${ConfigService.get('WEB_SOCKET_PORT')}`);

    // WS health/metrics HTTP listener — only needed if HTTP transport is disabled
    if (!httpEnabled) {
      const wsHttpServer = httpApp.listen({
        port: ConfigService.get('WEB_SOCKET_HTTP_PORT'),
        host,
      });
      servers.push({ stop: () => new Promise(resolve => wsHttpServer.close(resolve)) });
      logger.info(`WS health endpoint on port ${ConfigService.get('WEB_SOCKET_HTTP_PORT')}`);
    }
  }

  // 4. Shared process handlers (registered once, not per-transport)
  process.on('unhandledRejection', (reason, p) => {
    logger.error(`Unhandled Rejection at: Promise: ${JSON.stringify(p)}, reason: ${reason}`);
  });
  process.on('uncaughtException', (err) => {
    logger.error(err, 'Uncaught Exception!');
  });

  // 5. Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await Promise.all(servers.map(s => s.stop()));
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
```

### 3.4 Port and host behavior

| Scenario | `SERVER_PORT` (7546) | `WEB_SOCKET_PORT` (8546) | `WEB_SOCKET_HTTP_PORT` (8547) |
|---|---|---|---|
| HTTP only (`RPC_HTTP_ENABLED=true, RPC_WS_ENABLED=false`) | HTTP + health + metrics | unused | unused |
| WS only (`RPC_HTTP_ENABLED=false, RPC_WS_ENABLED=true`) | unused | WebSocket | health + metrics |
| Both enabled | HTTP + health + metrics | WebSocket | **not started** (health/metrics served on SERVER_PORT) |

`SERVER_HOST` and `WEB_SOCKET_HOST` (if added) can be set independently to bind transports to different interfaces.

### 3.5 Rate limiting & metrics independence

- **HTTP rate limiting:** `IPRateLimiterService` inside `KoaJsonRpc`, keyed by IP
- **WS rate limiting:** `ConnectionLimiter` + `IPRateLimiterService`, keyed by IP + connection
- Both share the same underlying `RateLimitStore` instance (backed by in-memory or Redis)
- Both share the same `prom-client` `Registry` — counters/histograms are namespaced (`rpc_relay_` vs `ws_`) so they don't collide
- No behavior changes from current operation

### 3.6 Update root package.json scripts

```json
{
  "start": "node dist/index.js"
}
```

Remove `start:ws` — it's now `RPC_WS_ENABLED=true RPC_HTTP_ENABLED=false node dist/index.js`.

### 3.7 Update Dockerfile

```dockerfile
ENTRYPOINT ["node", "dist/index.js"]
```

Remove the `CMD` since there's only one entrypoint now. Default behavior starts HTTP only (matching current defaults).

### 3.8 Delete old entrypoints

Delete (or keep as dead code for one release cycle):
- `src/server/index.ts`
- `src/ws-server/index.ts`

### 3.9 Verification

- `RPC_HTTP_ENABLED=true RPC_WS_ENABLED=false node dist/index.js` → HTTP on 7546, health on 7546
- `RPC_HTTP_ENABLED=false RPC_WS_ENABLED=true node dist/index.js` → WS on 8546, health on 8547
- `RPC_HTTP_ENABLED=true RPC_WS_ENABLED=true node dist/index.js` → HTTP on 7546, WS on 8546, health on 7546
- Neither enabled → fatal error, process exits
- Docker container starts with defaults (HTTP only)
- All existing acceptance tests pass

---

## Stage 4: Update Helm Charts & Deployment

**Goal:** Update Helm charts to use the new config-based transport selection instead of container args.

### 4.1 HTTP chart (`charts/hedera-json-rpc-relay`)

Add to `values.yaml` config section:
```yaml
config:
  RPC_HTTP_ENABLED: true
  RPC_WS_ENABLED: false
  # ... existing config unchanged
```

In `deployment.yaml`, no more implicit reliance on the default `CMD` — the transport is now explicit in the ConfigMap.

### 4.2 WebSocket chart (`charts/hedera-json-rpc-relay-websocket`)

In `values.yaml`:
```yaml
config:
  RPC_HTTP_ENABLED: false
  RPC_WS_ENABLED: true
  SUBSCRIPTIONS_ENABLED: true
  # ... existing WS config unchanged
```

In `deployment.yaml`, remove:
```yaml
args: ["start:ws"]
```

The container now reads transport selection from environment variables injected via ConfigMap.

### 4.3 Umbrella chart (`charts/hedera-json-rpc`)

No structural changes needed. The umbrella chart already supports `relay.enabled` / `ws.enabled` conditions. Each sub-chart now configures the transport via env vars instead of container args.

### 4.4 Optional: combined deployment mode

Add a new values option to the umbrella chart for combined mode:
```yaml
combined:
  enabled: false  # when true, deploy one pod with both transports
```

When `combined.enabled: true`, deploy a single Deployment with `RPC_HTTP_ENABLED=true`, `RPC_WS_ENABLED=true`, exposing both ports.

### 4.5 Update bump-version script

Update Helm chart paths if charts are renamed or restructured. Currently references:
```javascript
paths: [
  "charts/hedera-json-rpc-relay/Chart.yaml",
  "charts/hedera-json-rpc-relay-websocket/Chart.yaml",
  "charts/hedera-json-rpc/Chart.yaml",
]
```

These stay the same unless charts are consolidated.

### 4.6 Verification

- `helm template` renders correctly for HTTP-only, WS-only, and combined configurations
- Health check probes hit the correct ports in each mode
- Existing CI chart tests pass (`.github/workflows/charts.yml`)
- Docker image smoke test (`image-build.yml`) passes

---

## Ordering & Dependencies

```
Stage 1 ──→ Stage 2 ──→ Stage 3 ──→ Stage 4
(lerna)     (single)    (unified)   (helm)
```

- Stage 1 is a prerequisite for Stage 2 (workspace commands are removed when workspaces are removed)
- Stage 3 depends on Stage 2 (the unified entrypoint imports from the new module paths)
- Stage 4 depends on Stage 3 (Helm changes reference the new entrypoint behavior)
- Each stage should be merged and validated in CI before starting the next

## Risk Mitigation

| Risk | Stage | Mitigation |
|---|---|---|
| Merge conflicts on open PRs | 2 | Announce migration window, merge all ready PRs first, provide a migration script for in-flight branches |
| Relative import paths are wrong | 2 | Write a codemod script to automate the rewriting; verify with `tsc --noEmit` |
| Tests break due to path changes | 2 | Run full test suite after each batch of file moves |
| Shared Relay instance causes side effects | 3 | Test combined mode thoroughly; the Relay is already designed to be a singleton |
| `WEB_SOCKET_HTTP_PORT` regression | 3 | Explicit test for WS-only mode verifying health endpoint on port 8547 |
| Helm chart misconfiguration | 4 | `helm template --debug` for each mode; CI chart linting |
