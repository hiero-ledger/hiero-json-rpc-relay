// SPDX-License-Identifier: Apache-2.0

import { type JsonRpcError } from '../errors/JsonRpcError';
import { type MirrorNodeContractLog } from '../types/mirrorNode';

/**
 * JSON size of one `eth_getLogs` entry excluding its `data` and `topics` values: the fixed-width fields
 * (`address`, `blockHash`, `transactionHash`, ...), their keys and the punctuation.
 */
const LOG_BASE_JSON_SIZE = 363;

/**
 * JSON size of one topic: a 32 byte hex string, its quotes and the separating comma.
 */
const LOG_TOPIC_JSON_SIZE = 69;

/**
 * Errors raised by a budget, so callers can tell them apart from other failures without relying on error codes.
 */
const budgetErrors = new WeakSet<object>();

/**
 * A byte budget for a response that is still being assembled.
 *
 * Producers call {@link consume} as data arrives (for example, after every mirror node page), so that a response
 * which would grow past the limit is stopped while it is being assembled, instead of being detected only after
 * all of it is in memory. A budget may have a parent: every byte consumed is also charged to the parent, so a
 * batch can share one budget across all of its entries, including the ones still in flight.
 */
export class ResponseSizeBudget {
  private used = 0;

  /** Sticky: once a budget is exceeded it stays exceeded, even if bytes are released afterwards. */
  private exceeded = false;

  /**
   * @param maxBytes - The number of bytes this budget allows (use `Infinity` for a budget that only forwards).
   * @param createError - Builds the error thrown once this budget is exceeded.
   * @param parent - An optional budget that is charged with every byte consumed from this one.
   * @param onExceeded - Called once, synchronously, when this budget is first exceeded; typically aborts the
   *   work still in flight (e.g. the other timestamp slices, or the other entries of a batch).
   */
  constructor(
    private readonly maxBytes: number,
    private readonly createError: () => JsonRpcError,
    private readonly parent?: ResponseSizeBudget,
    private readonly onExceeded?: () => void,
  ) {}

  /**
   * Reports whether an error was raised by a response size budget.
   *
   * @param error - The value thrown by the failed operation.
   * @returns `true` when the error was raised by {@link consume} or {@link assertNotExceeded}.
   */
  static isExceededError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && budgetErrors.has(error);
  }

  /**
   * The number of bytes consumed from this budget so far.
   */
  get usedBytes(): number {
    return this.used;
  }

  /**
   * Whether this budget, or any of its parents, has been exceeded.
   */
  get isExceeded(): boolean {
    return this.exceeded || (this.parent?.isExceeded ?? false);
  }

  /**
   * Builds the error of the budget that was exceeded: this one, or else the nearest exceeded parent.
   *
   * @returns The error, or `undefined` when neither this budget nor a parent has been exceeded.
   */
  exceededError(): JsonRpcError | undefined {
    if (this.exceeded) return markAsBudgetError(this.createError());
    return this.parent?.exceededError();
  }

  /**
   * Charges bytes to this budget and to its parents.
   *
   * @param bytes - The number of bytes being added to the response.
   * @throws The budget's error once this budget, or a parent, is exceeded.
   */
  consume(bytes: number): void {
    this.used += bytes;
    if (this.used > this.maxBytes) this.throwExceeded();
    this.parent?.consume(bytes);
  }

  /**
   * Returns bytes to this budget and to its parents, for data that was fetched but is discarded (for example,
   * an attempt that is retried from scratch).
   *
   * @param bytes - The number of bytes to return.
   */
  release(bytes: number): void {
    this.used = Math.max(0, this.used - bytes);
    this.parent?.release(bytes);
  }

  /**
   * Throws when this budget, or a parent, has already been exceeded; used before starting more work.
   *
   * @throws The budget's error once this budget, or a parent, is exceeded.
   */
  assertNotExceeded(): void {
    if (this.exceeded) this.throwExceeded();
    this.parent?.assertNotExceeded();
  }

  private throwExceeded(): never {
    if (!this.exceeded) {
      this.exceeded = true;
      this.onExceeded?.();
    }
    throw markAsBudgetError(this.createError());
  }
}

function markAsBudgetError(error: JsonRpcError): JsonRpcError {
  budgetErrors.add(error);
  return error;
}

/**
 * Estimates the size of mirror node logs once they are serialized as `eth_getLogs` entries.
 *
 * The estimate is computed from the variable-length fields only, so it is cheap enough to run on every page.
 *
 * @param logs - The mirror node logs of one page.
 * @returns The estimated size, in bytes, of the logs in the JSON-RPC response.
 */
export function estimateLogsResponseSize(logs: MirrorNodeContractLog[]): number {
  let size = 0;
  for (const log of logs) {
    size += LOG_BASE_JSON_SIZE + (log.data?.length ?? 2) + (log.topics?.length ?? 0) * LOG_TOPIC_JSON_SIZE;
  }
  return size;
}
