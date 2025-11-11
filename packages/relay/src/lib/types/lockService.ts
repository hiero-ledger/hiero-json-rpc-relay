// SPDX-License-Identifier: Apache-2.0

import { Mutex } from 'async-mutex';

/**
 * Represents the state of a lock for a specific address.
 * Contains mutex, ownership information, and timing metadata.
 */
export interface LockState {
  /**
   * The mutex that controls access to the lock.
   */
  mutex: Mutex;

  /**
   * The session key of the current lock holder.
   * Used to verify ownership during lock release.
   */
  sessionKey: string | null;

  /**
   * Timestamp (in milliseconds) when the lock was acquired.
   * Used to calculate hold time and enforce max lock duration.
   */
  acquiredAt: number;

  /**
   * Timer handle for automatic lock release after max lock time.
   * Null when no lock is held or timer is cleared.
   */
  maxLockTime: NodeJS.Timeout | null;
}

/**
 * Interface for lock strategy implementations.
 * Strategies handle the actual locking mechanism (local in-memory or distributed via Redis).
 */
export interface LockStrategy {
  /**
   * Acquires a lock for the specified address.
   * Blocks until the lock is available or timeout is reached.
   *
   * @param address - The address to acquire the lock for.
   * @returns A promise that resolves to a unique session key upon successful acquisition.
   */
  acquireLock(address: string): Promise<string>;

  /**
   * Releases a lock for the specified address.
   * Only succeeds if the provided session key matches the current lock holder.
   *
   * @param address - The address to release the lock for.
   * @param sessionKey - The session key proving ownership of the lock.
   * @returns A promise that resolves when the lock is released or rejected if not owner.
   */
  releaseLock(address: string, sessionKey: string): Promise<void>;
}

/**
 * Service responsible for managing transaction ordering through distributed locking.
 * Ensures transactions from the same sender are processed in FIFO order.
 */
export interface LockService {
  /**
   * Acquires a lock for the specified address.
   * Ensures that transactions from the same sender are processed serially.
   *
   * @param address - The sender address to acquire the lock for.
   * @returns A promise that resolves to a session key upon successful acquisition.
   */
  acquireLock(address: string): Promise<string>;

  /**
   * Releases a lock for the specified address.
   * Must be called after transaction processing is complete.
   *
   * @param address - The sender address to release the lock for.
   * @param sessionKey - The session key obtained during lock acquisition.
   * @returns A promise that resolves when the lock is released.
   */
  releaseLock(address: string, sessionKey: string): Promise<void>;
}
