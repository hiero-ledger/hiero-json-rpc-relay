// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { predefined } from '../../../../src/relay/lib/errors/JsonRpcError';
import { GetLogsMemoryBudget } from '../../../../src/relay/lib/utils/getLogsMemoryBudget';

describe('GetLogsMemoryBudget', () => {
  it('counts the bytes of several calls toward one total', () => {
    const budget = new GetLogsMemoryBudget(100);
    const first = budget.open();
    const second = budget.open();

    first.add(30);
    second.add(20);
    first.add(10);

    expect(first.heldBytes).to.equal(40);
    expect(second.heldBytes).to.equal(20);
    expect(budget.usedBytes).to.equal(60);
  });

  it('accepts bytes up to exactly the limit', () => {
    const budget = new GetLogsMemoryBudget(100);

    budget.open().add(60);
    budget.open().add(40);

    expect(budget.usedBytes).to.equal(100);
  });

  it('refuses bytes that would go over the limit with GET_LOGS_RELAY_BUSY and does not count them', () => {
    const budget = new GetLogsMemoryBudget(100);
    const first = budget.open();
    const second = budget.open();
    first.add(60);

    expect(() => second.add(41))
      .to.throw()
      .that.equals(predefined.GET_LOGS_RELAY_BUSY);
    expect(predefined.GET_LOGS_RELAY_BUSY.code).to.equal(-32005);
    expect(predefined.GET_LOGS_RELAY_BUSY.message).to.equal(
      'eth_getLogs memory limit reached on the relay, try again later',
    );
    expect(second.heldBytes).to.equal(0);
    expect(budget.usedBytes).to.equal(60);
  });

  it('gives back only the bytes of the released call', () => {
    const budget = new GetLogsMemoryBudget(100);
    const first = budget.open();
    const second = budget.open();
    first.add(30);
    first.add(30);
    second.add(25);

    first.release();

    expect(first.heldBytes).to.equal(0);
    expect(second.heldBytes).to.equal(25);
    expect(budget.usedBytes).to.equal(25);
  });

  it('lets a new call fit after another call released its bytes', () => {
    const budget = new GetLogsMemoryBudget(100);
    const first = budget.open();
    first.add(80);

    expect(() => budget.open().add(30))
      .to.throw()
      .that.equals(predefined.GET_LOGS_RELAY_BUSY);

    first.release();
    const next = budget.open();
    next.add(30);

    expect(budget.usedBytes).to.equal(30);
  });

  it('gives the bytes back only once when released twice', () => {
    const budget = new GetLogsMemoryBudget(100);
    const first = budget.open();
    const second = budget.open();
    first.add(40);
    second.add(30);

    first.release();
    first.release();

    expect(budget.usedBytes).to.equal(30);
  });

  it('does not count a page that arrives after its call was released', () => {
    const budget = new GetLogsMemoryBudget(100);
    const share = budget.open();
    share.add(40);
    share.release();

    expect(() => share.add(10)).to.throw('Memory share was already released');
    expect(share.heldBytes).to.equal(0);
    expect(budget.usedBytes).to.equal(0);
  });

  it('rejects byte counts that are negative or not whole numbers', () => {
    const budget = new GetLogsMemoryBudget(100);
    const share = budget.open();

    for (const bytes of [-1, 1.5, NaN, Infinity]) {
      expect(() => share.add(bytes)).to.throw(`Invalid byte count: ${bytes}`);
    }

    expect(share.heldBytes).to.equal(0);
    expect(budget.usedBytes).to.equal(0);
  });
});
