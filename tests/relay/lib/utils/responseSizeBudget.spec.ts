// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { type JsonRpcError, predefined } from '../../../../src/relay';
import { type MirrorNodeContractLog } from '../../../../src/relay/lib/types';
import {
  estimateLogsResponseSize,
  markAsBudgetError,
  ResponseSizeBudget,
  type ResponseSizeBudgetParent,
} from '../../../../src/relay/lib/utils/responseSizeBudget';

describe('ResponseSizeBudget', function () {
  const error = (): JsonRpcError => predefined.LOGS_RESPONSE_SIZE_EXCEEDED(100);

  it('should allow consuming up to the limit and throw once it is exceeded', function () {
    const budget = new ResponseSizeBudget(100, error);
    budget.consume(60);
    budget.consume(40);
    expect(budget.isExceeded).to.be.false;

    let thrown: unknown;
    try {
      budget.consume(1);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).to.deep.equal(error());
    expect(ResponseSizeBudget.isExceededError(thrown)).to.be.true;
    expect(budget.isExceeded).to.be.true;
  });

  it('should not recognize unrelated errors as budget errors', function () {
    expect(ResponseSizeBudget.isExceededError(error())).to.be.false;
    expect(ResponseSizeBudget.isExceededError(new Error('x'))).to.be.false;
    expect(ResponseSizeBudget.isExceededError(null)).to.be.false;
  });

  it('should recognize errors marked with markAsBudgetError', function () {
    const marked = markAsBudgetError(error());

    expect(ResponseSizeBudget.isExceededError(marked)).to.be.true;
  });

  it('should charge the parent and fail every child once the parent is exceeded', function () {
    const parent = new ResponseSizeBudget(100, () => predefined.MIRROR_NODE_RESPONSE_SIZE_EXCEEDED(100));
    const first = new ResponseSizeBudget(Infinity, error, parent);
    const second = new ResponseSizeBudget(Infinity, error, parent);

    first.consume(70);
    expect(() => second.consume(31)).to.throw(predefined.MIRROR_NODE_RESPONSE_SIZE_EXCEEDED(100).message);
    expect(parent.usedBytes).to.equal(101);
    expect(first.isExceeded).to.be.true;
    expect(() => first.assertNotExceeded()).to.throw(predefined.MIRROR_NODE_RESPONSE_SIZE_EXCEEDED(100).message);
  });

  it('should throw its own error before charging the parent when its own limit is exceeded', function () {
    const parent = new ResponseSizeBudget(1000, () => predefined.MIRROR_NODE_RESPONSE_SIZE_EXCEEDED(1000));
    const child = new ResponseSizeBudget(100, error, parent);

    expect(() => child.consume(101)).to.throw(error().message);
    expect(parent.usedBytes).to.equal(0);
  });

  it('should return released bytes to the parent and stay exceeded once exceeded', function () {
    const parent = new ResponseSizeBudget(100, error);
    const child = new ResponseSizeBudget(Infinity, error, parent);

    child.consume(80);
    child.release(50);
    expect(child.usedBytes).to.equal(30);
    expect(parent.usedBytes).to.equal(30);

    expect(() => child.consume(80)).to.throw();
    child.release(80);
    expect(parent.isExceeded).to.be.true;
  });

  it('should call onExceeded once, when the budget is first exceeded', function () {
    let calls = 0;
    const budget = new ResponseSizeBudget(100, error, undefined, () => calls++);

    budget.consume(100);
    expect(calls).to.equal(0);
    expect(() => budget.consume(1)).to.throw();
    expect(() => budget.consume(1)).to.throw();
    expect(() => budget.assertNotExceeded()).to.throw();
    expect(calls).to.equal(1);
  });

  it('should build the error of the exceeded budget, its own or the nearest exceeded parent', function () {
    const parentError = (): JsonRpcError => predefined.MIRROR_NODE_RESPONSE_SIZE_EXCEEDED(100);
    const parent = new ResponseSizeBudget(100, parentError);
    const child = new ResponseSizeBudget(1000, error, parent);
    expect(child.exceededError()).to.be.undefined;

    expect(() => child.consume(101)).to.throw();
    expect(child.exceededError()).to.deep.equal(parentError());
    expect(ResponseSizeBudget.isExceededError(child.exceededError())).to.be.true;

    const own = new ResponseSizeBudget(10, error);
    expect(() => own.consume(11)).to.throw();
    expect(own.exceededError()).to.deep.equal(error());
  });

  it('should accept a parent that is not a ResponseSizeBudget', function () {
    const parentError = markAsBudgetError(predefined.MIRROR_NODE_RESPONSE_SIZE_EXCEEDED(50));
    const calls: string[] = [];
    let parentExceeded = false;
    const parent: ResponseSizeBudgetParent = {
      get isExceeded() {
        return parentExceeded;
      },
      exceededError: () => (parentExceeded ? parentError : undefined),
      consume: (bytes) => {
        calls.push(`consume ${bytes}`);
        if (bytes > 50) {
          parentExceeded = true;
          throw parentError;
        }
      },
      release: (bytes) => calls.push(`release ${bytes}`),
      assertNotExceeded: () => {
        if (parentExceeded) throw parentError;
      },
    };
    const budget = new ResponseSizeBudget(Infinity, error, parent);

    budget.consume(30);
    budget.release(10);

    expect(calls).to.deep.equal(['consume 30', 'release 10']);
    expect(budget.isExceeded).to.be.false;

    expect(() => budget.consume(60))
      .to.throw()
      .that.equals(parentError);
    expect(budget.isExceeded).to.be.true;
    expect(budget.exceededError()).to.equal(parentError);
    expect(() => budget.assertNotExceeded())
      .to.throw()
      .that.equals(parentError);
  });

  it('should estimate the JSON-RPC size of logs from their data and topics', function () {
    const log = (data: string, topics: number): MirrorNodeContractLog =>
      ({ data, topics: Array(topics).fill('0x' + 'a'.repeat(64)) }) as unknown as MirrorNodeContractLog;

    // an ERC20 Transfer: 3 topics and 32 bytes of data, ~635 bytes once serialized (incl. the separating comma)
    expect(estimateLogsResponseSize([log('0x' + '0'.repeat(64), 3)])).to.equal(636);
    expect(estimateLogsResponseSize([log('0x', 0), log('0x', 0)])).to.equal(730);
    expect(estimateLogsResponseSize([])).to.equal(0);
  });

  it('should estimate a log without data or topics as empty data and no topics', function () {
    const bare = {} as unknown as MirrorNodeContractLog;

    // the same as a log with data '0x' and no topics
    expect(estimateLogsResponseSize([bare])).to.equal(365);
  });
});
