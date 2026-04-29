// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { ConfigService } from '../../../src/config-service/services';
import RelayClient from '../clients/relayClient';
import RelayCalls from '../helpers/constants';

describe('@api-batch-2 RPC Server Acceptance Tests', function () {
  this.timeout(240 * 1000); // 240 seconds

  const CHAIN_ID = ConfigService.get('CHAIN_ID');

  const RANDOM_BLOCK_HASH = '0xa291866ddf5dfd7ac83d079614ac60ab412df7c55e4d91408b2f365581405ca8'; // Eth gas = 953000

  // @ts-ignore
  const { relay }: { relay: RelayClient } = global;

  describe('@release Hardcoded RPC Endpoints', () => {
    it('should execute "eth_chainId"', async function () {
      const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_CHAIN_ID, [null]);
      expect(res).to.be.equal(CHAIN_ID);
    });

    it('should execute "net_listening"', async function () {
      const res = await relay.call(RelayCalls.ETH_ENDPOINTS.NET_LISTENING, []);
      expect(res).to.be.equal(true);
    });

    it('should execute "net_version"', async function () {
      const res = await relay.call(RelayCalls.ETH_ENDPOINTS.NET_VERSION, []);

      let expectedVersion = CHAIN_ID as string;
      if (expectedVersion.startsWith('0x')) expectedVersion = parseInt(expectedVersion, 16).toString();

      expect(res).to.be.equal(expectedVersion);
    });

    // Group tests for all uncle family methods with valid parameters (success cases)
    const uncleEndpoints = [
      {
        endpoint: RelayCalls.ETH_ENDPOINTS.ETH_GET_UNCLE_COUNT_BY_BLOCK_HASH,
        expected: '0x0',
        validParams: [RANDOM_BLOCK_HASH],
      },
      {
        endpoint: RelayCalls.ETH_ENDPOINTS.ETH_GET_UNCLE_COUNT_BY_BLOCK_NUMBER,
        expected: '0x0',
        validParams: ['latest'],
      },
      {
        endpoint: RelayCalls.ETH_ENDPOINTS.ETH_GET_UNCLE_BY_BLOCK_HASH_AND_INDEX,
        expected: null,
        validParams: [RANDOM_BLOCK_HASH, '0x0'],
      },
      {
        endpoint: RelayCalls.ETH_ENDPOINTS.ETH_GET_UNCLE_BY_BLOCK_NUMBER_AND_INDEX,
        expected: null,
        validParams: ['latest', '0x0'],
      },
    ];

    const paramTypes = [
      { params: [], description: 'empty params' },
      { params: 'valid', description: 'valid params' },
    ];

    uncleEndpoints.forEach(({ endpoint, expected, validParams }) => {
      paramTypes.forEach(({ params, description }) => {
        it(`should execute "${endpoint}" with ${description}`, async function () {
          const actualParams = params === 'valid' ? validParams : []; // params is always [] for empty params case
          const res = await relay.call(endpoint, actualParams);
          expect(res).to.be.equal(expected);
        });
      });
    });

    // Group tests for all uncle family methods with invalid parameters
    const invalidScenarios = [
      { description: 'empty block identifier', blockParam: '', indexParam: '0x0' },
      { description: 'invalid hex block identifier', blockParam: '0xhedera', indexParam: '0x0' },
      { description: 'invalid index', blockParam: null, indexParam: '0xinvalidiIndex' }, // blockParam will be set per method
    ];

    const uncleMethods = [
      {
        endpoint: RelayCalls.ETH_ENDPOINTS.ETH_GET_UNCLE_COUNT_BY_BLOCK_HASH,
        validBlockParam: RANDOM_BLOCK_HASH,
        hasIndex: false,
      },
      {
        endpoint: RelayCalls.ETH_ENDPOINTS.ETH_GET_UNCLE_COUNT_BY_BLOCK_NUMBER,
        validBlockParam: 'latest',
        hasIndex: false,
      },
      {
        endpoint: RelayCalls.ETH_ENDPOINTS.ETH_GET_UNCLE_BY_BLOCK_HASH_AND_INDEX,
        validBlockParam: RANDOM_BLOCK_HASH,
        hasIndex: true,
      },
      {
        endpoint: RelayCalls.ETH_ENDPOINTS.ETH_GET_UNCLE_BY_BLOCK_NUMBER_AND_INDEX,
        validBlockParam: 'latest',
        hasIndex: true,
      },
    ];

    invalidScenarios.forEach((scenario) => {
      uncleMethods.forEach(({ endpoint, validBlockParam, hasIndex }) => {
        // Skip invalid index tests for count methods (they don't have an index parameter)
        if (scenario.description === 'invalid index' && !hasIndex) {
          return;
        }

        const blockParam = scenario.blockParam === null ? validBlockParam : scenario.blockParam;
        const params = hasIndex ? [blockParam, scenario.indexParam] : [blockParam];

        it(`should fail to execute "${endpoint}" with ${scenario.description}`, async function () {
          const promise = relay.call(endpoint, params);

          await expect(promise).to.eventually.be.rejected.and.satisfy(
            (error) =>
              error.message.includes('server response 400 Bad Request') && error.message.includes('Invalid parameter'),
          );
        });
      });
    });

    it('should return empty on "eth_accounts"', async function () {
      const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ACCOUNTS, []);
      expect(res).to.deep.equal([]);
    });

    it('should execute "eth_hashrate"', async function () {
      const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_HASH_RATE, []);
      expect(res).to.be.equal('0x0');
    });

    it('should execute "eth_mining"', async function () {
      const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_MINING, []);
      expect(res).to.be.equal(false);
    });

    it('should execute "eth_submitWork"', async function () {
      const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_SUBMIT_WORK, []);
      expect(res).to.be.equal(false);
    });

    it('should execute "eth_syncing"', async function () {
      const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_SYNCING, []);
      expect(res).to.be.equal(false);
    });

    it('should execute "eth_maxPriorityFeePerGas"', async function () {
      const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_MAX_PRIORITY_FEE_PER_GAS, []);
      expect(res).to.be.equal('0x0');
    });
  });

  describe('@release Unsupported RPC Endpoints', () => {
    it('should not support "eth_submitHashrate"', async function () {
      await relay.callUnsupported(RelayCalls.ETH_ENDPOINTS.ETH_SUBMIT_HASH_RATE, []);
    });

    it('should not support "eth_getWork"', async function () {
      await relay.callUnsupported(RelayCalls.ETH_ENDPOINTS.ETH_GET_WORK, []);
    });

    it('should not support "eth_coinbase"', async function () {
      await relay.callUnsupported(RelayCalls.ETH_ENDPOINTS.ETH_COINBASE, []);
    });

    it('should not support "eth_simulateV1"', async function () {
      await relay.callUnsupported(RelayCalls.ETH_ENDPOINTS.ETH_SIMULATEV1, []);
    });

    it('should not support "eth_blobBaseFee"', async function () {
      await relay.callUnsupported(RelayCalls.ETH_ENDPOINTS.ETH_BLOB_BASE_FEE, []);
    });

    it('should not support "eth_sendTransaction"', async function () {
      await relay.callUnsupported(RelayCalls.ETH_ENDPOINTS.ETH_SEND_TRANSACTION, []);
    });

    it('should not support "eth_protocolVersion"', async function () {
      await relay.callUnsupported(RelayCalls.ETH_ENDPOINTS.ETH_PROTOCOL_VERSION, []);
    });

    it('should not support "eth_sign"', async function () {
      await relay.callUnsupported(RelayCalls.ETH_ENDPOINTS.ETH_SIGN, []);
    });

    it('should not support "eth_signTransaction"', async function () {
      await relay.callUnsupported(RelayCalls.ETH_ENDPOINTS.ETH_SIGN_TRANSACTION, []);
    });

    it('should not support any engine method', async function () {
      for (const method of RelayCalls.ETH_ENDPOINTS.ENGINE) {
        await relay.callUnsupported(method, []);
      }
    });

    it('should not support "eth_getProof"', async function () {
      await relay.callUnsupported(RelayCalls.ETH_ENDPOINTS.ETH_GET_PROOF, []);
    });

    it('should not support "eth_createAccessList"', async function () {
      await relay.callUnsupported(RelayCalls.ETH_ENDPOINTS.ETH_CREATE_ACCESS_LIST, []);
    });
  });
});
