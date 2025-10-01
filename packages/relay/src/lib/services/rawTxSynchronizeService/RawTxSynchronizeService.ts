// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Mutex, withTimeout } from 'async-mutex';
import { randomUUID } from 'crypto';
import { LRUCache } from 'lru-cache';
import { Logger } from 'pino';
import { createClient, RedisClientType } from 'redis';

/**
 * Represents the state of a lock for a specific sender address.
 * Encapsulates both the mutex and the active session keys for that lock.
 */
interface LockState {
  /** The mutex used for synchronization */
  mutex: Mutex;
  /** Set of active session keys that can release this lock */
  activeSessionKeys: Set<string>;
}

export class RawTxSynchronizeService {
  /** Lock acquisition timeout - how long a request waits before giving up (5 minutes) */
  private static readonly DEFAULT_LOCK_TIMEOUT_MS = 300_000;

  /** Local lock cleanup TTL - prevents memory leaks from abandoned locks (15 minutes) */
  private static readonly DEFAULT_LOCK_STATE_TTL_MS = 15 * 60 * 1000;

  /** Maximum concurrent sender locks to track (LRU eviction beyond this) */
  private static readonly MAX_LOCKS = 1000;

  /** Redis lock auto-expiration TTL - prevents deadlock if process crashes (30 seconds) */
  private static readonly REDIS_LOCK_TTL_MS = 30_000;

  /** Redis queue polling interval - checks FIFO position every 50ms */
  private static readonly REDIS_POLL_INTERVAL_MS = 50;

  private readonly logger: Logger;

  /** LRU cache with TTL for managing sender lock states with automatic cleanup */
  private readonly localLockStates: LRUCache<string, LockState>;

  /** Redis client for distributed locking */
  private redisClient?: RedisClientType;

  /** Redis connection state */
  private redisConnected: boolean = false;

  /**
   * Creates a new RawTxSynchronizeService instance.
   *
   * Initializes either Redis-based distributed locking or local mutex based on configuration.
   * Redis mode is enabled when REDIS_ENABLED is true and REDIS_URL is provided.
   * Otherwise, falls back to local mutex using LRU cache with automatic cleanup.
   *
   * @param logger - Logger instance for debugging and monitoring lock operations
   */
  constructor(logger: Logger) {
    this.logger = logger;

    // initialize local lock states
    this.localLockStates = this.initializeLocalLockStates();

    // Initialize Redis client if enabled in configuration
    if (ConfigService.get('REDIS_ENABLED') && !!ConfigService.get('REDIS_URL')) {
      this.initializeRedisClient();
    }
  }

  /**
   * Acquires a mutex lock for the specified sender address with timeout.
   *
   * Routes to Redis-based distributed lock or local mutex based on configuration.
   * Returns a unique session key for lock release and double-release protection.
   *
   * @param sender - The sender address (wallet address) to acquire the lock for
   * @returns Promise that resolves to a unique session key when the lock is successfully acquired
   * @throws Error if the lock acquisition fails due to timeout or internal errors
   */
  async acquireLock(sender: string): Promise<string> {
    if (this.redisConnected) {
      return await this.acquireRedisLock(sender);
    } else {
      return await this.acquireLocalLock(sender);
    }
  }

  /**
   * Releases the mutex lock for the specified sender address using a session key.
   *
   * Routes to Redis-based distributed lock or local mutex based on configuration.
   * Provides double-release protection through session key validation.
   *
   * @param sender - The sender address to release the lock for
   * @param sessionKey - The unique session key returned from acquireLock()
   * @returns Promise that resolves when the lock is successfully released or if already released
   */
  async releaseLock(sender: string, sessionKey: string): Promise<void> {
    if (this.redisConnected) {
      await this.releaseRedisLock(sender, sessionKey);
    } else {
      await this.releaseLocalLock(sender, sessionKey);
    }
  }

