// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import * as sinon from 'sinon';

import { JsonRpcError, MirrorNodeClientError, predefined } from '../../../../../src/relay';
import { type ICacheClient } from '../../../../../src/relay/lib/clients/cache/ICacheClient';
import { type MirrorNodeClient } from '../../../../../src/relay/lib/clients/mirrorNodeClient';
import { resetWorkerContext } from '../../../../../src/relay/lib/services/workersService/workerContext';
import { WorkersPool } from '../../../../../src/relay/lib/services/workersService/WorkersPool';
import { type RequestDetails } from '../../../../../src/relay/lib/types';
import { overrideEnvsInMochaDescribe } from '../../../helpers';

/** Minimal Piscina-shaped stub sufficient to exercise WorkersPool.run() without spawning threads. */
interface PiscinaStub {
  run: sinon.SinonStub;
  histogram: { waitTime: { average: number } };
  utilization: number;
  threads: object[];
  queueSize: number;
}

function makePiscinaStub(resolveWith?: unknown, rejectWith?: Error): PiscinaStub {
  return {
    run: rejectWith ? sinon.stub().rejects(rejectWith) : sinon.stub().resolves(resolveWith),
    histogram: { waitTime: { average: 0.05 } },
    utilization: 0.5,
    threads: [{}, {}],
    queueSize: 1,
  };
}

interface WorkersPoolInternals {
  instance: PiscinaStub | undefined;
  mirrorNodeClient: MirrorNodeClient | undefined;
  cacheService: ICacheClient | undefined;
}

const pool = WorkersPool as unknown as WorkersPoolInternals;

const noMirrorNodeClient = null as unknown as MirrorNodeClient;
const noCacheService = null as unknown as ICacheClient;

