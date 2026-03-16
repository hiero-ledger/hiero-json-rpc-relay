# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hedera JSON RPC Relay is a Node.js/TypeScript monorepo that implements Ethereum JSON-RPC APIs on top of the Hedera network. It bridges Ethereum tooling (MetaMask, ethers.js, etc.) to Hedera's consensus and mirror nodes.

## Commands

### Build & Development
```bash
npm run build           # Full build via Lerna across all packages
npm run compile         # Compile TypeScript only
npm run clean           # Clean dist directories
npm run dev             # Build and watch for changes
npm run start           # Start HTTP relay server (port 7546)
npm run start:ws        # Start WebSocket server (port 8546)
npm run print-env       # Print all environment configuration
```

### Testing
```bash
npm run test                                    # All unit/integration tests
npm run acceptancetest                          # Full acceptance test suite
npm run acceptancetest:api_batch1               # API tests batch 1 (also batch2, batch3)
npm run acceptancetest:ws                       # WebSocket acceptance tests
npm run acceptancetest:erc20                    # ERC20 tests
npm run acceptancetest:hbarlimiter_batch1       # HBAR rate limiter tests
npm run openrpctest                             # OpenRPC schema conformance tests
```

To run a single test file from within a package:
```bash
cd packages/relay
npm run test:eth-send-raw-transaction           # Specific eth method tests
npm run test:eth-get-block-by-number
npm run test-eth                                # All eth service tests
```

### Linting & Formatting
```bash
npm run lint            # ESLint across all packages
npm run format          # Prettier formatting
```

### Docker
```bash
docker compose up -d    # Start HTTP relay, WS relay, and Redis locally
npm run build:docker    # Build Docker image
```

## Architecture

### Package Structure

```
packages/
├── config-service/     # Singleton configuration manager (~100+ env vars)
├── relay/              # Core library: Ethereum RPC method implementations
├── server/             # HTTP server (Koa) serving JSON-RPC requests
└── ws-server/          # WebSocket server for eth_subscribe subscriptions
```

Packages depend on each other via local file references. `config-service` is used by all others; `relay` is the core library used by both servers.

### Request Flow

```
Client → HTTP/WS Server (Koa middleware) → JSON-RPC Router
       → Relay Service (eth_*, net_*, debug_*, admin_* methods)
       → MirrorNodeClient (REST, historical data) or SDKClient (gRPC, state changes)
       → Cache Layer (Redis or in-memory LRU)
```

### Key Files in `packages/relay/`

- `lib/relay.ts` — Main orchestrator, initializes all services
- `lib/eth.ts` — Ethereum RPC method implementations
- `lib/clients/mirrorNodeClient.ts` — REST client for Hedera Mirror Node
- `lib/clients/sdkClient.ts` — gRPC client for Hedera Consensus Node
- `lib/clients/cache/` — Caching layer abstraction (Redis or in-memory)
- `lib/services/ethService/` — Eth method execution logic
- `lib/services/hbarLimitService/` — HBAR spending limit enforcement
- `lib/services/rateLimiterService/` — Request rate limiting
- `lib/services/hapiService/` — Hedera API integration
- `lib/services/workersService/` — Piscina worker threads for heavy computation
- `lib/formatters.ts` — Data transformation to Ethereum-compatible formats
- `lib/precheck.ts` — Pre-validation of RPC requests
- `lib/model.ts` — Block, Transaction, Receipt, Log models
- `lib/constants.ts` — RPC constants and Hedera-to-Ethereum mappings

### Configuration

All configuration is managed by `packages/config-service/`. Environment variables cover: network selection, Mirror Node URL, Consensus Node URL, operator credentials, rate limiting, caching, logging, and performance tuning. See `docs/configuration.md` for the full list.

### Testing Conventions

- Test files: `<module>.spec.ts`
- Framework: Mocha + ts-mocha; assertions: Chai + chai-as-promised; mocks: Sinon + sinon-chai
- Test env files: `tests/test.env` (unit), `tests/localAcceptance.env`, `tests/testnetAcceptance.env`
- Use `rejectedWith` / `eventually` instead of try-catch in tests
- Prefer integration tests over unit tests when execution time is similar
- Only mock external dependencies (Mirror Node, Consensus Node); avoid over-mocking
- Unit tests target 90%+ coverage focused on edge cases
- Describe structure: `describe('<module>')` → `describe('<method>')` → `it('should <behavior>')`

### Code Standards

- All source files require an SPDX-License-Identifier header
- TypeScript strict mode; ES6 target, CommonJS modules
- Prettier: single quotes, 120-char line width, trailing commas
- Imports sorted alphabetically
- Pre-commit hooks (Husky) enforce lint and format on staged files
