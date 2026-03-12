// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import * as sinon from 'sinon';

import { JsonRpcError, MirrorNodeClientError, predefined } from '../../../../dist';
import { WorkersPool } from '../../../../dist/lib/services/workersService/WorkersPool';
import { overrideEnvsInMochaDescribe } from '../../../helpers';

/** Minimal Piscina-shaped stub sufficient to exercise WorkersPool.run() without spawning threads. */
function makePiscinaStub(resolveWith?: unknown, rejectWith?: Error) {
  return {
    run: rejectWith ? sinon.stub().rejects(rejectWith) : sinon.stub().resolves(resolveWith),
    histogram: { waitTime: { average: 0.05 } },
    utilization: 0.5,
    threads: [{}, {}],
    queueSize: 1,
  };
}

describe('WorkersPool Test Suite', () => {
  afterEach(() => {
    // Reset all static state between tests to prevent cross-test contamination.
    WorkersPool['handleTaskFn'] = null;
    WorkersPool['instance'] = undefined as any;
    (WorkersPool as any)['mirrorNodeClient'] = undefined;
    (WorkersPool as any)['cacheService'] = undefined;
  });

  // ---------------------------------------------------------------------------
  // Local execution mode: WORKERS_POOL_ENABLED=false
  // ---------------------------------------------------------------------------
  describe('run() — local execution mode (WORKERS_POOL_ENABLED=false)', () => {
    overrideEnvsInMochaDescribe({ WORKERS_POOL_ENABLED: false });

    it('should invoke the task handler directly without initialising the Piscina pool', async () => {
      const expectedResult = { hash: '0xdeadbeef' };
      const handleTaskStub = sinon.stub().resolves(expectedResult);
      WorkersPool['handleTaskFn'] = handleTaskStub;

      const task = {
        type: 'getBlock' as const,
        blockHashOrNumber: '0x1',
        showDetails: false,
        requestDetails: {} as any,
        chain: '0x127',
      };

      const result = await WorkersPool.run(task, null as any, null as any);

      expect(handleTaskStub.calledOnce).to.be.true;
      expect(handleTaskStub.calledWith(task)).to.be.true;
      expect(result).to.equal(expectedResult);
      expect(WorkersPool['instance']).to.be.undefined;
    });

    it('should propagate task errors natively without serialization or reconstruction', async () => {
      const originalError = new Error('task failed on main thread');
      WorkersPool['handleTaskFn'] = sinon.stub().rejects(originalError);

      const task = {
        type: 'getLogs' as const,
        blockHash: null,
        fromBlock: 'latest',
        toBlock: 'latest',
        address: null,
        topics: null,
        requestDetails: {} as any,
      };

      let thrown: unknown;
      try {
        await WorkersPool.run(task, null as any, null as any);
      } catch (e) {
        thrown = e;
      }

      // Must be the exact same reference — no wrapping or reconstruction.
      expect(thrown).to.equal(originalError);
    });

    it('should cache the handler function after the first invocation', async () => {
      const handleTaskStub = sinon.stub().resolves('ok');
      WorkersPool['handleTaskFn'] = handleTaskStub;

      const task = {
        type: 'getBlock' as const,
        blockHashOrNumber: '0x2',
        showDetails: true,
        requestDetails: {} as any,
        chain: '0x127',
      };

      await WorkersPool.run(task, null as any, null as any);
      await WorkersPool.run(task, null as any, null as any);

      expect(WorkersPool['handleTaskFn']).to.equal(handleTaskStub);
      expect(handleTaskStub.callCount).to.equal(2);
    });

    it('should not assign mirrorNodeClient or cacheService when bypassing the pool', async () => {
      WorkersPool['handleTaskFn'] = sinon.stub().resolves(null);

      const task = {
        type: 'getRawReceipts' as const,
        blockHashOrBlockNumber: '0x1',
        requestDetails: {} as any,
      };
      const fakeClient = { label: 'mc' } as any;
      const fakeCacheService = { label: 'cs' } as any;

      await WorkersPool.run(task, fakeClient, fakeCacheService);

      // In local mode the static client/cache fields must remain untouched — the
      // worker modules maintain their own module-level singletons.
      expect((WorkersPool as any)['mirrorNodeClient']).to.be.undefined;
      expect((WorkersPool as any)['cacheService']).to.be.undefined;
    });
  });

  // ---------------------------------------------------------------------------
  // Pool execution mode: WORKERS_POOL_ENABLED=true (default)
  // ---------------------------------------------------------------------------
  describe('run() — pool execution mode (WORKERS_POOL_ENABLED=true)', () => {
    overrideEnvsInMochaDescribe({ WORKERS_POOL_ENABLED: true });

    it('should dispatch the task to the Piscina pool and return its result', async () => {
      const expectedResult = { logs: [] };
      WorkersPool['instance'] = makePiscinaStub(expectedResult) as any;

      const task = {
        type: 'getLogs' as const,
        blockHash: null,
        fromBlock: 'latest',
        toBlock: 'latest',
        address: null,
        topics: null,
        requestDetails: {} as any,
      };

      const result = await WorkersPool.run(task, null as any, null as any);

      expect((WorkersPool['instance'] as any).run.calledOnce).to.be.true;
      expect((WorkersPool['instance'] as any).run.calledWith(task)).to.be.true;
      expect(result).to.equal(expectedResult);
    });

    it('should store mirrorNodeClient and cacheService for inter-thread metric forwarding', async () => {
      WorkersPool['instance'] = makePiscinaStub(null) as any;

      const fakeClient = { label: 'mirrorNode' } as any;
      const fakeCacheService = { label: 'cache' } as any;

      await WorkersPool.run(
        { type: 'getRawReceipts' as const, blockHashOrBlockNumber: '0x1', requestDetails: {} as any },
        fakeClient,
        fakeCacheService,
      );

      expect((WorkersPool as any)['mirrorNodeClient']).to.equal(fakeClient);
      expect((WorkersPool as any)['cacheService']).to.equal(fakeCacheService);
    });

    it('should unwrap and rethrow a serialised JsonRpcError propagated from a Piscina worker', async () => {
      const envelope = { name: 'JsonRpcError', code: -32603, message: 'internal error', data: 'context' };
      WorkersPool['instance'] = makePiscinaStub(undefined, new Error(JSON.stringify(envelope))) as any;

      const task = {
        type: 'getBlock' as const,
        blockHashOrNumber: '0x1',
        showDetails: false,
        requestDetails: {} as any,
        chain: '0x127',
      };

      let thrown: unknown;
      try {
        await WorkersPool.run(task, null as any, null as any);
      } catch (e) {
        thrown = e;
      }

      expect(thrown).to.be.instanceOf(JsonRpcError);
      expect((thrown as JsonRpcError).code).to.equal(-32603);
      expect((thrown as JsonRpcError).message).to.equal('internal error');
    });

    it('should unwrap and rethrow a serialised MirrorNodeClientError propagated from a Piscina worker', async () => {
      const envelope = { name: 'MirrorNodeClientError', statusCode: 404, message: 'not found', data: 'detail' };
      WorkersPool['instance'] = makePiscinaStub(undefined, new Error(JSON.stringify(envelope))) as any;

      const task = {
        type: 'getBlockReceipts' as const,
        blockHashOrBlockNumber: '0x1',
        requestDetails: {} as any,
      };

      let thrown: unknown;
      try {
        await WorkersPool.run(task, null as any, null as any);
      } catch (e) {
        thrown = e;
      }

      expect(thrown).to.be.instanceOf(MirrorNodeClientError);
      expect((thrown as MirrorNodeClientError).statusCode).to.equal(404);
    });

    it('should rethrow INTERNAL_ERROR for an unrecognised error from a Piscina worker', async () => {
      const envelope = { name: 'SomeOtherError', message: 'unexpected' };
      WorkersPool['instance'] = makePiscinaStub(undefined, new Error(JSON.stringify(envelope))) as any;

      const task = {
        type: 'getLogs' as const,
        blockHash: null,
        fromBlock: 'latest',
        toBlock: 'latest',
        address: null,
        topics: null,
        requestDetails: {} as any,
      };

      let thrown: unknown;
      try {
        await WorkersPool.run(task, null as any, null as any);
      } catch (e) {
        thrown = e;
      }

      expect(thrown).to.be.instanceOf(JsonRpcError);
      // predefined.INTERNAL_ERROR uses code -32603 (JSON-RPC internal error)
      expect((thrown as JsonRpcError).code).to.equal(predefined.INTERNAL_ERROR().code);
    });

    it('should not initialise a new Piscina instance when one is already set', async () => {
      const stub = makePiscinaStub({ result: 'ok' });
      WorkersPool['instance'] = stub as any;

      const task = {
        type: 'getBlock' as const,
        blockHashOrNumber: '0x3',
        showDetails: false,
        requestDetails: {} as any,
        chain: '0x127',
      };

      await WorkersPool.run(task, null as any, null as any);

      // getInstance() must return the pre-set stub, not create a new Piscina pool.
      expect(WorkersPool['instance']).to.equal(stub);
    });
  });
});
