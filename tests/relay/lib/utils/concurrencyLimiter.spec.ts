// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { ConcurrencyLimiter, type ReleasePermit } from '../../../../src/relay/lib/utils/concurrencyLimiter';

chai.use(chaiAsPromised);

describe('ConcurrencyLimiter', () => {
  const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  it('should grant permits up to the limit and queue the rest', async () => {
    const limiter = new ConcurrencyLimiter(() => 2);

    const first = await limiter.acquire();
    const second = await limiter.acquire();
    let thirdGranted = false;
    const third = limiter.acquire().then((release) => {
      thirdGranted = true;
      return release;
    });
    await flush();

    expect(limiter.activeCount).to.equal(2);
    expect(limiter.queuedCount).to.equal(1);
    expect(thirdGranted).to.be.false;

    first();
    (await third)();
    second();

    expect(limiter.activeCount).to.equal(0);
    expect(limiter.queuedCount).to.equal(0);
  });

  it('should grant queued permits in FIFO order', async () => {
    const limiter = new ConcurrencyLimiter(() => 1);
    const order: number[] = [];

    const held = await limiter.acquire();
    const waiting = [1, 2, 3].map((n) =>
      limiter.acquire().then((release) => {
        order.push(n);
        release();
      }),
    );

    held();
    await Promise.all(waiting);
    expect(order).to.deep.equal([1, 2, 3]);
  });

  it('should ignore a second release of the same permit', async () => {
    const limiter = new ConcurrencyLimiter(() => 1);

    const release = await limiter.acquire();
    const other = limiter.acquire();
    release();
    release();
    await other;

    expect(limiter.activeCount).to.equal(1);
  });

  it('should reject at once when the signal is already aborted', async () => {
    const limiter = new ConcurrencyLimiter(() => 1);

    await expect(limiter.acquire(AbortSignal.abort())).to.be.rejectedWith(/aborted/i);
    expect(limiter.activeCount).to.equal(0);
  });

  it('should take an aborted caller out of the queue', async () => {
    const limiter = new ConcurrencyLimiter(() => 1);
    const controller = new AbortController();

    const held = await limiter.acquire();
    const aborted = limiter.acquire(controller.signal);
    const next = limiter.acquire();
    expect(limiter.queuedCount).to.equal(2);

    controller.abort();
    await expect(aborted).to.be.rejectedWith(/aborted/i);
    expect(limiter.queuedCount).to.equal(1);

    held();
    const release: ReleasePermit = await next;
    expect(limiter.activeCount).to.equal(1);
    release();
    expect(limiter.activeCount).to.equal(0);
  });

  it('should apply a changed limit to the next permits', async () => {
    let limit = 1;
    const limiter = new ConcurrencyLimiter(() => limit);

    const first = await limiter.acquire();
    const second = limiter.acquire();
    const third = limiter.acquire();
    expect(limiter.queuedCount).to.equal(2);

    limit = 3;
    first();
    await Promise.all([second, third]);
    expect(limiter.activeCount).to.equal(2);
  });

  it('should treat a limit below 1 as 1', async () => {
    const limiter = new ConcurrencyLimiter(() => 0);

    const release = await limiter.acquire();
    expect(limiter.activeCount).to.equal(1);
    release();
  });
});
