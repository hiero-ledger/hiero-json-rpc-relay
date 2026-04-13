// SPDX-License-Identifier: Apache-2.0

import type Koa from 'koa';

const MAX_FORWARDED_HEADER_LENGTH = 1000;
const MAX_IP_LENGTH = 45; // Max IPv6 length
const SAFE_IP_CHARS = /^[a-fA-F0-9:.]+$/;
const HEADER_FORWARDED = 'forwarded';
const HEADER_X_FORWARDED_FOR = 'x-forwarded-for';

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

/**
 * Register proxy-related middleware on a Koa app:
 *   1. Sets `app.proxy = true` so `ctx.ip` reads from X-Forwarded-For.
 *   2. Parse RFC 7239 Forwarded headers and make it compatible with Koa's X-Forwarded-For parsing
 */
export function applyProxyMiddleware(app: Koa): void {
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