  /**
   * Initializes the local LRU cache for in-memory locking.
   * Always initialized to provide fallback when Redis is unavailable.
   *
   * @private
   * @returns Configured LRU cache for lock state management
   */
  private initializeLocalLockStates(): LRUCache<string, LockState> {
    return new LRUCache<string, LockState>({
      max: RawTxSynchronizeService.MAX_LOCKS,
      ttl: RawTxSynchronizeService.DEFAULT_LOCK_STATE_TTL_MS,
      dispose: (lockState: LockState, sender: string) => {
        if (lockState.mutex.isLocked()) {
          try {
            lockState.mutex.release();
            this.logger.debug(`Active lock auto-released during cleanup for sender: ${sender}`);
          } catch (error) {
            this.logger.warn(`Error auto-releasing lock during cleanup for sender: ${sender}`, error);
          }
        }
        lockState.activeSessionKeys.clear();
      },
    });
  }

  /**
   * Initializes Redis client for distributed locking.
   * Sets up connection event handlers and initiates async connection.
   *
   * @private
   */
  private initializeRedisClient(): void {
    const redisUrl = ConfigService.get('REDIS_URL')!;
    const reconnectDelay = ConfigService.get('REDIS_RECONNECT_DELAY_MS');

    this.redisClient = createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries: number) => {
          const delay = retries * reconnectDelay;
          this.logger.warn(`Redis reconnection attempt #${retries} with delay ${delay}ms`);
          return delay;
        },
      },
    });

    // Connection state handlers
    this.redisClient.on('ready', () => {
      this.redisConnected = true;
      this.logger.info(`RawTxSynchronizeService: Redis distributed locking enabled (${redisUrl})`);
    });

    this.redisClient.on('end', () => {
      this.redisConnected = false;
      this.logger.warn('RawTxSynchronizeService: Redis disconnected');
    });

    this.redisClient.on('error', (error) => {
      this.redisConnected = false;
      this.logger.error(`RawTxSynchronizeService Redis error: ${error.message}`);
    });

    // Async connection initialization
    this.redisClient.connect().catch((error) => {
      this.logger.error(`RawTxSynchronizeService: Failed to connect to Redis: ${error.message}`);
    });
  }

  /**
   * Acquires a local mutex lock for the specified sender address.
   *
   * Uses async-mutex with timeout protection and session key tracking.
   *
   * @private
   * @param sender - The sender address to acquire the lock for
   * @returns Promise that resolves to a unique session key when the lock is acquired
   * @throws Error if lock acquisition fails or timeout occurs
   */
  private async acquireLocalLock(sender: string): Promise<string> {
    let lockState = this.localLockStates.get(sender);
    if (!lockState) {
      lockState = {
        mutex: new Mutex(),
        activeSessionKeys: new Set<string>(),
      };
      this.localLockStates.set(sender, lockState);
    }

    const timeoutMutex = withTimeout(lockState.mutex, RawTxSynchronizeService.DEFAULT_LOCK_TIMEOUT_MS);
    const waitStartedAt = Date.now();
    const sessionKey = randomUUID();

    try {
      await timeoutMutex.acquire();
      lockState.activeSessionKeys.add(sessionKey);

      const waitDurationMs = Date.now() - waitStartedAt;
      this.logger.debug(`Local lock acquired: ${sender}, waited ${waitDurationMs}ms, session: ${sessionKey}`);
      return sessionKey;
    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        throw new Error(
          `Failed to acquire lock for sender ${sender}: timeout after ${RawTxSynchronizeService.DEFAULT_LOCK_TIMEOUT_MS}ms`,
        );
      }
      this.logger.error(`Failed to acquire lock for ${sender}:`, error);
      throw error;
    }
  }

  /**
   * Acquires a Redis-based distributed lock with FIFO ordering.
   *
   * FIFO Queue Pattern: Uses Redis LIST for fair ordering across distributed instances
   *   - LPUSH: New requests join at the head of the queue
   *   - LINDEX -1: Check if this session is first in line (tail of list)
   *   - RPOP: Remove from tail when lock is acquired
   *
   * Lock Ownership: Uses SET NX (set if not exists) for atomic lock acquisition
   * Polling Rationale: Cannot use blocking BLPOP because we need to check position
   *   before acquiring the lock to maintain FIFO ordering
   *
   * @private
   * @param sender - The sender address to acquire the lock for
   * @returns Promise that resolves to a unique session key when the lock is acquired
   * @throws Error if Redis operations fail or timeout occurs
   */
  private async acquireRedisLock(sender: string): Promise<string> {
    const queueKey = `lock:queue:${sender}`;
    const lockKey = `lock:${sender}`;
    const sessionKey = randomUUID();
    const waitStartedAt = Date.now();

    try {
      // Join the FIFO queue
      await this.redisClient!.lPush(queueKey, sessionKey);
      this.logger.debug(`Joined lock queue: ${sender}, session: ${sessionKey}`);

      // Poll until first in queue and can acquire the lock, or until exceeding timeout
      while (Date.now() - waitStartedAt < RawTxSynchronizeService.DEFAULT_LOCK_TIMEOUT_MS) {
        const firstInQueue = await this.redisClient!.lIndex(queueKey, -1);

        if (firstInQueue === sessionKey) {
          // Atomically acquire lock if available
          const acquired = await this.redisClient!.set(lockKey, sessionKey, {
            NX: true,
            PX: RawTxSynchronizeService.REDIS_LOCK_TTL_MS,
          });

          if (acquired) {
            await this.redisClient!.rPop(queueKey);
            const waitDurationMs = Date.now() - waitStartedAt;
            this.logger.debug(`Redis lock acquired: ${sender}, waited ${waitDurationMs}ms, session: ${sessionKey}`);
            return sessionKey;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, RawTxSynchronizeService.REDIS_POLL_INTERVAL_MS));
      }

      // cleanup and throw if lock timeouted
      await this.redisClient!.lRem(queueKey, 1, sessionKey);
      throw new Error(
        `Failed to acquire Redis lock for sender ${sender}: timeout after ${RawTxSynchronizeService.DEFAULT_LOCK_TIMEOUT_MS}ms`,
      );
    } catch (error) {
      // Cleanup queue entry on any error
      await this.redisClient!.lRem(queueKey, 1, sessionKey).catch((cleanupError) => {
        this.logger.warn(`Failed to cleanup queue entry for ${sender}:`, cleanupError);
      });
      throw error;
    }
  }

  /**
   * Releases a local mutex lock for the specified sender address.
   *
   * Validates session key before releasing to prevent double-release.
   *
   * @private
   * @param sender - The sender address to release the lock for
   * @param sessionKey - The unique session key returned from acquireLocalLock()
   * @returns Promise that resolves when the lock is released
   */
  private async releaseLocalLock(sender: string, sessionKey: string): Promise<void> {
    const lockState = this.localLockStates.get(sender);

    if (!lockState || !lockState.activeSessionKeys.has(sessionKey)) {
      // lock already released or expired from LRU cache
      return;
    }

    try {
      lockState.mutex.release();
      this.logger.debug(`Local lock released: ${sender}, session: ${sessionKey}`);
    } catch (error) {
      this.logger.error(`Error releasing local lock for ${sender}:`, error);
    } finally {
      lockState.activeSessionKeys.delete(sessionKey);
    }
  }

  /**
   * Releases a Redis-based distributed lock using Lua script for atomic session validation.
   *
   * Lua Script Rationale: Atomic check-and-delete prevents lock hijacking. Without atomicity,
   * another process could acquire the lock between GET and DEL operations.
   *
   * @private
   * @param sender - The sender address to release the lock for
   * @param sessionKey - The unique session key returned from acquireRedisLock()
   * @returns Promise that resolves when the lock is released
   */
  private async releaseRedisLock(sender: string, sessionKey: string): Promise<void> {
    const lockKey = `lock:${sender}`;

    /**
     * Lua script for atomic lock release with session validation.
     * Prevents lock hijacking by verifying session key before deletion.
     * Atomicity is critical - checks and deletes must be a single operation.
     */
    const REDIS_RELEASE_SCRIPT = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

    try {
      const result = await this.redisClient!.eval(REDIS_RELEASE_SCRIPT, {
        keys: [lockKey],
        arguments: [sessionKey],
      });

      if (result === 1) {
        this.logger.debug(`Redis lock released: ${sender}, session: ${sessionKey}`);
      }
      // Note: result === 0 means already released or wrong session - this is expected, no log needed
    } catch (error) {
      this.logger.error(`Error releasing Redis lock for ${sender}:`, error);
    }
  }
}
