<!-- SPECTRA:START v1.0.2 -->

# Spectra Instructions

This project uses Spectra for Spec-Driven Development(SDD). Specs live in `openspec/specs/`, change proposals in `openspec/changes/`.

## Use `/spectra-*` skills when:

- A discussion needs structure before coding → `/spectra-discuss`
- User wants to plan, propose, or design a change → `/spectra-propose`
- Tasks are ready to implement → `/spectra-apply`
- There's an in-progress change to continue → `/spectra-ingest`
- User asks about specs or how something works → `/spectra-ask`
- Implementation is done → `/spectra-archive`
- Commit only files related to a specific change → `/spectra-commit`

## Workflow

discuss? → propose → apply ⇄ ingest → archive

- `discuss` is optional — skip if requirements are clear
- Requirements change mid-work? Plan mode → `ingest` → resume `apply`

## Parked Changes

Changes can be parked（暫存）— temporarily moved out of `openspec/changes/`. Parked changes won't appear in `spectra list` but can be found with `spectra list --parked`. To restore: `spectra unpark <name>`. The `/spectra-apply` and `/spectra-ingest` skills handle parked changes automatically.

<!-- SPECTRA:END -->

## Spectra ADR

After `/spectra-propose` completes, if the change is non-trivial or involves design decisions the team should review before implementation, automatically run `/generate-adr <change-name>` to generate an ADR for sharing in Notion. Signs that an ADR is warranted:

- The proposal contains a Non-Goals section listing rejected alternatives
- The design.md has more than one Decision heading
- The change touches more than two subsystems

The ADR is saved to `openspec/changes/<name>/adr.md` and printed for copy-paste into Notion. It is not required for small or unambiguous changes.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hiero JSON RPC Relay bridges Ethereum-compatible applications (wallets, DeFi, block explorers) to the Hedera Hashgraph network via standard Ethereum JSON-RPC methods and WebSocket subscriptions.

### Deployment Models

This is an **open-source project** (Apache-2.0). Anyone can self-host it — a single Docker container, a docker-compose stack, or a bare Node.js process. The default Dockerfile and docker-compose set no container memory limit and no `--max-old-space-size` flag; self-hosted operators may run with no HA or infrastructure-level controls.

**Hashio** is Hedera's own hosted deployment of this relay. Its production architecture includes:

- Multiple relay replicas behind a load balancer — a single pod OOM-kill is transparent to users
- Memory-capped containers (Kubernetes resource limits)
- Health checks + Kubernetes auto-restart (one health check cycle to recover)
- Upstream rate limiting and WAF before traffic reaches relay pods
- Prometheus threshold alerts on key metrics
- No persistent state — the relay is a stateless proxy, so crashed pods lose no data

When assessing vulnerability impact: Hashio's compensating controls (HA, rate limiting, auto-restart) reduce practical impact significantly. Self-hosted operators running the default config without these controls face higher exposure. Security fixes should address the underlying code regardless of deployment posture.

## Commands

```bash
# Build
npm run build          # clean + TypeScript compile
npm run compile        # TypeScript compile only (incremental)
npm run dev            # build + watch mode

# Run
npm start              # HTTP server (default port 7546)
npm run start:ws       # WebSocket only (port 8546)

# Test
npm test               # unit + integration tests (config-service, relay, server, ws-server)
npm run test:relay     # relay unit tests only
npm run test:server    # server integration tests only
npm run test:ws-server # websocket unit tests only

# Run a single test by name pattern
npx ts-mocha --recursive 'tests/relay/**/*.spec.ts' --grep "pattern" --exit

# Acceptance tests (require live Hedera environment)
npm run acceptancetest                    # full suite
npm run acceptancetest:api_batch1         # specific batch
npm run acceptancetest:release            # release smoke tests

# Code quality
npm run lint           # ESLint
npm run format         # Prettier
```

## Architecture

