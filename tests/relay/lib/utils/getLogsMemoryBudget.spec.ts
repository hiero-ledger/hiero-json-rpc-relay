// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { type JsonRpcError, predefined } from '../../../../src/relay/lib/errors/JsonRpcError';
import { GetLogsMemoryBudget } from '../../../../src/relay/lib/utils/getLogsMemoryBudget';
import { ResponseSizeBudget } from '../../../../src/relay/lib/utils/responseSizeBudget';

const BUSY_MESSAGE = 'eth_getLogs memory limit reached on the relay, try again later';

function errorOf(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }

  return undefined;
}

function expectBusyError(error: unknown): void {
  expect((error as JsonRpcError).code).to.equal(-32005);
  expect((error as JsonRpcError).message).to.equal(BUSY_MESSAGE);
  expect(ResponseSizeBudget.isExceededError(error)).to.be.true;
}

describe('GetLogsMemoryBudget', () => {
  it('counts the bytes of several shares toward one total', () => {
    const budget = new GetLogsMemoryBudget(100);
    const first = budget.open();
    const second = budget.open();

    first.consume(30);
    second.consume(20);
    first.consume(10);

    expect(first.heldBytes).to.equal(40);
    expect(second.heldBytes).to.equal(20);
    expect(budget.usedBytes).to.equal(60);
  });

  it('accepts bytes up to exactly the limit', () => {
    const budget = new GetLogsMemoryBudget(100);

    budget.open().consume(60);
    budget.open().consume(40);

    expect(budget.usedBytes).to.equal(100);
  });

  it('refuses bytes that would go over the limit with a budget error and does not count them', () => {
    const budget = new GetLogsMemoryBudget(100);
    const first = budget.open();
    const second = budget.open();
    first.consume(60);

    const error = errorOf(() => second.consume(41));

    expectBusyError(error);
    expect(second.heldBytes).to.equal(0);
    expect(budget.usedBytes).to.equal(60);
  });

  it('builds a new error for every refusal', () => {
    const budget = new GetLogsMemoryBudget(10);
    const share = budget.open();

    const first = errorOf(() => share.consume(11));
    const second = errorOf(() => share.consume(1));

    expectBusyError(first);
    expectBusyError(second);
    expect(first).to.not.equal(second);
    expect(ResponseSizeBudget.isExceededError(predefined.GET_LOGS_RELAY_BUSY())).to.be.false;
  });

  it('stays refused once refused, even for bytes that would fit', () => {
    const budget = new GetLogsMemoryBudget(100);
    const share = budget.open();

    expect(share.isExceeded).to.be.false;
    expect(share.exceededError()).to.be.undefined;
    expect(() => share.assertNotExceeded()).to.not.throw();

    expectBusyError(errorOf(() => share.consume(101)));

    expect(share.isExceeded).to.be.true;
    expectBusyError(share.exceededError());
    expectBusyError(errorOf(() => share.assertNotExceeded()));
    expectBusyError(errorOf(() => share.consume(1)));
    expect(budget.usedBytes).to.equal(0);
  });

  it('gives back part of the bytes on release, never more than the share holds', () => {
    const budget = new GetLogsMemoryBudget(100);
    const first = budget.open();
    const second = budget.open();
    first.consume(40);
    second.consume(30);

    first.release(15);

    expect(first.heldBytes).to.equal(25);
    expect(budget.usedBytes).to.equal(55);

    first.release(1000);

    expect(first.heldBytes).to.equal(0);
    expect(second.heldBytes).to.equal(30);
    expect(budget.usedBytes).to.equal(30);
  });

  it('gives back all bytes of the share on close, only once', () => {
    const budget = new GetLogsMemoryBudget(100);
    const first = budget.open();
    const second = budget.open();
    first.consume(40);
    second.consume(30);

    first.close();
    first.close();

    expect(first.heldBytes).to.equal(0);
    expect(budget.usedBytes).to.equal(30);
  });

  it('lets a new share fit after another one was closed', () => {
    const budget = new GetLogsMemoryBudget(100);
    const first = budget.open();
    first.consume(80);

    expectBusyError(errorOf(() => budget.open().consume(30)));

    first.close();
    budget.open().consume(30);

    expect(budget.usedBytes).to.equal(30);
  });

  it('does not count a page that arrives after its share was closed', () => {
    const budget = new GetLogsMemoryBudget(100);
    const share = budget.open();
    share.consume(40);
    share.close();

    expectBusyError(errorOf(() => share.consume(10)));
    share.release(10);

    expect(share.isExceeded).to.be.true;
    expect(share.heldBytes).to.equal(0);
    expect(budget.usedBytes).to.equal(0);
  });

  it('rejects byte counts that are negative or not whole numbers', () => {
    const budget = new GetLogsMemoryBudget(100);
    const share = budget.open();

    for (const bytes of [-1, 1.5, NaN, Infinity]) {
      expect(() => share.consume(bytes)).to.throw(`Invalid byte count: ${bytes}`);
      expect(() => share.release(bytes)).to.throw(`Invalid byte count: ${bytes}`);
    }

    expect(share.heldBytes).to.equal(0);
    expect(budget.usedBytes).to.equal(0);
  });

  describe('as the parent of a call budget', () => {
    const callError = (): JsonRpcError => predefined.LOGS_RESPONSE_SIZE_EXCEEDED(1000);

    it('counts the pages of the call in the relay total and gives back the bytes of a retried attempt', () => {
      const budget = new GetLogsMemoryBudget(100);
      const share = budget.open();
      const call = new ResponseSizeBudget(1000, callError, share);

      call.consume(30);
      call.consume(20);
      call.release(20);

      expect(share.heldBytes).to.equal(30);
      expect(budget.usedBytes).to.equal(30);
    });

    it('fails the call with the relay error once the relay total is full', () => {
      const budget = new GetLogsMemoryBudget(100);
      budget.open().consume(60);
      const share = budget.open();
      const call = new ResponseSizeBudget(1000, callError, share);
      call.consume(30);

      const error = errorOf(() => call.consume(20));

      expectBusyError(error);
      expect(call.isExceeded).to.be.true;
      expectBusyError(call.exceededError());
      expectBusyError(errorOf(() => call.assertNotExceeded()));
      expect(budget.usedBytes).to.equal(90);
    });

    it('fails every call of the request once one of them is refused', () => {
      const budget = new GetLogsMemoryBudget(100);
      const share = budget.open();
      const first = new ResponseSizeBudget(1000, callError, share);
      const second = new ResponseSizeBudget(1000, callError, share);
      first.consume(50);

      expectBusyError(errorOf(() => second.consume(60)));

      expect(first.isExceeded).to.be.true;
      expectBusyError(errorOf(() => first.consume(1)));
    });
  });
});
