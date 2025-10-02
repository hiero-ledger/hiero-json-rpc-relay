// SPDX-License-Identifier: Apache-2.0

/**
 * Strategy interface for lock acquisition and release.
 * All lock implementations must conform to this contract.
 *
 * This interface defines the core locking behavior abstraction, enabling
 * interchangeable locking strategies (local, distributed, etc.) without
 * affecting client code.
 */
export interface LockStrategy {
  /**
   * Acquires a lock for the specified resource.
   *
   * The implementation should handle:
   * - Timeout management
   * - Preserve exact orders of input
   * - Session key generation for lock ownership
   * - Error handling and cleanup
   *
   * @param lockId - Unique identifier of the resource to lock
   * @returns Promise resolving to a unique session key for lock release, or null if acquisition times out
   */
  acquireLock(lockId: string): Promise<string | null>;

  /**
   * Releases a previously acquired lock.
   *
   * The implementation should handle:
   * - Session key validation (prevent unauthorized releases)
   * - Double-release protection
   * - Cleanup of lock state
   * - Graceful handling of already-released locks
   *
   * @param lockId - Unique identifier of the resource to unlock
   * @param sessionKey - Session key returned from acquireLock()
   * @returns Promise resolving when lock is released
   */
  releaseLock(lockId: string, sessionKey: string): Promise<void>;
}
