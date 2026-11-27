// SPDX-License-Identifier: Apache-2.0

/**
 * Gives back a permit taken from a {@link ConcurrencyLimiter}. Calling it again has no effect.
 */
export type ReleasePermit = () => void;

/**
 * A counting semaphore with a FIFO queue. It limits how many operations run at once, across every caller that
 * shares the instance.
 *
 * The limit is read on every acquire and release, so a changed limit applies to the next permits without
 * recreating the limiter. Lowering it never interrupts the permits already granted; it only delays new ones.
 */
export class ConcurrencyLimiter {
  /**
   * Number of permits currently held.
   */
  private active = 0;

  /**
   * Callers waiting for a permit, oldest first. Each entry grants the permit to its caller.
   */
  private readonly waiters: (() => void)[] = [];

  /**
   * @param getLimit - Returns the maximum number of permits held at once; values below 1 are treated as 1.
   */
  constructor(private readonly getLimit: () => number) {}

  /**
   * Number of permits currently held.
   */
  get activeCount(): number {
    return this.active;
  }

  /**
   * Number of callers waiting for a permit.
   */
  get queuedCount(): number {
    return this.waiters.length;
  }

  /**
   * Takes a permit, waiting in line when the limit is reached.
   *
   * @param signal - Optional signal that takes the caller out of the queue when aborted.
   * @returns A function that gives the permit back. It must be called exactly once the work is done.
   * @throws The signal's abort reason, when the signal is aborted before the permit is granted.
   */
  acquire(signal?: AbortSignal): Promise<ReleasePermit> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }

    if (this.waiters.length === 0 && this.active < this.limit()) {
      this.active++;
      return Promise.resolve(this.createRelease());
    }

    return new Promise<ReleasePermit>((resolve, reject) => {
      const onAbort = (): void => {
        const index = this.waiters.indexOf(grant);
        if (index !== -1) {
          this.waiters.splice(index, 1);
        }
        reject(signal!.reason);
      };
      const grant = (): void => {
        signal?.removeEventListener('abort', onAbort);
        this.active++;
        resolve(this.createRelease());
      };

      this.waiters.push(grant);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * @returns The current limit, never below 1.
   */
  private limit(): number {
    return Math.max(1, this.getLimit());
  }

  /**
   * @returns A release function that frees its permit only on the first call.
   */
  private createRelease(): ReleasePermit {
    let released = false;
    return (): void => {
      if (released) {
        return;
      }
      released = true;
      this.active--;
      this.grantWaiting();
    };
  }

  /**
   * Hands free permits to the oldest waiting callers.
   */
  private grantWaiting(): void {
    while (this.waiters.length > 0 && this.active < this.limit()) {
      this.waiters.shift()!();
    }
  }
}
