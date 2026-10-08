// SPDX-License-Identifier: Apache-2.0

import { BlockList, isIP } from 'node:net';

import type Koa from 'koa';
import type websockify from 'koa-websocket';
import type { Logger } from 'pino';

import { ConfigService } from '../../config-service/services';
import { RealIpAddressMode } from '../../config-service/services/globalConfig';

const MAX_FORWARDED_HEADER_LENGTH = 1000;
const MAX_IP_LENGTH = 45; // Max IPv6 length
const SAFE_IP_CHARS = /^[a-fA-F0-9:.]+$/;
const HEADER_FORWARDED = 'forwarded';
const HEADER_X_FORWARDED_FOR = 'x-forwarded-for';
const IPV4_MAPPED_PREFIX = '::ffff:';

/**
 * Extracts an IP address from a quoted `for=` value.
 *
 * Handles both plain quoted IPv4 (`for="192.168.1.1"`) and
 * bracket-wrapped IPv6 inside quotes (`for="[2001:db8::1]"`).
 *
 * @param value - The forwarded header entry string.
 * @param start - Index of the opening `"` character.
 * @returns The extracted IP string, or `null` if the closing quote is missing.
 */
function extractQuotedIp(value: string, start: number): string | null {
  const closeQuoteIndex = value.indexOf('"', start + 1);
  if (closeQuoteIndex === -1) return null;
  const ip = value.substring(start + 1, closeQuoteIndex);
  // Handle IPv6 in brackets within quotes: for="[2001:db8::1]"
  if (ip.startsWith('[') && ip.endsWith(']')) {
    return ip.substring(1, ip.length - 1);
  }
  return ip;
}

/**
 * Extracts an IPv6 address from a bracketed `for=` value (e.g. `for=[2001:db8::1]`).
 *
 * @param value - The forwarded header entry string.
 * @param start - Index of the opening `[` character.
 * @returns The extracted IPv6 string, or `null` if the closing bracket is missing.
 */
function extractBracketedIp(value: string, start: number): string | null {
  const closeBracketIndex = value.indexOf(']', start + 1);
  if (closeBracketIndex === -1) return null;
  return value.substring(start + 1, closeBracketIndex);
}

/**
 * Extracts an unquoted IP address from a `for=` value (e.g. `for=192.168.1.1`).
 *
 * Reads characters until a delimiter (`;`, `,`, space, or tab) is encountered.
 *
 * @param value - The forwarded header entry string.
 * @param start - Index of the first character of the IP value.
 * @returns The extracted IP string (may be empty if the value starts with a delimiter).
 */
function extractUnquotedIp(value: string, start: number): string {
  const relativeEnd = value.slice(start).search(/[;, \t]/);
  if (relativeEnd === -1) return value.slice(start);
  return value.slice(start, start + relativeEnd);
}

/**
 * Locates the `for=` parameter in a single forwarded entry and delegates
 * extraction to the appropriate helper based on the value's opening character.
 *
 * @param entry - A single (already trimmed) forwarded entry, e.g. `for=192.168.1.1;proto=https`.
 * @returns The raw extracted IP string, or `null` if the `for=` parameter is absent or malformed.
 */
function extractIpFromForEntry(entry: string): string | null {
  // Find the 'for=' parameter using safe string parsing
  const forIndex = entry.toLowerCase().indexOf('for=');
  if (forIndex === -1) return null;

  // Extract the value after 'for='
  const valueStart = forIndex + 4; // Length of 'for='
  if (valueStart >= entry.length) return null;

  const char = entry[valueStart];
  if (char === '"') return extractQuotedIp(entry, valueStart);
  if (char === '[') return extractBracketedIp(entry, valueStart);
  return extractUnquotedIp(entry, valueStart);
}

/**
 * Validates that a candidate IP string is non-empty, within the maximum
 * allowed length, and contains only characters valid in IPv4/IPv6 addresses.
 *
 * @param ip - The candidate IP string to validate.
 * @returns `true` if the string passes all basic checks, `false` otherwise.
 */
function isValidIp(ip: string): boolean {
  return ip.length > 0 && ip.length <= MAX_IP_LENGTH && SAFE_IP_CHARS.test(ip);
}

/**
 * Parses the value of an HTTP `Forwarded` header and returns the IP address
 * of the original client (the `for=` field of the first entry).
 *
 * Supports the following `for=` value formats:
 * - Unquoted IPv4: `for=192.168.1.1`
 * - Quoted IPv4: `for="192.168.1.1"`
 * - Bracketed IPv6: `for=[2001:db8::1]`
 * - Quoted bracketed IPv6: `for="[2001:db8::1]"`
 *
 * Input is capped at {@link MAX_FORWARDED_HEADER_LENGTH} characters to prevent DoS attacks.
 *
 * @param forwardedHeader - The raw value of the `Forwarded` HTTP header.
 * @returns The extracted IP address string, or `null` if the header is absent,
 *   malformed, exceeds the length limit, or fails basic IP validation.
 */
export function parseForwardedHeader(forwardedHeader: string): string | null {
  try {
    // Limit input length to prevent DoS attacks
    if (forwardedHeader.length > MAX_FORWARDED_HEADER_LENGTH) return null;

    // Split by comma to handle multiple forwarded entries and take the first entry (original client)
    const firstEntry = forwardedHeader.split(',')[0]?.trim();
    if (!firstEntry) return null;

    const ip = extractIpFromForEntry(firstEntry);
    return ip && isValidIp(ip) ? ip : null;
  } catch {
    // If parsing fails, return null to avoid breaking the request
    return null;
  }
}

