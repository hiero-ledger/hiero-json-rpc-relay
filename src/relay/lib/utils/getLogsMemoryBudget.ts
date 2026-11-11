// SPDX-License-Identifier: Apache-2.0

import { predefined } from '../errors/JsonRpcError';

/**
 * One `eth_getLogs` call's part of the {@link GetLogsMemoryBudget}.
 */
export interface GetLogsMemoryShare {
  /** Bytes of log data this call holds in the memory budget. */
  readonly heldBytes: number;

  /**
   * Adds the bytes of a downloaded log page to the relay-wide total.
   *
   * @throws `GET_LOGS_RELAY_BUSY` when the relay total would go over the limit; the bytes are then not counted.
   */
  add(bytes: number): void;

  /** Gives all bytes of this call back to the memory budget. Safe to call more than once. */
  release(): void;
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
   * Opens one `eth_getLogs` call's share of the memory budget. The call must release it when it finishes or fails.
   */
  open(): GetLogsMemoryShare {
    let held = 0;
    let released = false;

    return {
      get heldBytes(): number {
        return held;
      },

      add: (bytes: number): void => {
        // A page that arrives after its call has ended must not be counted, or its bytes would never be given back.
        if (released) {
          throw new Error('Memory share was already released');
        }

        this.reserve(bytes);
        held += bytes;
      },

      release: (): void => {
        released = true;
        this.used -= held;
        held = 0;
      },
    };
  }

  private reserve(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error(`Invalid byte count: ${bytes}`);
    }

    if (this.used + bytes > this.maxBytes) {
      throw predefined.GET_LOGS_RELAY_BUSY;
    }

    this.used += bytes;
  }
}
