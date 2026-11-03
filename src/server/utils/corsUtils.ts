// SPDX-License-Identifier: Apache-2.0

import cors from '@koa/cors';
import type Koa from 'koa';
import type { VerifyClientCallbackAsync } from 'ws';

import { ConfigService } from '../../config-service/services';

const WILDCARD = '*';

/** Normalized allowlist, rebuilt only when ConfigService hands back a different array. */
let cachedSource: readonly string[] | undefined;
let cachedAllowlist = new Set<string>();

/** Lowercases and drops a trailing slash, so `https://App.Example.com/` matches `https://app.example.com`. */
function normalizeOrigin(origin: string): string {
  return origin.trim().toLowerCase().replace(/\/+$/, '');
}

function allowlist(): Set<string> {
  const configured = ConfigService.get('CORS_ALLOWED_ORIGINS');

  if (configured !== cachedSource) {
    cachedSource = configured;
    cachedAllowlist = new Set(configured.map(normalizeOrigin));
  }

  return cachedAllowlist;
}

/**
 * Resolves the `Access-Control-Allow-Origin` value from the `CORS_ALLOWED_ORIGINS` allowlist.
 * An empty allowlist means no restriction, so the default stays the historical wildcard.
 *
 * @param requestOrigin - the request's `Origin` header, empty when absent.
 * @returns the origin to allow, or `''` to emit no CORS headers.
 */
export function resolveAllowedOrigin(requestOrigin: string): string {
  const allowed = allowlist();

  if (allowed.size === 0 || allowed.has(WILDCARD)) {
    return WILDCARD;
  }

  if (!requestOrigin) {
    return '';
  }

  return allowed.has(normalizeOrigin(requestOrigin)) ? requestOrigin : '';
}

/**
 * Enforces `CORS_ALLOWED_ORIGINS` on the WebSocket handshake, as browsers apply no CORS to WebSockets.
 * A handshake without an `Origin` is a non-browser client and is let through.
 */
export const verifyWsOrigin: VerifyClientCallbackAsync = ({ origin }, done) => {
  if (!origin || resolveAllowedOrigin(origin)) {
    done(true);
    return;
  }

  done(false, 403, 'Origin not allowed');
};

/**
 * Registers the CORS middleware, with the allowed origin resolved per request.
 * `credentials` is left off: the relay accepts no cookies or auth headers.
 */
export function applyCorsMiddleware(app: Koa): void {
  app.use(cors({ allowMethods: ['GET', 'POST'], origin: (ctx) => resolveAllowedOrigin(ctx.get('Origin')) }));
}
