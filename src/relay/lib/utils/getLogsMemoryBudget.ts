// SPDX-License-Identifier: Apache-2.0

import { type JsonRpcError, predefined } from '../errors/JsonRpcError';
import { markAsBudgetError, type ResponseSizeBudgetParent } from './responseSizeBudget';

/**
 * One request's part of the {@link GetLogsMemoryBudget}. It is the parent of the request's `eth_getLogs` call
 * budgets, so every page they count is also counted in the relay-wide total.
 */
export interface GetLogsMemoryShare extends ResponseSizeBudgetParent {
  /** Bytes of log data this request holds in the memory budget. */
  readonly heldBytes: number;

  /** Gives all bytes of this request back once its response has been sent. Safe to call more than once. */
  close(): void;
}

/**
 * Limits the log data that all `eth_getLogs` calls on the relay together may hold in memory at the same time.
 */
export class GetLogsMemoryBudget {
  private used = 0;

  constructor(private readonly maxBytes: number) {}

  get usedBytes(): number {
    return this.used;
  }

  /**
   * Opens one request's share of the memory budget. The request must close it once its response has been sent.
   */
  open(): GetLogsMemoryShare {
    let held = 0;

    // Set when the relay total refused this share's bytes, or when the share was closed.
    let stopped = false;

    const busyError = (): JsonRpcError => markAsBudgetError(predefined.GET_LOGS_RELAY_BUSY());

    return {
      get heldBytes(): number {
        return held;
      },

      get isExceeded(): boolean {
        return stopped;
      },

      exceededError: (): JsonRpcError | undefined => (stopped ? busyError() : undefined),

      consume: (bytes: number): void => {
        assertByteCount(bytes);

        // A page that arrives after its request has ended must not be counted, or its bytes would never be given back.
        if (stopped) {
          throw busyError();
        }

        if (this.used + bytes > this.maxBytes) {
          stopped = true;
          throw busyError();
        }

        this.used += bytes;
        held += bytes;
      },

      release: (bytes: number): void => {
        assertByteCount(bytes);

        const returned = Math.min(bytes, held);

        held -= returned;
        this.used -= returned;
      },

      assertNotExceeded: (): void => {
        if (stopped) {
          throw busyError();
        }
      },

      close: (): void => {
        stopped = true;
        this.used -= held;
        held = 0;
      },
    };
  }
}

function assertByteCount(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error(`Invalid byte count: ${bytes}`);
  }
}
