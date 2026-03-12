### Description

This PR migrates the relay from a Lerna-managed multi-package monorepo (4 workspace packages) into a single npm package with modular internal structure and a unified transport entrypoint.

---

#### Commit 1: `use workspaces and remove lerna`

Eliminates the Lerna dependency with zero behavior change.

- Replaced all `npx lerna run/exec` scripts with `npm run --workspaces` equivalents
- Made workspace ordering explicit in `package.json` (dependency-graph order)
- Deleted `lerna.json`, removed `lerna` from dependencies
- Removed `COPY lerna.json` from `Dockerfile`
- Updated 6 CI workflow files: `npx lerna run build` → `npm run build`

#### Commit 2: `collapse into single package + unified transport entrypoint`

Merges all 4 packages into a single package and introduces a unified entrypoint.

**Single package:**

- Moved source: `packages/*/src/*` → `src/*/` (config-service, relay, server, ws-server)
- Moved tests: `packages/*/tests/*` → `tests/*/`
- Rewrote **335 cross-package import statements** across **134 files** — all `@hashgraph/json-rpc-*` imports replaced with relative paths, `/dist/` segments dropped
- Consolidated 4 `package.json` files into 1 (deduplicated dependencies, removed `workspaces` field)
- Consolidated 4 `tsconfig.json` files into 1 root config (`rootDir: "src/"`, `outDir: "./dist"`)
- Updated `Dockerfile` to copy `src/` and single `tsconfig.json`
- Updated `scripts/.bump-version.js` to remove sub-package paths
- Updated CI workflow env file paths (`packages/server/tests/` → `tests/server/`)
- Added `no-experimental-strip-types` to `.mocharc.js` (Node 22 compatibility fix)
- Deleted all sub-package `package.json` and `tsconfig.json` files

**Unified transport entrypoint:**

- Created `src/index.ts` — single entrypoint that starts HTTP, WebSocket, or both based on `RPC_HTTP_ENABLED` / `RPC_WS_ENABLED` env vars
- Added `RPC_HTTP_ENABLED` and `RPC_WS_ENABLED` to `GlobalConfig` (defaults: HTTP on, WS off)
- Shared `Relay` instance, Redis client, and metrics registry across transports
- Updated `package.json`: `"start": "node dist/index.js"`, removed `start:ws`
- Updated `Dockerfile` entrypoint to `dist/index.js`
- Old entrypoints (`src/server/index.ts`, `src/ws-server/index.ts`) kept for reference

#### Commit 3: `update helm charts` (Stage 4)

Updates Helm charts to use config-based transport selection.

- HTTP chart (`hedera-json-rpc-relay`): added `RPC_HTTP_ENABLED: true`, `RPC_WS_ENABLED: false` to `values.yaml` config
- WS chart (`hedera-json-rpc-relay-websocket`): added `RPC_HTTP_ENABLED: false`, `RPC_WS_ENABLED: true` to `values.yaml` config
- WS chart: removed `args: ["start:ws"]` from `deployment.yaml` — transport is now selected via ConfigMap env vars
- Umbrella chart: no changes needed (already uses sub-chart conditions)

---

### Related issue(s)

Fixes #5062

### Testing Guide

1. **Build verification:**
   - `npm ci && npm run build` — should compile with zero errors
   - `docker build .` — should succeed

2. **Transport modes** (after build):
   - HTTP only (default): `node dist/index.js` → HTTP on port 7546, health on `/health/liveness`
   - WS only: `RPC_HTTP_ENABLED=false RPC_WS_ENABLED=true node dist/index.js` → WS on 8546, health on 8547
   - Both: `RPC_HTTP_ENABLED=true RPC_WS_ENABLED=true node dist/index.js` → HTTP on 7546 + WS on 8546
   - Neither enabled → fatal error, process exits

3. **Unit tests:**
   - `npm test` — runs config-service, relay, server (integration), and ws-server (unit) tests
   - Expect ~1827 passing; failures are infrastructure-dependent (Redis, mirror node) not migration-related

4. **Helm chart verification:**
   - `helm template test charts/hedera-json-rpc-relay --set config.CHAIN_ID=0x12a --set config.HEDERA_NETWORK=testnet --set config.MIRROR_NODE_URL=https://testnet.mirrornode.hedera.com` — ConfigMap should contain `RPC_HTTP_ENABLED: "true"`, `RPC_WS_ENABLED: "false"`
   - `helm template test charts/hedera-json-rpc-relay-websocket --set config.CHAIN_ID=0x12a --set config.HEDERA_NETWORK=testnet --set config.MIRROR_NODE_URL=https://testnet.mirrornode.hedera.com` — ConfigMap should contain `RPC_HTTP_ENABLED: "false"`, `RPC_WS_ENABLED: "true"`, no `args` in container spec

5. **Acceptance tests:** run against a live environment to validate end-to-end behavior is unchanged

### Key areas for review

| Area                     | What to check                                                                            | Files                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Import rewriting         | Spot-check relative paths are correct depth, no leftover `@hashgraph/json-rpc-*` imports | `src/**/*.ts`, `tests/**/*.ts`                               |
| Dependency consolidation | No missing/duplicate deps, versions match highest from sub-packages                      | `package.json`                                               |
| Unified entrypoint       | Shared relay/redis/registry, correct port binding per mode, graceful shutdown            | `src/index.ts`                                               |
| GlobalConfig             | New `RPC_HTTP_ENABLED`/`RPC_WS_ENABLED` entries with correct types/defaults              | `src/config-service/services/globalConfig.ts`                |
| Helm charts              | Transport env vars in ConfigMap, no `args: ["start:ws"]` in WS deployment                | `charts/*/values.yaml`, `charts/*/templates/deployment.yaml` |
| CI workflows             | Path references updated from `packages/server/tests/` → `tests/server/`                  | `.github/workflows/*.yml`                                    |

### Changes from original design (optional)

- Old entrypoints (`src/server/index.ts`, `src/ws-server/index.ts`) were kept rather than deleted, for one release cycle of backwards compatibility

### Additional work needed (optional)

- In-flight branches targeting `packages/` paths will need import path updates after this merges
- AN optional combined Helm deployment mode (single pod with both transports) was not implemented — can be added as follow-up
- Some esint-ignore statements were added as well as adding any/unknown types at several places in order to speed up the delivery of the POC

### Checklist

- [ ] I've assigned an assignee to this PR and related issue(s) (if applicable)
- [ ] I've assigned a label to this PR and related issue(s) (if applicable)
- [ ] I've assigned a milestone to this PR and related issue(s) (if applicable)
- [ ] I've updated documentation (code comments, README, etc. if applicable)
- [ ] I've done sufficient testing (unit, integration, etc.)
