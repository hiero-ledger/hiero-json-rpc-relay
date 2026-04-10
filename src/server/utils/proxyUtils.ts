// SPDX-License-Identifier: Apache-2.0

import Koa from 'koa';

/**
 * Parse RFC 7239 Forwarded header to extract the original client IP
 *
 * This function safely parses the Forwarded header.
 * It includes input length limits and basic validation to prevent malicious input from
 * causing performance issues.
 *
 * @param forwardedHeader - The Forwarded header value
 * @returns The client IP address or null if not found
 */
export function parseForwardedHeader(forwardedHeader: string): string | null {
  try {
    // Limit input length to prevent DoS attacks
    if (forwardedHeader.length > 1000) {
      return null;
    }

    // Split by comma to handle multiple forwarded entries
    const entries = forwardedHeader.split(',');

    // Take the first entry (original client)
    const firstEntry = entries[0]?.trim();
    if (!firstEntry) return null;

    // Find the 'for=' parameter using safe string parsing
    const forIndex = firstEntry.toLowerCase().indexOf('for=');
    if (forIndex === -1) return null;

    // Extract the value after 'for='
    const valueStart = forIndex + 4; // Length of 'for='
    if (valueStart >= firstEntry.length) return null;

    let ip: string;
    const char = firstEntry[valueStart];

    if (char === '"') {
      // Quoted value: for="192.168.1.1" or for="[2001:db8::1]"
      const closeQuoteIndex = firstEntry.indexOf('"', valueStart + 1);
      if (closeQuoteIndex === -1) return null;
      ip = firstEntry.substring(valueStart + 1, closeQuoteIndex);

      // Handle IPv6 in brackets within quotes: for="[2001:db8::1]"
      if (ip.startsWith('[') && ip.endsWith(']')) {
        ip = ip.substring(1, ip.length - 1);
      }
    } else if (char === '[') {
      // IPv6 in brackets: for=[2001:db8::1]
      const closeBracketIndex = firstEntry.indexOf(']', valueStart + 1);
      if (closeBracketIndex === -1) return null;
      ip = firstEntry.substring(valueStart + 1, closeBracketIndex);
    } else {
      // Unquoted value: for=192.168.1.1
      let endIndex = valueStart;
      while (endIndex < firstEntry.length) {
        const c = firstEntry[endIndex];
        if (c === ';' || c === ',' || c === ' ' || c === '\t') {
          break;
        }
        endIndex++;
      }
      ip = firstEntry.substring(valueStart, endIndex);
    }

    // Basic validation: ensure we have a non-empty result
    if (!ip || ip.length === 0 || ip.length > 45) {
      // Max IPv6 length is 45 chars
      return null;
    }

    // Basic IP format validation (very permissive)
    if (!/^[a-fA-F0-9:.]+$/.test(ip)) {
      return null;
    }

    return ip;
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
    if (!ctx.request.headers['x-forwarded-for'] && ctx.request.headers['forwarded']) {
      const forwardedHeader = ctx.request.headers['forwarded'] as string;
      // Parse the Forwarded header to extract the client IP
      // Format: Forwarded: for="192.168.1.1";by="10.0.0.1", for="203.0.113.1";by="10.0.0.2"
      const clientIp = parseForwardedHeader(forwardedHeader);
      if (clientIp) {
        // Set X-Forwarded-For so Koa can parse it normally
        ctx.request.headers['x-forwarded-for'] = clientIp;
      }
    }
    await next();
  });
}
