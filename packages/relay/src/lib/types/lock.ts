// SPDX-License-Identifier: Apache-2.0

/**
 * Interface for lock strategy implementations.
 * Strategies handle the actual locking mechanism (local in-memory or distributed via Redis).
 *
 * @remarks
 * Implementations must normalize addresses (e.g., lowercase) internally to ensure consistency.
 */
export interface LockStrategy {
  /**
   * Acquires a lock for the specified address.
   * Blocks until the lock is available or timeout is reached.
   *
   * @param address - The address to acquire the lock for (will be normalized by implementation).
   * @returns A promise that resolves to a unique session key upon successful acquisition, or null if acquisition fails (fail open).
   */
  acquireLock(address: string): Promise<string | undefined>;

  /**
   * Releases a lock for the specified address.
   * Only succeeds if the provided session key matches the current lock holder.
   *
   * @param address - The address to release the lock for (will be normalized by implementation).
   * @param sessionKey - The session key proving ownership of the lock.
   * @returns A promise that resolves when the lock is released or rejected if not owner.
   */
  releaseLock(address: string, sessionKey: string): Promise<void>;
}
