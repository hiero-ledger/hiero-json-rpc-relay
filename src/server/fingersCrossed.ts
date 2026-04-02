// SPDX-License-Identifier: Apache-2.0

import type { DestinationStream } from 'pino';

const buffers = new Map<string, string[]>();

export function createFingersCrossedDestination(key: string) {
  return {
    write(chunk: string | Buffer) {
      const line = chunk instanceof Buffer ? chunk.toString('utf8') : (chunk as string);
      const arr = buffers.get(key) ?? [];
      arr.push(line);
      buffers.set(key, arr);
    },
    flushSync() {
      /* no-op */
    },
  } as DestinationStream;
}

export function flushBufferedLogs(writer: (line: string) => void, key: string) {
  const arr = buffers.get(key);
  if (!arr || arr.length === 0) return;
  for (const line of arr) writer(line);
  buffers.delete(key);
}

export function discardBufferedLogs(key: string) {
  buffers.delete(key);
}

export function responseHasError(body: unknown): boolean {
  if (!body) return false;
  if (Array.isArray(body)) {
    return body.some((item) => item && typeof item === 'object' && 'error' in (item as any));
  }
  if (typeof body === 'object') {
    return 'error' in (body as any);
  }
  return false;
}
