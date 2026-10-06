// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import pino from 'pino';
import sinon from 'sinon';

import { JsonRpcError } from '../../../../src/relay';
import { RpcMethodDispatcher } from '../../../../src/relay/lib/dispatcher/rpcMethodDispatcher';
import { registerRpcMethods } from '../../../../src/relay/lib/services/registryService/rpcMethodRegistryService';
import { WorkersPool } from '../../../../src/relay/lib/services/workersService/WorkersPool';
import { RequestDetails } from '../../../../src/relay/lib/types';
import { mockWorkersPool, overrideEnvsInMochaDescribe } from '../../helpers';
import { CONTRACT_ADDRESS_1, DEFAULT_CONTRACT, DEFAULT_NETWORK_FEES, MOCK_BALANCE_RES } from './eth-config';
import { generateEthTestEnv } from './eth-helpers';

/**
 * EIP-1898 block identifier objects, exercised end to end through the RPC dispatcher: validation, the parameter
 * layout that normalizes the object, the `@cache` decorator, and the services underneath.
 */
describe('@ethBlockParamObject EIP-1898 block identifier objects', async function () {
  this.timeout(10000);

  const { restMock, web3Mock, ethImpl, cacheService, commonService, mirrorNodeInstance, transactionPoolService } =
    generateEthTestEnv();
  const dispatcher = new RpcMethodDispatcher(
    registerRpcMethods([{ namespace: 'eth', serviceImpl: ethImpl }]),
    pino({ level: 'silent' }),
  );

  const ADDRESS = CONTRACT_ADDRESS_1;
  const ENTITY_NUM = parseInt(ADDRESS, 16);
  const BLOCK_NUMBER = 100;
  const BLOCK_NUMBER_HEX = '0x64';
  const BLOCK_HASH = '0x' + 'b1'.repeat(32);
  const UNKNOWN_HASH = '0x' + '11'.repeat(32);
  const BLOCK = {
    number: BLOCK_NUMBER,
    hash: BLOCK_HASH,
    timestamp: { from: '1718000099.000000000', to: '1718000100.000000000' },
  };
  const NONCE = 7;
  const STORAGE_VALUE = '0x' + '00'.repeat(31) + '2a';
  const CALL_RESULT = '0xcafe';
  const NOT_FOUND = { _status: { messages: [{ message: 'Not found' }] } };
  const UNKNOWN_BLOCK_CALL = { _status: { messages: [{ message: 'Bad Request', detail: 'Unknown block number' }] } };

  const METHODS: Record<string, (blockParam: unknown) => unknown[]> = {
    eth_getBalance: (blockParam) => [ADDRESS, blockParam],
    eth_getCode: (blockParam) => [ADDRESS, blockParam],
    eth_getTransactionCount: (blockParam) => [ADDRESS, blockParam],
    eth_getStorageAt: (blockParam) => [ADDRESS, '0x0', blockParam],
    eth_call: (blockParam) => [{ to: ADDRESS, data: '0x' }, blockParam],
  };

  const dispatch = (method: string, blockParam: unknown): Promise<unknown> =>
    dispatcher.dispatch(
      method,
      METHODS[method](blockParam),
      new RequestDetails({ requestId: 'eth_blockParamObjectTest', ipAddress: '0.0.0.0' }),
    );

  const mirrorNodeRequests = (): string[] => [
    ...restMock.history.get.map((request) => `GET ${request.url}`),
    ...web3Mock.history.post.map((request) => `POST ${request.url} ${request.data}`),
  ];

  const resetMirrorNodeHistory = (): void => {
    restMock.resetHistory();
    web3Mock.resetHistory();
  };

  const mockAccount = (balance: number): void => {
    restMock
      .onGet(`accounts/${ADDRESS}?transactions=false`)
      .reply(
        200,
        JSON.stringify({ ...MOCK_BALANCE_RES, evm_address: ADDRESS, ethereum_nonce: NONCE, balance: { balance } }),
      );
  };

  const mockContractCall = (result: string): void => {
    web3Mock.onPost('contracts/call').reply((config) => {
      return JSON.parse(config.data).block === UNKNOWN_HASH
        ? [400, JSON.stringify(UNKNOWN_BLOCK_CALL)]
        : [200, JSON.stringify({ result })];
    });
  };

  overrideEnvsInMochaDescribe({ ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE: 1 });

  before(async () => {
    await mockWorkersPool(mirrorNodeInstance, commonService, cacheService);
  });

  beforeEach(async () => {
    await cacheService.clear();
    restMock.reset();
    web3Mock.reset();

    restMock.onGet('network/fees').reply(200, JSON.stringify(DEFAULT_NETWORK_FEES));
    restMock.onGet('blocks?limit=1&order=desc').reply(200, JSON.stringify({ blocks: [BLOCK] }));
    restMock.onGet(`blocks/${BLOCK_NUMBER}`).reply(200, JSON.stringify(BLOCK));
    restMock.onGet(`blocks/${BLOCK_HASH}`).reply(200, JSON.stringify(BLOCK));
    restMock.onGet(`blocks/${UNKNOWN_HASH}`).reply(404, JSON.stringify(NOT_FOUND));
    mockAccount(MOCK_BALANCE_RES.balance.balance);
    restMock.onGet(`accounts/${ADDRESS}?limit=100`).reply(404, JSON.stringify(NOT_FOUND));
    restMock.onGet(`tokens/0.0.${ENTITY_NUM}`).reply(404, JSON.stringify(NOT_FOUND));
    restMock.onGet(`schedules/0.0.${ENTITY_NUM}`).reply(404, JSON.stringify(NOT_FOUND));
    restMock.onGet(`contracts/${ADDRESS}`).reply(200, JSON.stringify(DEFAULT_CONTRACT));
    restMock
      .onGet(new RegExp(`^contracts/${ADDRESS}/state\\?`))
      .reply(200, JSON.stringify({ state: [{ address: ADDRESS, slot: '0x0', value: STORAGE_VALUE }] }));
    mockContractCall(CALL_RESULT);
  });

  afterEach(() => {
    sinon.restore();
    restMock.resetHandlers();
    web3Mock.resetHandlers();
  });

  /**
   * Calls `method` with `stringForm` and with `objectForm` on a cold cache each time, and returns both results
   * together with the Mirror Node requests each call made.
   */
  const compareForms = async (
    method: string,
    stringForm: string,
    objectForm: object,
  ): Promise<{ results: unknown[]; requests: string[][] }> => {
    const results: unknown[] = [];
    const requests: string[][] = [];
    for (const blockParam of [stringForm, objectForm]) {
      await cacheService.clear();
      resetMirrorNodeHistory();
      results.push(await dispatch(method, blockParam));
      requests.push(mirrorNodeRequests());
    }
    return { results, requests };
  };

  describe('AC1 / AC3 / AC12: object forms resolve like the string form', () => {
    for (const method of Object.keys(METHODS)) {
      const cases: [string, string, object][] = [
        ['{"blockNumber": N}', BLOCK_NUMBER_HEX, { blockNumber: BLOCK_NUMBER_HEX }],
        ['{"blockHash": H}', BLOCK_HASH, { blockHash: BLOCK_HASH }],
        ['{"blockHash": H, "requireCanonical": true}', BLOCK_HASH, { blockHash: BLOCK_HASH, requireCanonical: true }],
        ['{"blockHash": H, "requireCanonical": false}', BLOCK_HASH, { blockHash: BLOCK_HASH, requireCanonical: false }],
      ];

      for (const [name, stringForm, objectForm] of cases) {
        it(`${method} with ${name} returns the same result with the same Mirror Node requests`, async () => {
          const { results, requests } = await compareForms(method, stringForm, objectForm);

          expect(results[0]).to.not.be.instanceOf(JsonRpcError);
          expect(results[1]).to.deep.equal(results[0]);
          expect(requests[1]).to.deep.equal(requests[0]);
        });
      }
    }
  });

  describe('AC2: tags inside blockNumber', () => {
    for (const method of Object.keys(METHODS)) {
      for (const tag of ['latest', 'earliest', 'pending', 'safe', 'finalized']) {
        it(`${method} with {"blockNumber": "${tag}"} returns the same result as "${tag}"`, async () => {
          const { results, requests } = await compareForms(method, tag, { blockNumber: tag });

          expect(results[1]).to.deep.equal(results[0]);
          expect(requests[1]).to.deep.equal(requests[0]);
        });
      }
    }

    it('eth_getTransactionCount with {"blockNumber": "pending"} includes the pending pool count', async () => {
      sinon.stub(transactionPoolService, 'getPendingCount').resolves(3);

      expect(await dispatch('eth_getTransactionCount', 'pending')).to.equal('0xa');
      expect(await dispatch('eth_getTransactionCount', { blockNumber: 'pending' })).to.equal('0xa');
    });

    it('eth_getTransactionCount with {"blockNumber": "0x0"} goes through the genesis special case', async () => {
      resetMirrorNodeHistory();

      expect(await dispatch('eth_getTransactionCount', { blockNumber: '0x0' })).to.equal('0x0');
      expect(mirrorNodeRequests()).to.be.empty;
    });
  });

  describe('AC4: malformed objects are rejected before any Mirror Node request', () => {
    const malformed: [string, unknown][] = [
      ['{}', {}],
      ['both blockHash and blockNumber', { blockHash: BLOCK_HASH, blockNumber: BLOCK_NUMBER_HEX }],
      ['requireCanonical with blockNumber', { blockNumber: BLOCK_NUMBER_HEX, requireCanonical: true }],
      ['a non-boolean requireCanonical', { blockHash: BLOCK_HASH, requireCanonical: 'yes' }],
      ['a null blockHash', { blockHash: null }],
      ['a null blockNumber', { blockNumber: null }],
      ['a short blockHash', { blockHash: '0x1234' }],
      ['an array', [BLOCK_NUMBER_HEX]],
      ['an unknown key', { blockHash: BLOCK_HASH, foo: 'bar' }],
    ];

    for (const method of Object.keys(METHODS)) {
      const index = method === 'eth_getStorageAt' ? 2 : 1;

      for (const [name, blockParam] of malformed) {
        it(`${method} rejects ${name} with -32602 at parameter ${index}`, async () => {
          resetMirrorNodeHistory();

          const result = await dispatch(method, blockParam);

          expect(result).to.be.instanceOf(JsonRpcError);
          expect((result as JsonRpcError).code).to.equal(-32602);
          expect((result as JsonRpcError).message).to.contain(`Invalid parameter ${index}: `);
          expect((result as JsonRpcError).message).to.not.contain('[object Object]');
          expect(mirrorNodeRequests()).to.be.empty;
        });
      }
    }
  });

  describe('AC5: block hash on eth_getCode', () => {
    it('returns the code at the block for a plain block hash string', async () => {
      const byHash = await dispatch('eth_getCode', BLOCK_HASH);

      expect(byHash).to.not.be.instanceOf(JsonRpcError);
      expect(byHash).to.equal(await dispatch('eth_getCode', BLOCK_NUMBER_HEX));
    });
  });

  describe('AC6: an unknown block hash is a uniform "not found"', () => {
    for (const method of Object.keys(METHODS)) {
      for (const [name, blockParam] of [
        ['string', UNKNOWN_HASH],
        ['{"blockHash"}', { blockHash: UNKNOWN_HASH }],
        ['{"blockHash", "requireCanonical"}', { blockHash: UNKNOWN_HASH, requireCanonical: true }],
      ] as [string, unknown][]) {
        it(`${method} with an unknown hash in ${name} form returns -32001`, async () => {
          const result = await dispatch(method, blockParam);

          expect(result).to.be.instanceOf(JsonRpcError);
          expect((result as JsonRpcError).code).to.equal(-32001);
          expect((result as JsonRpcError).message).to.contain(`block '${UNKNOWN_HASH}'`);
        });
      }
    }
  });

  describe('AC8: no regression for eth_call', () => {
    it('forwards the block hash of a {"blockHash"} object to the Mirror Node', async () => {
      resetMirrorNodeHistory();

      expect(await dispatch('eth_call', { blockHash: BLOCK_HASH })).to.equal(CALL_RESULT);
      expect(JSON.parse(web3Mock.history.post[0].data).block).to.equal(BLOCK_HASH);
    });

    it('keeps an unknown block number a contract call simulation failure', async () => {
      web3Mock.reset();
      web3Mock.onPost('contracts/call').reply(400, JSON.stringify(UNKNOWN_BLOCK_CALL));

      const result = await dispatch('eth_call', { blockNumber: '0x7fffffff' });

      expect(result).to.be.instanceOf(JsonRpcError);
      expect((result as JsonRpcError).code).to.equal(-32000);
    });
  });

  describe('AC10: non-cacheable tags stay uncached in object form', () => {
    const changeState: Record<string, () => void> = {
      eth_getBalance: () => mockAccount(MOCK_BALANCE_RES.balance.balance + 1),
      eth_call: () => {
        web3Mock.reset();
        mockContractCall('0xbeef');
      },
    };

    for (const method of Object.keys(changeState)) {
      for (const tag of ['latest', 'pending', 'safe', 'finalized']) {
        it(`${method} with {"blockNumber": "${tag}"} returns fresh state on every call`, async () => {
          const first = await dispatch(method, { blockNumber: tag });
          changeState[method]();
          const second = await dispatch(method, { blockNumber: tag });

          expect(second).to.not.deep.equal(first);
        });
      }
    }

    for (const method of Object.keys(METHODS)) {
      it(`${method} with {"blockNumber": "latest"} writes no response cache entry`, async () => {
        const setSpy = sinon.spy(cacheService, 'set');

        await dispatch(method, { blockNumber: 'latest' });

        // the @cache decorator keys a response by the method name, e.g. `getBalance_0x…_latest`
        const responseCacheKeyPrefix = `${method.replace('eth_', '')}_`;
        expect(setSpy.getCalls().some((call) => String(call.args[0]).startsWith(responseCacheKeyPrefix))).to.be.false;
      });
    }
  });

  describe('AC11: object and string forms share one cache entry', () => {
    for (const method of Object.keys(METHODS)) {
      for (const [stringForm, objectForm] of [
        [BLOCK_NUMBER_HEX, { blockNumber: BLOCK_NUMBER_HEX }],
        [BLOCK_HASH, { blockHash: BLOCK_HASH }],
        [BLOCK_HASH, { blockHash: BLOCK_HASH, requireCanonical: true }],
      ] as [string, object][]) {
        it(`${method} with ${JSON.stringify(objectForm)} is served from the "${stringForm}" cache entry`, async () => {
          const setSpy = sinon.spy(cacheService, 'set');

          const fromString = await dispatch(method, stringForm);
          resetMirrorNodeHistory();
          const fromObject = await dispatch(method, objectForm);

          expect(fromObject).to.deep.equal(fromString);
          expect(mirrorNodeRequests()).to.be.empty;
          expect(setSpy.getCalls().some((call) => /blockNumber|blockHash/.test(String(call.args[0])))).to.be.false;
        });
      }
    }
  });

  describe('worker thread path', () => {
    it('posts the normalized block string to the eth_getBalance worker task', async () => {
      const runSpy = sinon.spy(WorkersPool, 'run');

      await dispatch('eth_getBalance', { blockHash: BLOCK_HASH, requireCanonical: true });

      const balanceTask = runSpy.getCalls().find((call) => call.args[0].type === 'getBalance');
      expect(balanceTask?.args[0]).to.include({ blockNumberOrTagOrHash: BLOCK_HASH });
    });
  });
});