describe('WorkersPool Test Suite', () => {
  beforeEach(() => {
    // Reset all static state before each test to prevent cross-test contamination.
    WorkersPool['handleTaskFn'] = null;
    resetWorkerContext();
    pool.instance = undefined;
    pool.mirrorNodeClient = undefined;
    pool.cacheService = undefined;
  });

  // ---------------------------------------------------------------------------
  // Local execution mode: WORKERS_POOL_ENABLED=false (default)
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
        requestDetails: {} as RequestDetails,
        chain: '0x127',
      };

      const result = await WorkersPool.run(task, noMirrorNodeClient, noCacheService);

      expect(handleTaskStub.calledOnce).to.be.true;
      expect(handleTaskStub.calledWith(task, sinon.match.any)).to.be.true;
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
        requestDetails: {} as RequestDetails,
      };

      let thrown: unknown;
      try {
        await WorkersPool.run(task, noMirrorNodeClient, noCacheService);
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
        requestDetails: {} as RequestDetails,
        chain: '0x127',
      };

      await WorkersPool.run(task, noMirrorNodeClient, noCacheService);
      await WorkersPool.run(task, noMirrorNodeClient, noCacheService);

      expect(WorkersPool['handleTaskFn']).to.equal(handleTaskStub);
      expect(handleTaskStub.callCount).to.equal(2);
    });

    it('should not assign mirrorNodeClient or cacheService when bypassing the pool', async () => {
      WorkersPool['handleTaskFn'] = sinon.stub().resolves(null);

      const task = {
        type: 'getRawReceipts' as const,
        blockHashOrBlockNumber: '0x1',
        requestDetails: {} as RequestDetails,
      };
      const fakeClient = { label: 'mc' } as unknown as MirrorNodeClient;
      const fakeCacheService = { label: 'cs' } as unknown as ICacheClient;

      await WorkersPool.run(task, fakeClient, fakeCacheService);

      // In local mode the static client/cache fields must remain untouched — the
      // passed client/cache are reused to build the
      // local worker context instead.
      expect(pool.mirrorNodeClient).to.be.undefined;
      expect(pool.cacheService).to.be.undefined;
    });

    it('should reuse the relay-provided client and services with no duplicate instances', async () => {
      const handleTaskStub = sinon.stub().resolves(null);
      WorkersPool['handleTaskFn'] = handleTaskStub;

      const fakeClient = { label: 'relay-client' } as unknown as MirrorNodeClient;
      const fakeCacheService = { label: 'relay-cache' } as unknown as ICacheClient;
      const task = {
        type: 'getRawReceipts' as const,
        blockHashOrBlockNumber: '0x1',
        requestDetails: {} as RequestDetails,
      };

      await WorkersPool.run(task, fakeClient, fakeCacheService);

      // The context handed to the handler must reuse the exact client/cache passed to run() —
      // proving local mode opens no new MirrorNodeClient (and no new socket pools) on the main thread.
      const ctx = handleTaskStub.firstCall.args[1];
      expect(ctx.mirrorNodeClient).to.equal(fakeClient);
      expect(ctx.cacheService).to.equal(fakeCacheService);
    });
  });

  // ---------------------------------------------------------------------------
  // Pool execution mode: WORKERS_POOL_ENABLED=true
  // ---------------------------------------------------------------------------
  describe('run() — pool execution mode (WORKERS_POOL_ENABLED=true)', () => {
    overrideEnvsInMochaDescribe({ WORKERS_POOL_ENABLED: true });

    it('should dispatch the task to the Piscina pool and return its result', async () => {
      const expectedResult = { logs: [] };
      pool.instance = makePiscinaStub(expectedResult);

      const task = {
        type: 'getLogs' as const,
        blockHash: null,
        fromBlock: 'latest',
        toBlock: 'latest',
        address: null,
        topics: null,
        requestDetails: {} as RequestDetails,
      };

      const result = await WorkersPool.run(task, noMirrorNodeClient, noCacheService);

      expect(pool.instance!.run.calledOnce).to.be.true;
      expect(pool.instance!.run.calledWith(task)).to.be.true;
      expect(result).to.equal(expectedResult);
    });

    it('should store mirrorNodeClient and cacheService for inter-thread metric forwarding', async () => {
      pool.instance = makePiscinaStub(null);

      const fakeClient = { label: 'mirrorNode' } as unknown as MirrorNodeClient;
      const fakeCacheService = { label: 'cache' } as unknown as ICacheClient;

      await WorkersPool.run(
        { type: 'getRawReceipts' as const, blockHashOrBlockNumber: '0x1', requestDetails: {} as RequestDetails },
        fakeClient,
        fakeCacheService,
      );

      expect(pool.mirrorNodeClient).to.equal(fakeClient);
      expect(pool.cacheService).to.equal(fakeCacheService);
    });

    it('should unwrap and rethrow a serialised JsonRpcError propagated from a Piscina worker', async () => {
      const envelope = { name: 'JsonRpcError', code: -32603, message: 'internal error', data: 'context' };
      pool.instance = makePiscinaStub(undefined, new Error(JSON.stringify(envelope)));

      const task = {
        type: 'getBlock' as const,
        blockHashOrNumber: '0x1',
        showDetails: false,
        requestDetails: {} as RequestDetails,
        chain: '0x127',
      };

      let thrown: unknown;
      try {
        await WorkersPool.run(task, noMirrorNodeClient, noCacheService);
      } catch (e) {
        thrown = e;
      }

      expect(thrown).to.be.instanceOf(JsonRpcError);
      expect((thrown as JsonRpcError).code).to.equal(-32603);
      expect((thrown as JsonRpcError).message).to.equal('internal error');
    });

    it('should unwrap and rethrow a serialised MirrorNodeClientError propagated from a Piscina worker', async () => {
      const envelope = { name: 'MirrorNodeClientError', statusCode: 404, message: 'not found', data: 'detail' };
      pool.instance = makePiscinaStub(undefined, new Error(JSON.stringify(envelope)));

      const task = {
        type: 'getBlockReceipts' as const,
        blockHashOrBlockNumber: '0x1',
        requestDetails: {} as RequestDetails,
      };

      let thrown: unknown;
      try {
        await WorkersPool.run(task, noMirrorNodeClient, noCacheService);
      } catch (e) {
        thrown = e;
      }

      expect(thrown).to.be.instanceOf(MirrorNodeClientError);
      expect((thrown as MirrorNodeClientError).statusCode).to.equal(404);
    });

    it('should rethrow INTERNAL_ERROR for an unrecognised error from a Piscina worker', async () => {
      const envelope = { name: 'SomeOtherError', message: 'unexpected' };
      pool.instance = makePiscinaStub(undefined, new Error(JSON.stringify(envelope)));

      const task = {
        type: 'getLogs' as const,
        blockHash: null,
        fromBlock: 'latest',
        toBlock: 'latest',
        address: null,
        topics: null,
        requestDetails: {} as RequestDetails,
      };

      let thrown: unknown;
      try {
        await WorkersPool.run(task, noMirrorNodeClient, noCacheService);
      } catch (e) {
        thrown = e;
      }

      expect(thrown).to.be.instanceOf(JsonRpcError);
      // predefined.INTERNAL_ERROR uses code -32603 (JSON-RPC internal error)
      expect((thrown as JsonRpcError).code).to.equal(predefined.INTERNAL_ERROR().code);
    });

    it('should not initialise a new Piscina instance when one is already set', async () => {
      const stub = makePiscinaStub({ result: 'ok' });
      pool.instance = stub;

      const task = {
        type: 'getBlock' as const,
        blockHashOrNumber: '0x3',
        showDetails: false,
        requestDetails: {} as RequestDetails,
        chain: '0x127',
      };

      await WorkersPool.run(task, noMirrorNodeClient, noCacheService);

      // getInstance() must return the pre-set stub, not create a new Piscina pool.
      expect(WorkersPool['instance']).to.equal(stub);
    });
  });
});