The codebase was recently migrated (PR #5062) from a 4-package Lerna monorepo to a single unified npm package. The previous `packages/` directory is gone; all source is now under `src/`. (not merged on main yet)

### Layers

```
HTTP/WebSocket Clients
    ↓
src/server/          - Koa HTTP server (port 7546): JSON-RPC routing, rate limiting, metrics
src/ws-server/       - Koa-websocket server (port 8546): eth_subscribe subscriptions
    ↓
src/relay/lib/       - RPC method implementations (eth, net, debug, admin, txpool)
    ↓
src/relay/lib/services/   - Domain services: ethService, hapiService, hbarLimitService, etc.
src/relay/lib/clients/    - External clients: Mirror Node HTTP, Hedera SDK, Redis/LRU cache
    ↓
Hedera Consensus Nodes / Mirror Node API / Redis
```

### Key entry points

- **`src/index.ts`** — unified entrypoint; starts HTTP and/or WS server based on `RPC_HTTP_ENABLED`/`RPC_WS_ENABLED` env vars; both transports share a single `Relay` instance, Redis connection, and Prometheus registry
- **`src/relay/lib/relay.ts`** — `Relay` class orchestrates all RPC namespaces, services, and clients; initialized via `await Relay.init()`
- **`src/relay/lib/eth.ts`** — 40+ `eth_*` method implementations
- **`src/config-service/services/globalConfig.ts`** — centralized config schema with all env vars, types, defaults, and validation rules

### Configuration

Configuration is loaded from `.env` via `dotenv` and validated at startup by `ConfigService` (singleton). See `docs/configuration.md` for the full env var reference. Key vars:

| Var                                     | Purpose                                         |
| --------------------------------------- | ----------------------------------------------- |
| `CHAIN_ID`                              | `0x12a` local, `0x128` testnet, `0x127` mainnet |
| `HEDERA_NETWORK`                        | `mainnet`, `testnet`, `previewnet`, or custom   |
| `MIRROR_NODE_URL`                       | Mirror node REST endpoint                       |
| `OPERATOR_ID_MAIN`, `OPERATOR_KEY_MAIN` | Transaction sender credentials                  |
| `RPC_HTTP_ENABLED` / `RPC_WS_ENABLED`   | Enable transports (HTTP default true)           |
| `REDIS_ENABLED`, `REDIS_URL`            | Distributed cache                               |
| `LOG_LEVEL`, `PRETTY_LOGS_ENABLED`      | Logging                                         |

### Caching

Two-layer: LRU in-memory + optional Redis. Implemented via `ICacheClient` strategy with `CacheClientFactory`. Decorator `@cache` on relay methods specifies per-method TTL.

### Rate limiting

- **IP-based**: `DEFAULT_RATE_LIMIT` requests per time window
- **HBAR-based**: Per-account spending limits tracked in LRU or Redis, enforced by `HbarLimitService`

### Design patterns

- **Decorators**: `@cache`, `@rpcMethod`, `@rpcParamLayoutConfig` on relay methods
- **Factories**: `CacheClientFactory`, `LockStrategyFactory`, `RegistryFactory`
- **Strategy**: Cache (LRU vs Redis), lock (local vs Redis), rate limit store
- **Repository**: DB access layer for HBAR spending plans (`src/relay/lib/db/`)
- **Worker pool**: Piscina workers in `src/relay/lib/services/workersService/`

### HTTP server endpoints

- `POST /` — JSON-RPC requests
- `GET /health/liveness` — health check
- `GET /metrics` — Prometheus metrics
- `GET /config` — relay config (secrets masked)
- `GET /openrpc` — OpenRPC schema

## Testing

Tests live in `tests/` mirroring the `src/` structure. Unit and integration tests use Mocha + Chai + Sinon. Redis tests use `redis-memory-server` (no external dependency needed).

Acceptance tests in `tests/server/acceptance/` and `tests/ws-server/acceptance/` require a live Hedera environment configured via `.env`.

## Code Style

- **SPDX header required** on all source files: `// SPDX-License-Identifier: Apache-2.0`
- **Prettier**: single quotes, semicolons, 120 char line width
- **ESLint 9** flat config (`eslint.config.mjs`): TypeScript strict, import sort
- Pre-commit hook (Husky + lint-staged) enforces lint + format on staged files

## Pushing to Github

- NEVER commit or push to GitHub unless the user explicitly asks for it in that message. Make changes, but stop before `git commit`/`git push` and wait for an explicit instruction.
- Always sign off commits using BOTH -S and -s
- start commit messages with fix:/feat:/chore: etc. following the best practices
- Never add yourself as a coauthor or mention claude anywhere in the git history
- Always use `.github/pull_request_template.md` when creating PRs — fill every section; use N/A for optional sections that don't apply