/** Unwraps an IPv4-mapped IPv6 address (e.g. `::ffff:10.0.0.5`) so a client keeps one identity on a dual-stack listener. */
function normalizeIp(ip: string): string {
  if (!ip.toLowerCase().startsWith(IPV4_MAPPED_PREFIX)) {
    return ip;
  }

  const unmapped = ip.slice(IPV4_MAPPED_PREFIX.length);
  // Node's isIP returns 4 for IPv4, 6 for IPv6 and 0 for anything else.
  if (isIP(unmapped) !== 4) {
    return ip;
  }

  return unmapped;
}

function ipFamily(ip: string): 'ipv4' | 'ipv6' {
  // Node's isIP returns 4 for IPv4, 6 for IPv6 and 0 for anything else.
  return isIP(ip) === 6 ? 'ipv6' : 'ipv4';
}

/**
 * Reads the client IP a trusted proxy appended, which is the last entry because proxies append rather than replace.
 */
function lastForwardedIp(request: Koa.Request): string | null {
  const xForwardedFor = request.get(HEADER_X_FORWARDED_FOR);
  const header = xForwardedFor || request.get(HEADER_FORWARDED);
  let ip: string | null = header.slice(header.lastIndexOf(',') + 1).trim();
  if (!xForwardedFor) {
    ip = parseForwardedHeader(ip);
  }

  if (!ip || !isIP(ip)) {
    return null;
  }

  return normalizeIp(ip);
}

/**
 * `TRUSTED_PROXIES` and `DIRECT_PEER` modes: sets `ctx.request.ip` once per request or connection to the TCP peer,
 * or, when the peer is one of `trustedProxyIps`, to the client IP it forwarded.
 */
function useClientIp(app: Koa | websockify.App, trustedProxyIps: readonly string[] = []): void {
  const trustedProxies = new BlockList();
  trustedProxyIps.map(normalizeIp).forEach((ip) => trustedProxies.addAddress(ip, ipFamily(ip)));

  // Keep Koa from reading forwarding headers itself, should anything read the IP before this middleware runs.
  app.proxy = false;

  const middleware = (ctx: Koa.Context, next: Koa.Next): Promise<void> => {
    // The TCP peer is the only client identity a caller cannot forge with headers.
    const peer = normalizeIp(ctx.request.socket.remoteAddress ?? '');
    let forwardedIp: string | null = null;
    if (trustedProxies.check(peer, ipFamily(peer))) {
      forwardedIp = lastForwardedIp(ctx.request);
    }

    // Fall back to the peer when a trusted proxy sends no usable IP, e.g. on its own health checks.
    ctx.request.ip = forwardedIp ?? peer;
    return next();
  };

  app.use(middleware);
  if ('ws' in app) {
    app.ws.use(middleware);
  }
}

/**
 * Registers how the client IP is resolved, according to `REAL_IP_ADDRESS_MODE`, on a Koa app and,
 * for the WS server, on its connection middleware too.
 *
 * @param app - The HTTP app, or the `koa-websocket` app whose connections need the same client IP.
 * @param logger - Logger used to report the active mode once at startup.
 */
export function applyProxyMiddleware(app: Koa | websockify.App, logger: Logger): void {
  const mode = ConfigService.get('REAL_IP_ADDRESS_MODE');

  // Log the enum constants rather than `mode`, since CodeQL flags any env-derived value in a log as sensitive.
  if (mode === RealIpAddressMode.TRUSTED_PROXIES) {
    logger.info(
      `REAL_IP_ADDRESS_MODE=${RealIpAddressMode.TRUSTED_PROXIES}: client IP is read from forwarding headers only on requests from TRUSTED_PROXY_IPS`,
    );
    useClientIp(app, ConfigService.get('TRUSTED_PROXY_IPS'));
    return;
  }

  if (mode === RealIpAddressMode.DIRECT_PEER) {
    logger.info(
      `REAL_IP_ADDRESS_MODE=${RealIpAddressMode.DIRECT_PEER}: client IP is the network peer, forwarding headers are ignored`,
    );
    useClientIp(app);
    return;
  }

  logger.info(
    `REAL_IP_ADDRESS_MODE=${RealIpAddressMode.X_FORWARDED_FOR}: client IP is read from forwarding headers, which is only safe behind a proxy that overwrites them`,
  );

  // enable proxy support to trust proxy-added headers for client IP detection
  app.proxy = true;

  app.use(async (ctx, next) => {
    // Only process if X-Forwarded-For doesn't exist but Forwarded does
    if (!ctx.request.headers[HEADER_X_FORWARDED_FOR] && ctx.request.headers[HEADER_FORWARDED]) {
      const forwardedHeader = ctx.request.headers[HEADER_FORWARDED] as string;
      // Parse the Forwarded header to extract the client IP
      // Format: Forwarded: for="192.168.1.1";by="10.0.0.1", for="203.0.113.1";by="10.0.0.2"
      const clientIp = parseForwardedHeader(forwardedHeader);
      if (clientIp) {
        // Set X-Forwarded-For so Koa can parse it normally
        ctx.request.headers[HEADER_X_FORWARDED_FOR] = clientIp;
      }
    }
    await next();
  });
}
