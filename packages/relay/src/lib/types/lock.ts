// SPDX-License-Identifier: Apache-2.0

/**
 * Result returned when a lock is successfully acquired.
 * Contains both the session key (for ownership verification) and the acquisition timestamp (for metrics).
 */
export interface LockAcquisitionResult {
  /** Unique session key proving ownership of the lock */
  sessionKey: string;
  /** High-resolution timestamp (nanoseconds) when the lock was acquired */
  acquiredAt: bigint;
}

/**
 * Strategy type label values for lock metrics.
 */
export type LockStrategyLabel = 'local' | 'redis';

/**
 * Interface for lock strategy implementations.
 * Strategies handle the actual locking mechanism (local in-memory or distributed via Redis).
 *
 * @remarks
 * Implementations must normalize addresses (e.g., lowercase) internally to ensure consistency.
 */
export interface LockStrategy {
  /**
   * The type of lock strategy implementation (e.g., 'local', 'redis').
   * Used for diagnostics, metrics, or conditional logic in LockService.
   */
  readonly type: LockStrategyLabel;

  /**
   * Acquires a lock for the specified address.
   * Blocks until the lock is available or timeout is reached.
   *
   * @param address - The address to acquire the lock for (will be normalized by implementation).
   * @returns A promise that resolves to a LockAcquisitionResult upon successful acquisition, or undefined if acquisition fails (fail open).
   */
  acquireLock(address: string): Promise<LockAcquisitionResult | undefined>;

  /**
   * Releases a lock for the specified address.
   * Only succeeds if the provided session key matches the current lock holder.
   *
   * @param address - The address to release the lock for (will be normalized by implementation).
   * @param sessionKey - The session key proving ownership of the lock.
   * @param acquiredAt - The timestamp when the lock was acquired (for metrics calculation).
   * @returns A promise that resolves when the lock is released or rejected if not owner.
   */
  releaseLock(address: string, sessionKey: string, acquiredAt: bigint): Promise<void>;
}
