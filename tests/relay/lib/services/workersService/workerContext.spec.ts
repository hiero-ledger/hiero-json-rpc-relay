// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { Gauge } from 'prom-client';

import { MirrorNodeClient } from '../../../../../src/relay/lib/clients/mirrorNodeClient';
import { RegistryFactory } from '../../../../../src/relay/lib/factories/registryFactory';
import { AccountService } from '../../../../../src/relay/lib/services/ethService/accountService/AccountService';
import { CommonService } from '../../../../../src/relay/lib/services/ethService/ethCommonService/CommonService';
import {
  createWorkerContext,
  getWorkerContext,
  resetWorkerContext,
} from '../../../../../src/relay/lib/services/workersService/workerContext';
import { overrideEnvsInMochaDescribe } from '../../../helpers';

describe('WorkerContext Test Suite', () => {
  describe('createWorkerContext', () => {
    overrideEnvsInMochaDescribe({ MIRROR_NODE_URL: 'http://localhost:5551' });

    it('should reuse the supplied client + cache and wire the wrapper services around them', () => {
      const mirrorNodeClient = { label: 'relay-client' } as any;
      const cacheService = { label: 'relay-cache' } as any;

      const ctx = createWorkerContext(mirrorNodeClient, cacheService);

      expect(ctx.mirrorNodeClient).to.equal(mirrorNodeClient);
      expect(ctx.cacheService).to.equal(cacheService);
      expect(ctx.commonService).to.be.instanceOf(CommonService);
      expect(ctx.accountService).to.be.instanceOf(AccountService);
    });

    it('should pass a new Registry instance to txpool service so it never clobbers the shared registry', () => {
      const registry = RegistryFactory.getInstance(true);
      const sentinel = new Gauge({ name: 'rpc_relay_txpool_pending_count', help: 'sentinel', registers: [registry] });

      createWorkerContext({} as any, {} as any);

      expect(registry.getSingleMetric('rpc_relay_txpool_pending_count')).to.equal(sentinel);
      for (const name of [
        'rpc_relay_txpool_operations_total',
        'rpc_relay_txpool_storage_errors_total',
        'rpc_relay_txpool_active_addresses',
      ]) {
        expect(registry.getSingleMetric(name), `${name} must not be on the shared registry`).to.be.undefined;
      }
    });

    it('should build its own single client and wire the services around it when given no arguments', () => {
      const ctx = createWorkerContext();

      expect(ctx.mirrorNodeClient).to.be.instanceOf(MirrorNodeClient);
      expect(ctx.commonService).to.be.instanceOf(CommonService);
      expect(ctx.accountService).to.be.instanceOf(AccountService);
    });
  });

  describe('getWorkerContext — single shared per-thread cache', () => {
    afterEach(() => resetWorkerContext());

    it('should build the context once and return the same instance on subsequent calls', () => {
      const first = getWorkerContext({ label: 'client' } as any, { label: 'cache' } as any);
      const second = getWorkerContext();

      // Args on the second call are ignored — the first-built context is returned verbatim.
      expect(second).to.equal(first);
    });
  });
});
