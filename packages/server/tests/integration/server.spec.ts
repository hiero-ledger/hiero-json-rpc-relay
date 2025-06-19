// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';

import { ConfigServiceTestHelper } from '../../../config-service/tests/configServiceTestHelper';
ConfigServiceTestHelper.appendEnvsFromPath(__dirname + '/test.env');
import { predefined, Relay } from '@hashgraph/json-rpc-relay';
import { MirrorNodeClient } from '@hashgraph/json-rpc-relay/dist/lib/clients';
import { TracerType } from '@hashgraph/json-rpc-relay/dist/lib/constants';
import { DebugImpl } from '@hashgraph/json-rpc-relay/dist/lib/debug';
import { CacheService } from '@hashgraph/json-rpc-relay/dist/lib/services/cacheService/cacheService';
import { Validator } from '@hashgraph/json-rpc-relay/dist/lib/validators';
import * as Constants from '@hashgraph/json-rpc-relay/dist/lib/validators';
import { JsonRpcError } from '@hashgraph/json-rpc-relay/src';
import { CommonService } from '@hashgraph/json-rpc-relay/src/lib/services';
import Axios, { AxiosInstance } from 'axios';
import { expect } from 'chai';
import { Server } from 'http';
import Koa from 'koa';
import sinon from 'sinon';
import { GCProfiler } from 'v8';

import {
  contractAddress1,
  contractAddress2,
  contractHash1,
  contractId1,
  overrideEnvsInMochaDescribe,
  withOverriddenEnvsInMochaTest,
} from '../../../relay/tests/helpers';
import RelayCalls from '../../tests/helpers/constants';
import Assertions from '../helpers/assertions';
import { Utils } from '../helpers/utils';

const MISSING_PARAM_ERROR = 'Missing value for required parameter';

describe('RPC Server', function () {
  let testServer: Server;
  let testClient: AxiosInstance;
  let populatePreconfiguredSpendingPlansSpy: sinon.SinonSpy;
  let app: Koa<Koa.DefaultState, Koa.DefaultContext>;

  overrideEnvsInMochaDescribe({
    RATE_LIMIT_DISABLED: true,
  });

  before(function () {
    // Set up spy BEFORE requiring the server module to catch the constructor call
    populatePreconfiguredSpendingPlansSpy = sinon.spy(Relay.prototype, <any>'populatePreconfiguredSpendingPlans');

    // Clear the module cache to ensure a fresh server instance
    delete require.cache[require.resolve('../../src/server')];

    app = require('../../src/server').default;
    testServer = app.listen(ConfigService.get('E2E_SERVER_PORT'));
    testClient = BaseTest.createTestClient();

    // leak detection middleware
    if (ConfigService.get('MEMWATCH_ENABLED')) {
      Utils.captureMemoryLeaks(new GCProfiler());
    }
  });

  after(function () {
    populatePreconfiguredSpendingPlansSpy.restore();
    testServer.close((err) => {
      if (err) {
        console.error(err);
      }
    });
  });

  this.timeout(5000);

  it('should verify that the server is running with the correct host and port', async function () {
    const CUSTOMIZE_PORT = '7545';
    const CUSTOMIZE_HOST = '127.0.0.1';
    const configuredServer = app.listen({ port: CUSTOMIZE_PORT, host: CUSTOMIZE_HOST });

    return new Promise<void>((resolve, reject) => {
      configuredServer.on('listening', () => {
        const address = configuredServer.address();

        try {
          expect(address).to.not.be.null;
          if (address && typeof address === 'object') {
            expect(address.address).to.equal(CUSTOMIZE_HOST);
            expect(address.port.toString()).to.equal(CUSTOMIZE_PORT);
          } else {
            throw new Error('Server address is not an object');
          }
          configuredServer.close(() => resolve());
        } catch (error) {
          configuredServer.close(() => reject(error));
        }
      });

      configuredServer.on('error', (error) => {
        reject(error);
      });
    });
  });

  it('should try to populate preconfigured spending plans', async function () {
    const calls = populatePreconfiguredSpendingPlansSpy.getCalls();
    expect(calls.length).to.be.equal(1);
    await calls[0].returnValue;
    expect(populatePreconfiguredSpendingPlansSpy.calledOnce).to.be.true;
  });

  it('should execute "eth_chainId"', async function () {
    const res = await testClient.post('/', {
      id: '2',
      jsonrpc: '2.0',
      method: RelayCalls.ETH_ENDPOINTS.ETH_CHAIN_ID,
      params: [null],
    });

    BaseTest.defaultResponseChecks(res);
    expect(res.data.result).to.be.equal(ConfigService.get('CHAIN_ID'));
  });

  it('validates enforcement of request id', async function () {
    try {
      await testClient.post('/', {
        jsonrpc: '2.0',
        method: RelayCalls.ETH_ENDPOINTS.ETH_CHAIN_ID,
        params: [null],
      });

      Assertions.expectedError();
    } catch (error: any) {
      BaseTest.invalidRequestSpecError(error.response, -32600, `Invalid Request`);
    }
  });

  withOverriddenEnvsInMochaTest({ REQUEST_ID_IS_OPTIONAL: true }, async function () {
    xit('supports optionality of request id when configured', async function () {
      const app2 = require('../../src/server').default;
      const port = `1${ConfigService.get('E2E_SERVER_PORT')}`;
      const testServer2 = app2.listen(port);

      try {
        const testClient2 = BaseTest.createTestClient(Number(port));
        const response = await testClient2.post('/', {
          jsonrpc: '2.0',
          method: RelayCalls.ETH_ENDPOINTS.ETH_CHAIN_ID,
          params: [null],
        });

        expect(response.status).to.eq(200);
        expect(response.statusText).to.eq('OK');
        expect(response, "Default response: Should have 'data' property").to.have.property('data');
        expect(response.data, "Default response: 'data' should have 'id' property").to.have.property('id');
        expect(response.data, "Default response: 'data' should have 'jsonrpc' property").to.have.property('jsonrpc');
        expect(response.data, "Default response: 'data' should have 'result' property").to.have.property('result');
        expect(response.data.id, "Default response: 'data.id' should equal '2'").to.be.equal('2');
        expect(response.data.jsonrpc, "Default response: 'data.jsonrpc' should equal '2.0'").to.be.equal('2.0');
        expect(response.data.result).to.be.equal(ConfigService.get('CHAIN_ID'));
      } catch (error: any) {
        expect(true, `Unexpected error: ${error.message}`).to.eq(false);
      } finally {
        testServer2.close();
      }
    });
  });

  it('should execute "eth_accounts"', async function () {
    const res = await testClient.post('/', {
      id: '2',
      jsonrpc: '2.0',
      method: RelayCalls.ETH_ENDPOINTS.ETH_ACCOUNTS,
      params: [null],
    });

    BaseTest.defaultResponseChecks(res);
    expect(res.data.result).to.be.an('Array');
    expect(res.data.result.length).to.be.equal(0);
  });

  it('should execute "web3_clientVersion"', async function () {
    const res = await testClient.post('/', {
      id: '2',
      jsonrpc: '2.0',
      method: RelayCalls.ETH_ENDPOINTS.WEB3_CLIENTVERSION,
      params: [null],
    });

    BaseTest.defaultResponseChecks(res);
    expect(res.data.result).to.be.equal('relay/' + ConfigService.get('npm_package_version'));
  });

  it('should execute "web3_sha3"', async function () {
    const res = await testClient.post('/', {
      id: '2',
      jsonrpc: '2.0',
      method: RelayCalls.ETH_ENDPOINTS.WEB3_SHA3,
      params: ['0x5644'],
    });

    BaseTest.defaultResponseChecks(res);
    expect(res.data.result).to.be.equal('0xf956fddff3899ff3cf7ac1773fdbf443ffbfb625c1a673abdba8947251f81bae');
  });

  it('should execute "eth_getTransactionByHash with missing transaction"', async function () {
    try {
      await testClient.post('/', {
        id: '2',
        jsonrpc: '2.0',
        method: RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_HASH,
        params: ['0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7237170ae5e5e7957eb6392'],
      });
    } catch (error: any) {
      expect(error.message).to.equal('Request failed with status code 500');
    }
  });

  it('should execute "eth_getUncleByBlockHashAndIndex"', async function () {
    const res = await testClient.post('/', {
      id: '2',
      jsonrpc: '2.0',
      method: RelayCalls.ETH_ENDPOINTS.ETH_GET_UNCLE_BY_BLOCK_HASH_AND_INDEX,
      params: [null],
    });

    BaseTest.defaultResponseChecks(res);
    expect(res.data.result).to.be.equal(null);
  });

  it('should execute "eth_getUncleByBlockNumberAndIndex"', async function () {
    const res = await testClient.post('/', {
      id: '2',
      jsonrpc: '2.0',
      method: RelayCalls.ETH_ENDPOINTS.ETH_GET_UNCLE_BY_BLOCK_NUMBER_AND_INDEX,
      params: [null],
    });

    BaseTest.defaultResponseChecks(res);
    expect(res.data.result).to.be.equal(null);
  });

  it('should execute "eth_getUncleCountByBlockHash"', async function () {
    const res = await testClient.post('/', {
      id: '2',
      jsonrpc: '2.0',
      method: RelayCalls.ETH_ENDPOINTS.ETH_GET_UNCLE_COUNT_BY_BLOCK_HASH,
      params: [null],
    });

    BaseTest.defaultResponseChecks(res);
    expect(res.data.result).to.be.equal('0x0');
  });

  it('should execute "eth_getUncleCountByBlockNumber"', async function () {
    const res = await testClient.post('/', {
      id: '2',
      jsonrpc: '2.0',
      method: RelayCalls.ETH_ENDPOINTS.ETH_GET_UNCLE_COUNT_BY_BLOCK_NUMBER,
      params: [null],
    });

    BaseTest.defaultResponseChecks(res);
    expect(res.data.result).to.be.equal('0x0');
  });

  it('should execute "eth_hashrate"', async function () {
    const res = await testClient.post('/', {
      id: '2',
      jsonrpc: '2.0',
      method: RelayCalls.ETH_ENDPOINTS.ETH_HASH_RATE,
      params: [null],
    });

    BaseTest.defaultResponseChecks(res);
    expect(res.data.result).to.be.equal('0x0');
  });

  it('should execute "eth_mining"', async function () {
    const res = await testClient.post('/', {
      id: '2',
      jsonrpc: '2.0',
      method: RelayCalls.ETH_ENDPOINTS.ETH_MINING,
      params: [null],
    });

    BaseTest.defaultResponseChecks(res);
    expect(res.data.result).to.be.equal(false);
  });

  it('should execute "eth_submitWork"', async function () {
    const res = await testClient.post('/', {
      id: '2',
      jsonrpc: '2.0',
      method: RelayCalls.ETH_ENDPOINTS.ETH_SUBMIT_WORK,
      params: [null],
    });

    BaseTest.defaultResponseChecks(res);
    expect(res.data.result).to.be.equal(false);
  });

  it('should execute "eth_syncing"', async function () {
    const res = await testClient.post('/', {
      id: '2',
      jsonrpc: '2.0',
      method: RelayCalls.ETH_ENDPOINTS.ETH_SYNCING,
      params: [null],
    });

    BaseTest.defaultResponseChecks(res);
    expect(res.data.result).to.be.equal(false);
  });

  it('should execute "net_listening"', async function () {
    const res = await testClient.post('/', {
      id: '2',
      jsonrpc: '2.0',
      method: RelayCalls.ETH_ENDPOINTS.NET_LISTENING,
      params: [null],
    });

    BaseTest.defaultResponseChecks(res);
    expect(res.data.result).to.be.equal(true);
  });

  it('should execute "web3_sha"', async function () {
    try {
      await testClient.post('/', {
        id: '2',
        jsonrpc: '2.0',
        method: RelayCalls.ETH_ENDPOINTS.WEB3_SHA,
        params: [null],
      });

      Assertions.expectedError();
    } catch (error: any) {
      BaseTest.methodNotFoundCheck(error.response, RelayCalls.ETH_ENDPOINTS.WEB3_SHA);
    }
  });

  it('should execute "net_peerCount"', async function () {
    try {
      await testClient.post('/', {
        id: '2',
        jsonrpc: '2.0',
        method: RelayCalls.ETH_ENDPOINTS.NET_PEER_COUNT,
        params: [null],
      });

      Assertions.expectedError();
    } catch (error: any) {
      BaseTest.unsupportedJsonRpcMethodChecks(error.response);
    }
  });

  it('should execute "eth_submitHashrate"', async function () {
    try {
      await testClient.post('/', {
        id: '2',
        jsonrpc: '2.0',
        method: RelayCalls.ETH_ENDPOINTS.ETH_SUBMIT_HASH_RATE,
        params: [null],
      });

      Assertions.expectedError();
    } catch (error: any) {
      BaseTest.unsupportedJsonRpcMethodChecks(error.response);
    }
  });

  it('should execute "eth_signTypedData"', async function () {
    try {
      await testClient.post('/', {
        id: '2',
        jsonrpc: '2.0',
        method: RelayCalls.ETH_ENDPOINTS.ETH_SIGN_TYPED_DATA,
        params: [null],
      });

      Assertions.expectedError();
    } catch (error: any) {
      BaseTest.methodNotFoundCheck(error.response, RelayCalls.ETH_ENDPOINTS.ETH_SIGN_TYPED_DATA);
    }
  });

  it('should execute "eth_signTransaction"', async function () {
    try {
      await testClient.post('/', {
        id: '2',
        jsonrpc: '2.0',
        method: RelayCalls.ETH_ENDPOINTS.ETH_SIGN_TRANSACTION,
        params: [null],
      });

      Assertions.expectedError();
    } catch (error: any) {
      BaseTest.unsupportedJsonRpcMethodChecks(error.response);
    }
  });

  it('should execute "eth_sign"', async function () {
    try {
      await testClient.post('/', {
        id: '2',
        jsonrpc: '2.0',
        method: RelayCalls.ETH_ENDPOINTS.ETH_SIGN,
        params: [null],
      });

      Assertions.expectedError();
    } catch (error: any) {
      BaseTest.unsupportedJsonRpcMethodChecks(error.response);
    }
  });

  it('should execute "eth_sendTransaction"', async function () {
    try {
      await testClient.post('/', {
        id: '2',
        jsonrpc: '2.0',
        method: RelayCalls.ETH_ENDPOINTS.ETH_SEND_TRANSACTION,
        params: [null],
      });

      Assertions.expectedError();
    } catch (error: any) {
      BaseTest.unsupportedJsonRpcMethodChecks(error.response);
    }
  });

  it('should execute "eth_protocolVersion"', async function () {
    try {
      await testClient.post('/', {
        id: '2',
        jsonrpc: '2.0',
        method: RelayCalls.ETH_ENDPOINTS.ETH_PROTOCOL_VERSION,
        params: [null],
      });

      Assertions.expectedError();
    } catch (error: any) {
      BaseTest.unsupportedJsonRpcMethodChecks(error.response);
    }
  });

  it('should execute "eth_getProof"', async function () {
    try {
      await testClient.post('/', {
        id: '2',
        jsonrpc: '2.0',
        method: RelayCalls.ETH_ENDPOINTS.ETH_GET_PROOF,
        params: [],
      });

      Assertions.expectedError();
    } catch (error: any) {
      BaseTest.unsupportedJsonRpcMethodChecks(error.response);
    }
  });

  it('should execute "eth_createAccessList"', async function () {
    try {
      await testClient.post('/', {
        id: '2',
        jsonrpc: '2.0',
        method: RelayCalls.ETH_ENDPOINTS.ETH_CREATE_ACCESS_LIST,
        params: [],
      });

      Assertions.expectedError();
    } catch (error: any) {
      BaseTest.unsupportedJsonRpcMethodChecks(error.response);
    }
  });

  it('should execute "eth_coinbase"', async function () {
    try {
      await testClient.post('/', {
        id: '2',
        jsonrpc: '2.0',
        method: RelayCalls.ETH_ENDPOINTS.ETH_COINBASE,
        params: [null],
      });

      Assertions.expectedError();
    } catch (error: any) {
      BaseTest.unsupportedJsonRpcMethodChecks(error.response);
    }
  });

  it('should execute "eth_blobBaseFee"', async function () {
    try {
      await testClient.post('/', {
        id: '2',
        jsonrpc: '2.0',
        method: RelayCalls.ETH_ENDPOINTS.ETH_BLOB_BASE_FEE,
        params: [null],
      });

      Assertions.expectedError();
    } catch (error: any) {
      BaseTest.unsupportedJsonRpcMethodChecks(error.response);
    }
  });

  it('should execute "eth_getWork"', async function () {
    try {
      await testClient.post('/', {
        id: '2',
        jsonrpc: '2.0',
        method: RelayCalls.ETH_ENDPOINTS.ETH_GET_WORK,
        params: [null],
      });

      Assertions.expectedError();
    } catch (error: any) {
      BaseTest.unsupportedJsonRpcMethodChecks(error.response);
    }
  });

  it('should execute "eth_maxPriorityFeePerGas"', async function () {
    const res = await testClient.post('/', {
      id: '2',
      jsonrpc: '2.0',
      method: RelayCalls.ETH_ENDPOINTS.ETH_MAX_PRIORITY_FEE_PER_GAS,
      params: [null],
    });

    BaseTest.defaultResponseChecks(res);
    expect(res.data.result).to.be.equal('0x0');
  });

  // Test all engine methods
  const engineMethods = [...RelayCalls.ETH_ENDPOINTS.ENGINE, 'engine_anyMethod'];

  engineMethods.forEach((method) => {
    const methodName = method === 'engine_anyMethod' ? 'any engine_* method' : `"${method}"`;

    it(`should execute ${methodName} and return UNSUPPORTED_METHOD`, async function () {
      try {
        await testClient.post('/', {
          id: '2',
          jsonrpc: '2.0',
          method: method,
          params: [null],
        });

        Assertions.expectedError();
      } catch (error: any) {
        BaseTest.unsupportedJsonRpcMethodChecks(error.response);
      }
    });
  });

  const traceMethods = [...RelayCalls.ETH_ENDPOINTS.TRACE, 'trace_anyMethod'];

  traceMethods.forEach((method) => {
    const methodName = method === 'trace_anyMethod' ? 'any trace_* method' : `"${method}"`;

    it(`should execute ${methodName} and return NOT_YET_IMPLEMENTED`, async function () {
      try {
        await testClient.post('/', {
          id: '2',
          jsonrpc: '2.0',
          method: method,
          params: ['latest'],
        });

        Assertions.expectedError();
      } catch (error: any) {
        BaseTest.notYetImplementedErrorCheck(error.response);
      }
    });
  });

  const debugMethods = [...RelayCalls.ETH_ENDPOINTS.DEBUG, 'debug_anyMethod'];

  debugMethods.forEach((method) => {
    const methodName = method === 'debug_anyMethod' ? 'any debug_* method' : `"${method}"`;

    it(`should execute ${methodName} and return UNSUPPORTED_METHOD`, async function () {
      try {
        await testClient.post('/', {
          id: '2',
          jsonrpc: '2.0',
          method: method,
          params: ['latest'],
        });

        Assertions.expectedError();
      } catch (error: any) {
        BaseTest.notYetImplementedErrorCheck(error.response);
      }
    });
  });

  describe('batchRequest Test Cases', async function () {
    overrideEnvsInMochaDescribe({ BATCH_REQUESTS_ENABLED: true });

    function getEthChainIdRequest(id) {
      return {
        id: `${id}`,
        jsonrpc: '2.0',
        method: RelayCalls.ETH_ENDPOINTS.ETH_CHAIN_ID,
        params: [null],
      };
    }

    function getEthAccountsRequest(id) {
      if (id == null) {
        return {
          jsonrpc: '2.0',
          method: RelayCalls.ETH_ENDPOINTS.ETH_ACCOUNTS,
          params: [null],
        };
      } else {
        return {
          id: `${id}`,
          jsonrpc: '2.0',
          method: RelayCalls.ETH_ENDPOINTS.ETH_ACCOUNTS,
          params: [null],
        };
      }
    }

    function getNonExistingMethodRequest(id) {
      return {
        id: `${id}`,
        jsonrpc: '2.0',
        method: 'non_existent_method',
        params: [null],
      };
    }

    it('should execute "eth_chainId" in batch request', async function () {
      // 3 request of eth_chainId
      const response = await testClient.post('/', [
        getEthChainIdRequest(2),
        getEthChainIdRequest(3),
        getEthChainIdRequest(4),
      ]);

      // verify response
      BaseTest.baseDefaultResponseChecks(response);

      // verify response for each request
      for (let i = 0; i < response.data.length; i++) {
        expect(response.data[i].id).to.be.equal((i + 2).toString());
        expect(response.data[i].result).to.be.equal(ConfigService.get('CHAIN_ID'));
      }
    });

    it('should execute "eth_chainId" and "eth_accounts" in batch request', async function () {
      // 3 request of eth_chainId
      const response = await testClient.post('/', [
        getEthChainIdRequest(2),
        getEthAccountsRequest(3),
        getEthChainIdRequest(4),
      ]);

      // verify response
      BaseTest.baseDefaultResponseChecks(response);

      // verify response for each result
      expect(response.data[0].id).to.be.equal('2');
      expect(response.data[0].result).to.be.equal(ConfigService.get('CHAIN_ID'));
      // verify eth_accounts result
      expect(response.data[1].id).to.be.equal('3');
      expect(response.data[1].result).to.be.an('Array');
      expect(response.data[1].result.length).to.be.equal(0);
      // verify eth_chainId result
      expect(response.data[2].id).to.be.equal('4');
      expect(response.data[2].result).to.be.equal(ConfigService.get('CHAIN_ID'));
    });

    it('should execute "eth_chainId" and "eth_accounts" in batch request with invalid request id', async function () {
      const response = await testClient.post('/', [getEthChainIdRequest(2), getEthAccountsRequest(null)]);

      // verify response
      BaseTest.baseDefaultResponseChecks(response);

      // verify response for each result
      expect(response.data[0].id).to.be.equal('2');
      expect(response.data[0].result).to.be.equal(ConfigService.get('CHAIN_ID'));
      // verify eth_accounts result
      expect(response.data[1].id).to.be.equal(null);
      expect(response.data[1].error).to.be.an('Object');
      expect(response.data[1].error.code).to.be.equal(-32600);
      expect(response.data[1].error.message).to.be.equal('Invalid Request');
    });

    it('should execute "eth_chainId" and method not found in batch request', async function () {
      const response = await testClient.post('/', [
        getEthChainIdRequest(2),
        getNonExistingMethodRequest(3),
        getEthChainIdRequest(4),
      ]);

      // verify response
      BaseTest.baseDefaultResponseChecks(response);

      // verify eth_chainId result on position 0
      expect(response.data[0].id).to.be.equal('2');
      expect(response.data[0].result).to.be.equal(ConfigService.get('CHAIN_ID'));
      // verify method not found error on position 1
      expect(response.data[1].id).to.be.equal('3');
      expect(response.data[1].error).to.be.an('Object');
      expect(response.data[1].error.code).to.be.equal(-32601);
      expect(response.data[1].error.message).to.match(
        /[Request ID: [0-9a-fA-F-]{36}\] Method non_existent_method not found/,
      );
      // verify eth_chainId result on position 2
      expect(response.data[2].id).to.be.equal('4');
      expect(response.data[2].result).to.be.equal(ConfigService.get('CHAIN_ID'));
    });

    it('should execute "eth_chainId" and method not found and params error in batch request', async function () {
      const response = await testClient.post('/', [
        getEthChainIdRequest(2),
        getNonExistingMethodRequest(3),
        {
          id: '4',
          jsonrpc: '2.0',
          method: RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER,
          params: [null],
        },
      ]);

      // verify response
      BaseTest.baseDefaultResponseChecks(response);

      // verify eth_chainId result on position 0
      expect(response.data[0].id).to.be.equal('2');
      expect(response.data[0].result).to.be.equal(ConfigService.get('CHAIN_ID'));
      // verify method not found error on position 1
      expect(response.data[1].id).to.be.equal('3');
      expect(response.data[1].error).to.be.an('Object');
      expect(response.data[1].error.code).to.be.equal(-32601);
      expect(response.data[1].error.message).to.match(
        /[Request ID: [0-9a-fA-F-]{36}\] Method non_existent_method not found/,
      );
      // verify
      expect(response.data[2].id).to.be.equal('4');
      expect(response.data[2].error).to.be.an('Object');
      expect(response.data[2].error.code).to.be.equal(-32602);
      expect(
        response.data[2].error.message.endsWith('Invalid parameter 0: The value passed is not valid: null.'),
        'Invalid parameter 0: The value passed is not valid: null.',
      ).to.be.equal(true);
    });

    it('should hit batch request limit', async function () {
      // prepare 101 requests chain id requests
      const requests: any[] = [];
      for (let i = 0; i < 101; i++) {
        requests.push(getEthChainIdRequest(i + 1));
      }

      // execute batch request
      try {
        await testClient.post('/', requests);
        Assertions.expectedError();
      } catch (error: any) {
        BaseTest.batchRequestLimitError(error.response, requests.length, 100);
      }
    });

    withOverriddenEnvsInMochaTest({ BATCH_REQUESTS_ENABLED: false }, async function () {
      it('should not execute batch request when disabled', async function () {
        try {
          await testClient.post('/', [getEthChainIdRequest(2), getEthAccountsRequest(3), getEthChainIdRequest(4)]);
          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.batchDisabledErrorCheck(error.response);
        }
      });
    });

    withOverriddenEnvsInMochaTest({ BATCH_REQUESTS_ENABLED: undefined }, async function () {
      it('batch request should be enabled by default', async function () {
        const response = await testClient.post('/', [getEthChainIdRequest(2), getEthAccountsRequest(null)]);

        // verify response
        BaseTest.baseDefaultResponseChecks(response);

        // verify response for each result
        expect(response.data[0].id).to.be.equal('2');
        expect(response.data[0].result).to.be.equal(ConfigService.get('CHAIN_ID'));
        // verify eth_accounts result
        expect(response.data[1].id).to.be.equal(null);
        expect(response.data[1].error).to.be.an('Object');
        expect(response.data[1].error.code).to.be.equal(-32600);
        expect(response.data[1].error.message).to.be.equal('Invalid Request');
      });
    });
  });

  describe('Validator', async function () {
    describe('eth_estimateGas', async function () {
      it('validates parameter 0 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS,
            params: [],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 0');
        }
      });

      it('validates parameter 0 is TransactionObject', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS,
            params: ['0x0'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, 'Expected TransactionObject, value: 0x0');
        }
      });

      it('validates Transaction `to` param is address', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS,
            params: [{ to: '0x1' }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'to' for TransactionObject: ${Validator.ADDRESS_ERROR}, value: 0x1`,
          );
        }
      });

      it('validates Transaction `from` param is address', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS,
            params: [{ from: '0x1' }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'from' for TransactionObject: ${Validator.ADDRESS_ERROR}, value: 0x1`,
          );
        }
      });

      it('validates Transaction `gas` param is hex', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS,
            params: [{ gas: 123 }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'gas' for TransactionObject: ${Validator.DEFAULT_HEX_ERROR}, value: 123`,
          );
        }
      });

      it('validates Transaction `gasPrice` param is hex', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS,
            params: [{ gasPrice: 123 }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'gasPrice' for TransactionObject: ${Validator.DEFAULT_HEX_ERROR}, value: 123`,
          );
        }
      });

      it('validates Transaction `maxPriorityFeePerGas` param is hex', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS,
            params: [{ maxPriorityFeePerGas: 123 }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'maxPriorityFeePerGas' for TransactionObject: ${Validator.DEFAULT_HEX_ERROR}, value: 123`,
          );
        }
      });

      it('validates Transaction `maxFeePerGas` param is hex', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS,
            params: [{ maxFeePerGas: '123' }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'maxFeePerGas' for TransactionObject: ${Validator.DEFAULT_HEX_ERROR}, value: 123`,
          );
        }
      });

      it('validates Transaction `value` param is hex', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS,
            params: [{ value: '123' }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'value' for TransactionObject: ${Validator.DEFAULT_HEX_ERROR}, value: 123`,
          );
        }
      });

      it('validates Transaction `data` param is hex', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS,
            params: [{ data: '123' }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'data' for TransactionObject: ${Validator.EVEN_HEX_ERROR}, value: 123`,
          );
        }
      });

      it('validates Block param is valid block hex', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS,
            params: [{ to: '0x0000000000000000000000000000000000000001' }, '123'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 1: ${Validator.BLOCK_NUMBER_ERROR}, value: 123`,
          );
        }
      });

      it('validates Block param is valid tag', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS,
            params: [{ to: '0x0000000000000000000000000000000000000001' }, 'newest'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 1: ${Validator.BLOCK_NUMBER_ERROR}, value: newest`,
          );
        }
      });
    });

    describe('eth_getBalance', async function () {
      it('validates parameter 0 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_BALANCE,
            params: [],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 0');
        }
      });

      it('validates parameter 0 is of type Address', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_BALANCE,
            params: ['0x0'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, Validator.ADDRESS_ERROR + ', value: 0x0');
        }
      });

      it('validates parameter 1 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_BALANCE,
            params: ['0x0000000000000000000000000000000000000001'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 1');
        }
      });

      it('validates parameter 1 is valid block number', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_BALANCE,
            params: ['0x0000000000000000000000000000000000000001', '123'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `The value passed is not valid: 123. ${Constants.BLOCK_NUMBER_ERROR} OR ${Constants.BLOCK_HASH_ERROR}`,
          );
        }
      });

      it('validates parameter 1 is valid block tag', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_BALANCE,
            params: ['0x0000000000000000000000000000000000000001', 'newest'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `The value passed is not valid: newest. ${Constants.BLOCK_NUMBER_ERROR} OR ${Constants.BLOCK_HASH_ERROR}`,
          );
        }
      });
    });

    describe('eth_getCode', async function () {
      it('validates parameter 0 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_CODE,
            params: [],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 0');
        }
      });

      it('validates parameter 0 is address', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_CODE,
            params: ['0xb3b20624f8f0f86eb50dd04688409e5cea4bd02d700bf6e79e9384d47d6a5a35'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 0: ${Validator.ADDRESS_ERROR}, value: 0xb3b20624f8f0f86eb50dd04688409e5cea4bd02d700bf6e79e9384d47d6a5a35`,
          );
        }
      });

      it('validates parameter 1 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_CODE,
            params: ['0x0000000000000000000000000000000000000001'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 1');
        }
      });

      it('validates parameter 1 is valid block number', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_CODE,
            params: ['0x0000000000000000000000000000000000000001', '123'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 1: The value passed is not valid: 123. ${Constants.BLOCK_NUMBER_ERROR} OR ${Constants.BLOCK_HASH_ERROR}`,
          );
        }
      });

      it('validates parameter 1 is valid block tag', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: 'eth_getCode',
            params: ['0x0000000000000000000000000000000000000001', 'newest'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 1: The value passed is not valid: newest. ${Constants.BLOCK_NUMBER_ERROR} OR ${Constants.BLOCK_HASH_ERROR}`,
          );
        }
      });
    });

    describe('eth_getBlockByNumber', async function () {
      it('validates parameter 0 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER,
            params: [],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 0');
        }
      });

      it('validates parameter 0 is valid block number', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER,
            params: [1],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 0: ${Validator.BLOCK_NUMBER_ERROR}, value: 1`,
          );
        }
      });

      it('validates parameter 0 is valid block tag', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER,
            params: ['newest'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 0: ${Validator.BLOCK_NUMBER_ERROR}, value: newest`,
          );
        }
      });

      it('validates parameter 1 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER,
            params: ['0x1'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 1');
        }
      });

      it('validates parameter 1 is boolean', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER,
            params: ['0x1', 'true'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 1: Expected boolean type, value: true`,
          );
        }
      });
    });

    describe('eth_getBlockByHash', async function () {
      it('validates parameter 0 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_HASH,
            params: [],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 0');
        }
      });

      it('validates parameter 0 is a block hash', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_HASH,
            params: ['0x1'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 0: ${Validator.BLOCK_HASH_ERROR}, value: 0x1`,
          );
        }
      });

      it('validates parameter 1 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_HASH,
            params: ['0x88e96d4537bea4d9c05d12549907b32561d3bf31f45aae734cdc119f13406cb6'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 1');
        }
      });

      it('validates parameter 1 is boolean', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_HASH,
            params: ['0x88e96d4537bea4d9c05d12549907b32561d3bf31f45aae734cdc119f13406cb6', 'true'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 1: Expected boolean type, value: true`,
          );
        }
      });
    });

    describe('eth_getTransactionCount', async function () {
      it('validates parameter 0 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
            params: [],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 0');
        }
      });

      it('validates parameter 0 is an address', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
            params: ['0x0001'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 0: ${Validator.ADDRESS_ERROR}, value: 0x0001`,
          );
        }
      });

      it('validates parameter 1 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
            params: ['0x0000000000000000000000000000000000000001'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 1');
        }
      });

      it('validates parameter 1 is a valid block number', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
            params: ['0x0000000000000000000000000000000000000001', 123],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 1: The value passed is not valid: 123. ${Constants.BLOCK_NUMBER_ERROR} OR ${Constants.BLOCK_HASH_ERROR}`,
          );
        }
      });

      it('validates parameter 1 is a valid block tag', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
            params: ['0x0000000000000000000000000000000000000001', 'newest'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 1: The value passed is not valid: newest. ${Constants.BLOCK_NUMBER_ERROR} OR ${Constants.BLOCK_HASH_ERROR}`,
          );
        }
      });
    });

    describe('eth_call', async function () {
      it('validates parameter 0 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_CALL,
            params: [],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 0');
        }
      });

      it('validates parameter 0 is TransactionObject', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_CALL,
            params: ['0x0'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, 'Expected TransactionObject, value: 0x0');
        }
      });

      it('validates Transaction `to` param is address', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_CALL,
            params: [{ to: '0x1' }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'to' for TransactionObject: ${Validator.ADDRESS_ERROR}, value: 0x1`,
          );
        }
      });

      it('validates Transaction `from` param is address', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_CALL,
            params: [{ from: '0x1' }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'from' for TransactionObject: ${Validator.ADDRESS_ERROR}, value: 0x1`,
          );
        }
      });

      it('validates Transaction `gas` param is hex', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_CALL,
            params: [{ gas: 123 }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'gas' for TransactionObject: ${Validator.DEFAULT_HEX_ERROR}, value: 123`,
          );
        }
      });

      it('validates Transaction `gasPrice` param is hex', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_CALL,
            params: [{ gasPrice: 123 }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'gasPrice' for TransactionObject: ${Validator.DEFAULT_HEX_ERROR}, value: 123`,
          );
        }
      });

      it('validates Transaction `maxPriorityFeePerGas` param is hex', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_CALL,
            params: [{ maxPriorityFeePerGas: 123 }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'maxPriorityFeePerGas' for TransactionObject: ${Validator.DEFAULT_HEX_ERROR}, value: 123`,
          );
        }
      });

      it('validates Transaction `maxFeePerGas` param is hex', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_CALL,
            params: [{ maxFeePerGas: '123' }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'maxFeePerGas' for TransactionObject: ${Validator.DEFAULT_HEX_ERROR}, value: 123`,
          );
        }
      });

      it('validates Transaction `value` param is hex', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_CALL,
            params: [{ value: '123' }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'value' for TransactionObject: ${Validator.DEFAULT_HEX_ERROR}, value: 123`,
          );
        }
      });

      it('validates Transaction `data` param is hex', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_CALL,
            params: [{ data: '123' }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'data' for TransactionObject: ${Validator.EVEN_HEX_ERROR}, value: 123`,
          );
        }
      });

      it('validates Block param is non valid block hex', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_CALL,
            params: [{ to: '0x0000000000000000000000000000000000000001' }, '123'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 1: ${Validator.BLOCK_PARAMS_ERROR}, value: 123`,
          );
        }
      });

      it('validates Block param is non valid tag', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_CALL,
            params: [{ to: '0x0000000000000000000000000000000000000001' }, 'newest'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 1: ${Validator.BLOCK_PARAMS_ERROR}, value: newest`,
          );
        }
      });

      it('validates Block param is non valid block hash', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_CALL,
            params: [{ to: '0x0000000000000000000000000000000000000001' }, { blockHash: '0x123' }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'blockHash' for BlockHashObject: ${Validator.BLOCK_HASH_ERROR}, value: 0x123`,
          );
        }
      });

      it('validates Block param is non valid block number', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_CALL,
            params: [{ to: '0x0000000000000000000000000000000000000001' }, { blockNumber: '123' }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'blockNumber' for BlockNumberObject: ${Validator.BLOCK_NUMBER_ERROR}, value: 123`,
          );
        }
      });
    });

    describe('eth_sendRawTransaction', async function () {
      it('validates parameter 0 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_SEND_RAW_TRANSACTION,
            params: [],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 0');
        }
      });

      it('validates parameter 0 is valid hex', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_SEND_RAW_TRANSACTION,
            params: ['f868'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 0: ${Validator.DEFAULT_HEX_ERROR}, value: f868`,
          );
        }
      });
    });

    describe('eth_getTransactionByHash', async function () {
      it('validates parameter 0 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_HASH,
            params: [],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 0');
        }
      });

      it('validates parameter 0 is block hash', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_HASH,
            params: [],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 0');
        }
      });
    });

    describe('eth_feeHistory', async function () {
      it('validates parameter 0 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_FEE_HISTORY,
            params: [],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 0');
        }
      });

      it('validates parameter 1 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_FEE_HISTORY,
            params: ['0x5'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 1');
        }
      });

      it('validates parameter 2 is array', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_FEE_HISTORY,
            params: ['0x5', 'latest', {}],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 2: Expected Array, value: {}`,
          );
        }
      });
    });

    describe('eth_getBlockTransactionCountByHash', async function () {
      it('validates parameter 0 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_TRANSACTION_COUNT_BY_HASH,
            params: [],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 0');
        }
      });

      it('validates parameter 0 is block hash', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_TRANSACTION_COUNT_BY_HASH,
            params: ['0x1234'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 0: ${Validator.BLOCK_HASH_ERROR}, value: 0x1234`,
          );
        }
      });
    });

    describe('eth_getBlockTransactionCountByNumber', async function () {
      it('validates parameter 0 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_TRANSACTION_COUNT_BY_NUMBER,
            params: [],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 0');
        }
      });

      it('validates parameter 0 is block number', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_TRANSACTION_COUNT_BY_NUMBER,
            params: ['1234'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 0: ${Validator.BLOCK_NUMBER_ERROR}, value: 1234`,
          );
        }
      });

      it('validates parameter 0 is valid block tag', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_TRANSACTION_COUNT_BY_NUMBER,
            params: ['newest'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 0: ${Validator.BLOCK_NUMBER_ERROR}, value: newest`,
          );
        }
      });
    });

    describe('eth_getStorageAt', async function () {
      it('validates parameter 0 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_STORAGE_AT,
            params: [],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 0');
        }
      });

      it('validates parameter 0 is valid address', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_STORAGE_AT,
            params: ['0000000000000000000000000000000000000001'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 0: ${Validator.ADDRESS_ERROR}, value: 0000000000000000000000000000000000000001`,
          );
        }
      });

      it('validates parameter 1 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_STORAGE_AT,
            params: ['0x0000000000000000000000000000000000000001'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 1');
        }
      });

      it('validates parameter 1 is valid hex', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_STORAGE_AT,
            params: ['0x0000000000000000000000000000000000000001', 1234],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 1: ${Validator.HASH_ERROR}, value: 1234`,
          );
        }
      });

      it('validates parameter 2 is valid block number', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_STORAGE_AT,
            params: ['0x0000000000000000000000000000000000000001', '0x1', 123],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 2: The value passed is not valid: 123. ${Constants.BLOCK_NUMBER_ERROR} OR ${Constants.BLOCK_HASH_ERROR}`,
          );
        }
      });

      it('validates parameter 2 is valid block tag', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_STORAGE_AT,
            params: ['0x0000000000000000000000000000000000000001', '0x1', 'newest'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 2: The value passed is not valid: newest. ${Constants.BLOCK_NUMBER_ERROR} OR ${Constants.BLOCK_HASH_ERROR}`,
          );
        }
      });

      it('validates parameter 2 is valid block tag', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_STORAGE_AT,
            params: ['0x0000000000000000000000000000000000000001', '0x1', 'newest'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 2: The value passed is not valid: newest. ${Constants.BLOCK_NUMBER_ERROR} OR ${Constants.BLOCK_HASH_ERROR}`,
          );
        }
      });
    });

    describe('eth_getTransactionByBlockHashAndIndex', async function () {
      it('validates parameter 0 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX,
            params: [],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 0');
        }
      });

      it('validates parameter 0 is valid block hash', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX,
            params: ['0x1a2b3c'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 0: ${Validator.BLOCK_HASH_ERROR}, value: 0x1a2b3c`,
          );
        }
      });

      it('validates parameter 1 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_HASH_AND_INDEX,
            params: ['0xb3b20624f8f0f86eb50dd04688409e5cea4bd02d700bf6e79e9384d47d6a5a35'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 1');
        }
      });

      it('validates parameter 1 is valid hex', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: 'eth_getTransactionByBlockHashAndIndex',
            params: ['0xb3b20624f8f0f86eb50dd04688409e5cea4bd02d700bf6e79e9384d47d6a5a35', '08'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 1: ${Validator.DEFAULT_HEX_ERROR}, value: 08`,
          );
        }
      });
    });

    describe('eth_getTransactionByBlockNumberAndIndex', async function () {
      it('validates parameter 0 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX,
            params: [],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 0');
        }
      });

      it('validates parameter 0 is valid block number', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX,
            params: [123],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 0: ${Validator.BLOCK_NUMBER_ERROR}, value: 123`,
          );
        }
      });

      it('validates parameter 0 is valid block tag', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX,
            params: ['newest'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 0: ${Validator.BLOCK_NUMBER_ERROR}, value: newest`,
          );
        }
      });

      it('validates parameter 1 exists', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX,
            params: ['0x5BAD55'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 1');
        }
      });

      it('validates parameter 1 is valid hex', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_BLOCK_NUMBER_AND_INDEX,
            params: ['0x5BAD55', '08'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 1: ${Validator.DEFAULT_HEX_ERROR}, value: 08`,
          );
        }
      });
    });

    describe('eth_getLogs', async () => {
      it('validates parameter 0 is Filter Object', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
            params: ['0x1'],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 0: ${Validator.TYPES['filter'].error}, value: 0x1`,
          );
        }
      });

      it('validates parameter Filter Object does not contain both block hash and fromBlock/toBlock', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
            params: [{ blockHash: '0x123', toBlock: 'latest' }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 0: Can't use both blockHash and toBlock/fromBlock`,
          );
        }
      });

      it('validates blockHash filter', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
            params: [{ blockHash: '0x123' }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'blockHash' for FilterObject: ${Validator.BLOCK_HASH_ERROR}, value: 0x123`,
          );
        }
      });

      it('validates toBlock filter', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
            params: [{ toBlock: 123 }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'toBlock' for FilterObject: ${Validator.BLOCK_NUMBER_ERROR}, value: 123`,
          );
        }
      });

      it('validates toBlock filter', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
            params: [{ fromBlock: 123 }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'fromBlock' for FilterObject: ${Validator.BLOCK_NUMBER_ERROR}, value: 123`,
          );
        }
      });

      it('validates address filter', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
            params: [{ address: '0x012345' }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'address' for FilterObject: ${Validator.TYPES.addressFilter.error}, value: 0x012345`,
          );
        }
      });

      it('validates topics filter is array', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
            params: [{ topics: {} }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'topics' for FilterObject: ${Validator.TYPES['topics'].error}, value: {}`,
          );
        }
      });

      it('validates topics filter is array of topic hashes', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
            params: [{ topics: [123] }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'topics' for FilterObject: ${Validator.TYPES['topics'].error}, value: [123]`,
          );
        }
      });

      it('validates topics filter is array of array of topic hashes', async function () {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
            params: [{ topics: [[123]] }],
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'topics' for FilterObject: ${Validator.TYPES['topics'].error}, value: [[123]]`,
          );
        }
      });

      it('should execute HTTP OPTIONS cors preflight check', async function () {
        const response = await testClient.options('/');

        BaseTest.validResponseCheck(response, { status: 204, statusText: 'No Content' });
        BaseTest.validCorsCheck(response);
      });

      it('should execute metrics collection', async function () {
        const response = await testClient.get('/metrics');

        expect(response.status).to.eq(200);
        expect(response.statusText).to.eq('OK');
      });

      it('should execute successful health readiness check', async function () {
        const response = await testClient.get('/health/readiness');

        expect(response.status).to.eq(200);
        expect(response.statusText).to.eq('OK');
        expect(response, "Default response: Should have 'data' property").to.have.property('data');
        expect(response.data, "Default response: 'data' should equal 'OK'").to.be.equal('OK');
      });

      it('should execute successful health liveness check', async function () {
        const response = await testClient.get('/health/readiness');

        expect(response.status).to.eq(200);
        expect(response.statusText).to.eq('OK');
        expect(response, "Default response: Should have 'data' property").to.have.property('data');
        expect(response.data, "Default response: 'data' should equal 'OK'").to.be.equal('OK');
      });
    });

    describe('debug_traceTransaction', async function () {
      const contractResult = {
        address: contractAddress1,
        amount: 0,
        call_result: '0x2',
        error_message: null,
        from: contractAddress2,
        function_parameters: '0x1',
        gas_limit: 300000,
        gas_used: 240000,
        result: 'SUCCESS',
      };

      const contractActions = [
        {
          call_depth: 0,
          call_operation_type: 'CREATE',
          call_type: 'CREATE',
          caller: '0.0.1016',
          caller_type: 'ACCOUNT',
          from: '0x00000000000000000000000000000000000003f8',
          gas: 247000,
          gas_used: 77324,
          index: 0,
          input: '0x',
          recipient: '0.0.1033',
          recipient_type: 'CONTRACT',
          result_data: '0x',
          result_data_type: 'OUTPUT',
          timestamp: '1696438011.462526383',
          to: '0x0000000000000000000000000000000000000409',
          value: 0,
        },
      ];

      const contractOpcodes = {
        address: contractAddress1,
        contract_id: contractId1,
        gas: 247000,
        failed: false,
        return_value: '0x2',
        opcodes: [
          {
            pc: 0,
            op: 'PUSH1',
            gas: 247000,
            gas_cost: 3,
            depth: 0,
            stack: [],
            storage: {},
            memory: [],
          },
        ],
      };

      let getAccount: sinon.SinonStub;
      let getContract: sinon.SinonStub;
      let getContractResults: sinon.SinonStub;
      let getContractActions: sinon.SinonStub;
      let getContractOpcodes: sinon.SinonStub;

      beforeEach(() => {
        getAccount = sinon.stub(MirrorNodeClient.prototype, 'getAccount').resolves({ balance: 1000 });
        getContract = sinon.stub(MirrorNodeClient.prototype, 'getContract').resolves({ address: contractAddress1 });
        getContractResults = sinon
          .stub(MirrorNodeClient.prototype, 'getContractResultWithRetry')
          .resolves(contractResult);
        getContractActions = sinon
          .stub(MirrorNodeClient.prototype, 'getContractsResultsActions')
          .resolves(contractActions);
        getContractOpcodes = sinon
          .stub(MirrorNodeClient.prototype, 'getContractsResultsOpcodes')
          .resolves(contractOpcodes);
      });

      afterEach(() => {
        getAccount.restore();
        getContract.restore();
        getContractResults.restore();
        getContractActions.restore();
        getContractOpcodes.restore();
      });

      it('should execute with CallTracer type and valid CallTracerConfig', async () => {
        expect(
          await testClient.post('/', {
            jsonrpc: '2.0',
            method: 'debug_traceTransaction',
            params: [contractHash1, TracerType.CallTracer, { onlyTopCall: true }],
            id: 1,
          }),
        ).to.not.throw;
      });

      it('should execute with OpcodeLogger type and valid OpcodeLoggerConfig', async () => {
        expect(
          await testClient.post('/', {
            jsonrpc: '2.0',
            method: 'debug_traceTransaction',
            params: [
              contractHash1,
              TracerType.OpcodeLogger,
              { disableStack: false, disableStorage: false, enableMemory: true },
            ],
            id: 1,
          }),
        ).to.not.throw;
      });

      it('should execute with valid hash', async () => {
        expect(
          await testClient.post('/', {
            jsonrpc: '2.0',
            method: 'debug_traceTransaction',
            params: [contractHash1],
            id: '2',
          }),
        ).to.not.throw;
      });

      it('should execute with valid hash and valid TracerType string', async () => {
        expect(
          await testClient.post('/', {
            jsonrpc: '2.0',
            method: 'debug_traceTransaction',
            params: [contractHash1, TracerType.CallTracer],
            id: '2',
          }),
        ).to.not.throw;
      });

      it('should execute with valid hash, valid TracerType and empty TracerConfig', async () => {
        expect(
          await testClient.post('/', {
            jsonrpc: '2.0',
            method: 'debug_traceTransaction',
            params: [contractHash1, TracerType.CallTracer, {}],
            id: '2',
          }),
        ).to.not.throw;
      });

      it('should execute with valid hash, no TracerType and no TracerConfig', async () => {
        expect(
          await testClient.post('/', {
            jsonrpc: '2.0',
            method: 'debug_traceTransaction',
            params: [contractHash1],
            id: '2',
          }),
        ).to.not.throw;
      });

      it('should execute with unknown property in TracerConfig', async () => {
        expect(
          await testClient.post('/', {
            jsonrpc: '2.0',
            method: 'debug_traceTransaction',
            params: [contractHash1, { disableMemory: true, disableStack: true }],
            id: '2',
          }),
        ).to.not.throw;
      });

      it('should execute with unknown property in TracerConfigWrapper.tracerConfig', async () => {
        expect(
          await testClient.post('/', {
            jsonrpc: '2.0',
            method: 'debug_traceTransaction',
            params: [contractHash1, { tracerConfig: { disableMemory: true, disableStorage: true } }],
            id: '2',
          }),
        ).to.not.throw;
      });

      it('should execute with empty TracerConfigWrapper.tracerConfig', async function () {
        expect(
          await testClient.post('/', {
            jsonrpc: '2.0',
            method: 'debug_traceTransaction',
            params: [contractHash1, { tracerConfig: {} }],
            id: '2',
          }),
        ).to.not.throw;
      });

      it('should fail with missing transaction hash', async () => {
        try {
          await testClient.post('/', {
            jsonrpc: '2.0',
            method: 'debug_traceTransaction',
            params: [],
            id: '2',
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, Validator.ERROR_CODE, MISSING_PARAM_ERROR + ' 0');
        }
      });

      it('should fail with invalid hash', async () => {
        try {
          await testClient.post('/', {
            jsonrpc: '2.0',
            method: 'debug_traceTransaction',
            params: ['invalidHash', TracerType.OpcodeLogger],
            id: '2',
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 0: The value passed is not valid: invalidHash. ${Validator.TRANSACTION_HASH_ERROR} OR ${Validator.TRANSACTION_ID_ERROR}`,
          );
        }
      });

      it('should fail with valid hash and invalid TracerType string', async () => {
        try {
          await testClient.post('/', {
            jsonrpc: '2.0',
            method: 'debug_traceTransaction',
            params: [contractHash1, 'invalidTracerType'],
            id: '2',
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 1: The value passed is not valid: invalidTracerType. ${Validator.TYPES.tracerType.error} OR ${Validator.TYPES.tracerConfig.error} OR ${Validator.TYPES.tracerConfigWrapper.error}`,
          );
        }
      });

      it('should fail with valid hash, valid tracer type and invalid tracer configuration', async () => {
        try {
          await testClient.post('/', {
            jsonrpc: '2.0',
            method: 'debug_traceTransaction',
            params: [contractHash1, TracerType.CallTracer, { invalidConfig: true }],
            id: '2',
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 2: ${Validator.TYPES.tracerConfig.error}, value: ${JSON.stringify({
              invalidConfig: true,
            })}`,
          );
        }
      });

      it('should fail with valid hash and invalid type for TracerConfig.enableMemory', async () => {
        try {
          await testClient.post('/', {
            jsonrpc: '2.0',
            method: 'debug_traceTransaction',
            params: [contractHash1, { enableMemory: 'must be a boolean' }],
            id: '2',
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'enableMemory' for OpcodeLoggerConfig: ${Validator.TYPES.boolean.error}, value: must be a boolean`,
          );
        }
      });

      it('should fail with valid hash and invalid type for TracerConfig.disableStack', async () => {
        try {
          await testClient.post('/', {
            jsonrpc: '2.0',
            method: 'debug_traceTransaction',
            params: [contractHash1, { disableStack: 'must be a boolean' }],
            id: '2',
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'disableStack' for OpcodeLoggerConfig: ${Validator.TYPES.boolean.error}, value: must be a boolean`,
          );
        }
      });

      it('should fail with valid hash and invalid type for TracerConfig.disableStorage', async () => {
        try {
          await testClient.post('/', {
            jsonrpc: '2.0',
            method: 'debug_traceTransaction',
            params: [contractHash1, { disableStorage: 'must be a boolean' }],
            id: '2',
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'disableStorage' for OpcodeLoggerConfig: ${Validator.TYPES.boolean.error}, value: must be a boolean`,
          );
        }
      });

      it('should fail with valid hash and invalid type for TracerConfigWrapper.tracer', async () => {
        try {
          await testClient.post('/', {
            jsonrpc: '2.0',
            method: 'debug_traceTransaction',
            params: [contractHash1, { tracer: 'invalidTracerType' }],
            id: '2',
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'tracer' for TracerConfigWrapper: ${Validator.TYPES.tracerType.error}, value: invalidTracerType`,
          );
        }
      });

      it('should fail with valid hash and invalid type for TracerConfigWrapper.tracerConfig', async () => {
        try {
          await testClient.post('/', {
            jsonrpc: '2.0',
            method: 'debug_traceTransaction',
            params: [contractHash1, { tracer: TracerType.OpcodeLogger, tracerConfig: 'invalidTracerConfig' }],
            id: '2',
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 'tracerConfig' for TracerConfigWrapper: ${Validator.TYPES.tracerConfig.error}, value: invalidTracerConfig`,
          );
        }
      });

      it('should fail with empty TracerConfig containing invalid properties', async () => {
        try {
          await testClient.post('/', {
            jsonrpc: '2.0',
            method: 'debug_traceTransaction',
            params: [contractHash1, TracerType.CallTracer, { invalidProperty: true }],
            id: '2',
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            Validator.ERROR_CODE,
            `Invalid parameter 2: ${Validator.TYPES.tracerConfig.error}, value: ${JSON.stringify({
              invalidProperty: true,
            })}`,
          );
        }
      });

      it('should fail with invalid JSON-RPC method name', async () => {
        try {
          await testClient.post('/', {
            jsonrpc: '2.0',
            method: 'invalid_method',
            params: [contractHash1, TracerType.CallTracer, { onlyTopCall: true }],
            id: '2',
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(
            error.response,
            predefined.UNSUPPORTED_METHOD.code,
            `Method invalid_method not found`,
          );
        }
      });

      it('should fail with invalid JSON-RPC version', async () => {
        try {
          await testClient.post('/', {
            jsonrpc: '1.0',
            method: 'debug_traceTransaction',
            params: [contractHash1, TracerType.CallTracer, { onlyTopCall: true }],
            id: '2',
          });

          Assertions.expectedError();
        } catch (error: any) {
          BaseTest.invalidParamError(error.response, predefined.INVALID_REQUEST.code, `Invalid Request`);
        }
      });
    });

    describe('debug_traceBlockByNumber', async function () {
      const blockNumberHex = '0x1';
      const blockResponse = {
        number: 1,
        timestamp: {
          from: '1696438000.000000000',
          to: '1696438020.000000000',
        },
      };

      const contractResults = [
        {
          hash: '0xabcd1234',
          result: 'SUCCESS',
        },
        {
          hash: '0xefgh5678',
          result: 'SUCCESS',
        },
        {
          hash: '0xijkl9012',
          result: 'WRONG_NONCE', // This should be filtered out
        },
      ];

      const callTracerResult = {
        type: 'CALL',
        from: '0x00000000000000000000000000000000000003f8',
        to: '0x0000000000000000000000000000000000000409',
        value: '0x0',
        gas: '0x3c588',
        gasUsed: '0x12dc0',
        input: '0x1',
        output: '0x2',
      };

      const prestateTracerResult = {
        '0x00000000000000000000000000000000000003f8': {
          balance: '0x3e8',
          nonce: 1,
          code: '0x',
          storage: {},
        },
        '0x0000000000000000000000000000000000000409': {
          balance: '0x0',
          nonce: 0,
          code: '0x60806040...',
          storage: {
            '0x0000000000000000000000000000000000000000000000000000000000000000':
              '0x0000000000000000000000000000000000000000000000000000000000000001',
          },
        },
      };

      const sharedFailureChecks = async (
        params: any[],
        statusCode: number,
        baseTestChecker: any,
        checkerCode,
        checkerMessage,
      ) => {
        await expect(
          testClient.post('/', {
            jsonrpc: '2.0',
            method: 'debug_traceBlockByNumber',
            params,
            id: '2',
          }),
        ).to.be.rejected.then((error: any) => {
          expect(error.response.status).to.equal(statusCode);
          baseTestChecker(error.response, checkerCode, checkerMessage);
        });
      };

      let getHistoricalBlockResponse: sinon.SinonStub;
      let getContractResultWithRetry: sinon.SinonStub;
      let getBlocks: sinon.SinonStub;
      let getBlock: sinon.SinonStub;
      let callTracer: sinon.SinonStub;
      let prestateTracer: sinon.SinonStub;
      let cacheGetAsync: sinon.SinonStub;
      let cacheSet: sinon.SinonStub;
      let requireDebugAPIEnabled: sinon.SinonStub;

      beforeEach(() => {
        getHistoricalBlockResponse = sinon
          .stub(CommonService.prototype, 'getHistoricalBlockResponse')
          .resolves(blockResponse);
        getContractResultWithRetry = sinon
          .stub(MirrorNodeClient.prototype, 'getContractResultWithRetry')
          .resolves(contractResults);
        getBlocks = sinon.stub(MirrorNodeClient.prototype, 'getBlocks').resolves({
          blocks: [
            {
              count: 3,
              hapi_version: '0.27.0',
              hash: '0x3c08bbbee74d287b1dcd3f0ca6d1d2cb92c90883c4acf9747de9f3f3162ad25b999fc7e86699f60f2a3fb3ed9a646c6b',
              name: '2022-05-03T06_46_26.060890949Z.rcd',
              number: 77,
              previous_hash:
                '0xf7d6481f659c866c35391ee230c374f163642ebf13a5e604e04a95a9ca48a298dc2dfa10f51bcbaab8ae23bc6d662a0b',
              size: null,
              timestamp: {
                from: '1651560386.060890949',
                to: '1651560389.060890949',
              },
            },
          ],
        });
        getBlock = sinon.stub(MirrorNodeClient.prototype, 'getBlock').resolves({
          count: 1,
          hapi_version: '0.44.0',
          hash: '0xf5e3d29fc3ffd39ce50eb879e76257c2ba6e2414d5379a19d7c4fd23543e8f20573904e25caacedc7b40f9abbfe196c6',
          name: '2024-02-01T18_35_40.404621003Z.rcd.gz',
          number: 1,
          previous_hash:
            '0x5699954170cc8177692691d15368cad54f1e7a90c9e16b782f989de1b8d193583ed6ea19eb3290f59b85891eb23e8883',
          size: 489,
          timestamp: {
            from: '1706812540.404621003',
            to: '1706812540.404621003',
          },
          gas_used: 0,
          logs_bloom: '0x',
        });
        callTracer = sinon.stub(DebugImpl.prototype, 'callTracer').resolves(callTracerResult);
        prestateTracer = sinon.stub(DebugImpl.prototype, 'prestateTracer').resolves(prestateTracerResult);
        cacheGetAsync = sinon.stub(CacheService.prototype, 'getAsync').resolves(null);
        cacheSet = sinon.stub(CacheService.prototype, 'set').resolves();
        requireDebugAPIEnabled = sinon.stub(DebugImpl, 'requireDebugAPIEnabled').returns();
      });

      afterEach(() => {
        getHistoricalBlockResponse.restore();
        getContractResultWithRetry.restore();
        getBlocks.restore();
        getBlock.restore();
        callTracer.restore();
        prestateTracer.restore();
        cacheGetAsync.restore();
        cacheSet.restore();
        requireDebugAPIEnabled.restore();
      });

      it('should execute with valid block number and default tracer', async () => {
        const response = await testClient.post('/', {
          jsonrpc: '2.0',
          method: 'debug_traceBlockByNumber',
          params: [blockNumberHex],
          id: '2',
        });

        BaseTest.defaultResponseChecks(response);
        expect(response.data.result).to.be.an('array');
        expect(response.data.result).to.have.lengthOf(2); // Since we filter out WRONG_NONCE

        // Check structure of the result items
        const [firstTrace] = response.data.result;
        expect(firstTrace).to.have.property('txHash', '0xabcd1234');
        expect(firstTrace).to.have.property('result');
        expect(firstTrace.result).to.deep.equal(callTracerResult);
      });

      it('should execute with valid block number and CallTracer', async () => {
        const response = await testClient.post('/', {
          jsonrpc: '2.0',
          method: 'debug_traceBlockByNumber',
          params: [blockNumberHex, { tracer: TracerType.CallTracer }],
          id: '2',
        });

        BaseTest.defaultResponseChecks(response);
        expect(response.data.result).to.be.an('array');
        expect(response.data.result).to.have.lengthOf(2);

        // Verify CallTracer specific fields
        const [firstTrace] = response.data.result;
        expect(firstTrace.result).to.have.property('type');
        expect(firstTrace.result).to.have.property('from');
        expect(firstTrace.result).to.have.property('to');
        expect(firstTrace.result).to.have.property('gas');
        expect(firstTrace.result).to.have.property('gasUsed');
        expect(firstTrace.result).to.have.property('input');
        expect(firstTrace.result).to.have.property('output');
      });

      it('should execute with valid block number, CallTracer and onlyTopCall option', async () => {
        const response = await testClient.post('/', {
          jsonrpc: '2.0',
          method: 'debug_traceBlockByNumber',
          params: [blockNumberHex, { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: true } }],
          id: '2',
        });

        BaseTest.defaultResponseChecks(response);
        expect(response.data.result).to.be.an('array');
        expect(response.data.result).to.have.lengthOf(2);

        // We can't directly test if onlyTopCall worked since it's an internal implementation detail,
        // but we can verify the basic structure is correct
        const [firstTrace] = response.data.result;
        expect(firstTrace.result).to.have.property('type');
        expect(firstTrace.result).to.have.property('from');
        expect(firstTrace.result).to.have.property('to');
      });

      it('should execute with valid block number and PrestateTracer', async () => {
        const response = await testClient.post('/', {
          jsonrpc: '2.0',
          method: 'debug_traceBlockByNumber',
          params: [blockNumberHex, { tracer: TracerType.PrestateTracer }],
          id: '2',
        });

        BaseTest.defaultResponseChecks(response);
        expect(response.data.result).to.be.an('array');
        expect(response.data.result).to.have.lengthOf(2);

        // Verify PrestateTracer specific response structure
        const [firstTrace] = response.data.result;
        expect(firstTrace.result).to.be.an('object');
        const firstAddress = Object.keys(firstTrace.result)[0];
        expect(firstTrace.result[firstAddress]).to.have.property('balance');
        expect(firstTrace.result[firstAddress]).to.have.property('nonce');
        expect(firstTrace.result[firstAddress]).to.have.property('code');
        expect(firstTrace.result[firstAddress]).to.have.property('storage');
      });

      it('should execute with valid block number, PrestateTracer and onlyTopCall option', async () => {
        const response = await testClient.post('/', {
          jsonrpc: '2.0',
          method: 'debug_traceBlockByNumber',
          params: [blockNumberHex, { tracer: TracerType.PrestateTracer, tracerConfig: { onlyTopCall: true } }],
          id: '2',
        });

        BaseTest.defaultResponseChecks(response);
        expect(response.data.result).to.be.an('array');
        expect(response.data.result).to.have.lengthOf(2);

        // We're testing the basic structure of the prestate tracer result
        const [firstTrace] = response.data.result;
        expect(firstTrace.txHash).to.equal('0xabcd1234');
        expect(firstTrace.result).to.deep.equal(prestateTracerResult);
      });

      it('should execute with block tag instead of number', async () => {
        const response = await testClient.post('/', {
          jsonrpc: '2.0',
          method: 'debug_traceBlockByNumber',
          params: ['latest'],
          id: '2',
        });

        BaseTest.defaultResponseChecks(response);
        expect(response.data.result).to.be.an('array');
        expect(response.data.result).to.have.lengthOf(2);
      });

      it('should return cached result if available', async () => {
        const cachedResult = [{ txHash: '0xabcd1234', result: callTracerResult }];
        cacheGetAsync.resolves(cachedResult);

        const response = await testClient.post('/', {
          jsonrpc: '2.0',
          method: 'debug_traceBlockByNumber',
          params: [blockNumberHex],
          id: '2',
        });

        BaseTest.defaultResponseChecks(response);
        expect(response.data.result).to.be.an('array');
        expect(response.data.result).to.deep.equal(cachedResult);
      });

      it('should return empty array when no contract results found', async () => {
        getContractResultWithRetry.resolves(null);

        const response = await testClient.post('/', {
          jsonrpc: '2.0',
          method: 'debug_traceBlockByNumber',
          params: [blockNumberHex],
          id: '2',
        });

        BaseTest.defaultResponseChecks(response);
        expect(response.data.result).to.be.an('array');
        expect(response.data.result).to.be.empty;
      });

      it('should return empty array when contract results is an empty array', async () => {
        getContractResultWithRetry.resolves([]);

        const response = await testClient.post('/', {
          jsonrpc: '2.0',
          method: 'debug_traceBlockByNumber',
          params: [blockNumberHex],
          id: '2',
        });

        BaseTest.defaultResponseChecks(response);
        expect(response.data.result).to.be.an('array');
        expect(response.data.result).to.be.empty;
      });

      it('should fail when block not found', async () => {
        getHistoricalBlockResponse.resolves(null);
        await sharedFailureChecks(
          ['0x999999999999'],
          400,
          BaseTest.errorResponseChecks.bind(BaseTest),
          predefined.RESOURCE_NOT_FOUND().code,
          predefined.RESOURCE_NOT_FOUND().message,
        );
      });

      it('should fail with missing block number parameter', async () => {
        await sharedFailureChecks(
          [],
          400,
          BaseTest.invalidParamError.bind(BaseTest),
          Validator.ERROR_CODE,
          MISSING_PARAM_ERROR + ' 0',
        );
      });

      it('should fail with invalid block number parameter', async () => {
        await sharedFailureChecks(
          ['not-a-block-number'],
          400,
          BaseTest.invalidParamError.bind(BaseTest),
          Validator.ERROR_CODE,
          `Invalid parameter 0: ${Validator.BLOCK_NUMBER_ERROR}, value: not-a-block-number`,
        );
      });

      it('should fail with invalid tracer type', async () => {
        await sharedFailureChecks(
          [blockNumberHex, { tracer: 'invalidTracerType' }],
          400,
          BaseTest.invalidParamError.bind(BaseTest),
          Validator.ERROR_CODE,
          `Invalid parameter 'tracer' for TracerConfigWrapper: ${Validator.TYPES.tracerType.error}, value: invalidTracerType`,
        );
      });

      it('should fail with invalid tracer config', async () => {
        await sharedFailureChecks(
          [blockNumberHex, { tracer: TracerType.CallTracer, tracerConfig: 'not-an-object' }],
          400,
          BaseTest.invalidParamError.bind(BaseTest),
          Validator.ERROR_CODE,
          `Invalid parameter 'tracerConfig' for TracerConfigWrapper: ${Validator.TYPES.tracerConfig.error}, value: not-an-object`,
        );
      });

      it('should fail when debug API is not enabled', async () => {
        requireDebugAPIEnabled.throws(predefined.UNSUPPORTED_METHOD);

        await sharedFailureChecks(
          [blockNumberHex],
          400,
          BaseTest.errorResponseChecks.bind(BaseTest),
          predefined.UNSUPPORTED_METHOD.code,
          predefined.UNSUPPORTED_METHOD.message,
        );
      });

      withOverriddenEnvsInMochaTest({ DEBUG_API_ENABLED: false }, async function () {
        it('should fail when DEBUG_API_ENABLED is false', async () => {
          requireDebugAPIEnabled.restore(); // Restore the original method so real config is checked

          await sharedFailureChecks(
            [blockNumberHex],
            400,
            BaseTest.errorResponseChecks.bind(BaseTest),
            predefined.UNSUPPORTED_METHOD.code,
            predefined.UNSUPPORTED_METHOD.message,
          );
        });
      });
    });
  });
});

class BaseTest {
  static createTestClient(port = ConfigService.get('E2E_SERVER_PORT')) {
    return Axios.create({
      baseURL: 'http://localhost:' + port,
      responseType: 'json' as const,
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
      timeout: 5 * 1000,
    });
  }

  static validRequestIdCheck(response) {
    const requestIdHeaderName = 'X-Request-Id'.toLowerCase();
    expect(
      response.headers,
      `Default response: headers should have '${requestIdHeaderName}' property`,
    ).to.have.property(requestIdHeaderName);
    expect(
      response.headers[requestIdHeaderName],
      `Default response: 'headers[${requestIdHeaderName}]' should not be null`,
    ).not.to.be.null;
    expect(
      response.headers[requestIdHeaderName],
      `Default response: 'headers[${requestIdHeaderName}]' should not be undefined`,
    ).not.to.be.undefined;
  }

  static validResponseCheck(response, options: any = { status: 200, statusText: 'OK' }) {
    expect(response.status).to.eq(options.status);
    expect(response.statusText).to.eq(options.statusText);
  }

  static validCorsCheck(response) {
    // ensure cors headers are set
    expect(
      response.headers,
      "Default response: headers should have 'access-control-allow-origin' property",
    ).to.have.property('access-control-allow-origin');
    expect(
      response.headers['access-control-allow-origin'],
      "Default response: 'headers[access-control-allow-origin]' should equal '*'",
    ).to.be.equal('*');
    expect(
      response.headers,
      "Default response: headers should have 'access-control-allow-methods' property",
    ).to.have.property('access-control-allow-methods');
    expect(
      response.headers['access-control-allow-methods'],
      "Default response: 'headers[access-control-allow-methods]' should equal 'GET,HEAD,PUT,POST,DELETE'",
    ).to.be.equal('GET,HEAD,PUT,POST,DELETE');
  }

  static defaultResponseChecks(response) {
    BaseTest.baseDefaultResponseChecks(response);

    expect(response.data, "Default response: 'data' should have 'id' property").to.have.property('id');
    expect(response.data, "Default response: 'data' should have 'jsonrpc' property").to.have.property('jsonrpc');
    expect(response.data, "Default response: 'data' should have 'result' property").to.have.property('result');
    expect(response.data.id, "Default response: 'data.id' should equal '2'").to.be.equal('2');
    expect(response.data.jsonrpc, "Default response: 'data.jsonrpc' should equal '2.0'").to.be.equal('2.0');
    expect(response, "Default response should have 'headers' property").to.have.property('headers');
  }

  static baseDefaultResponseChecks(response) {
    BaseTest.validResponseCheck(response);
    BaseTest.validCorsCheck(response);
    BaseTest.validRequestIdCheck(response);
    expect(response, "Default response: Should have 'data' property").to.have.property('data');
  }

  static errorResponseChecks(response, code, message) {
    BaseTest.validRequestIdCheck(response);
    expect(response, "Error response: should have 'data' property").to.have.property('data');
    expect(response.data, "Error response: 'data' should have 'id' property").to.have.property('id');
    expect(response.data, "Error response: 'data' should have 'jsonrpc' property").to.have.property('jsonrpc');
    expect(response.data.id, "Error response: 'data.id' should equal '2'").to.be.equal('2');
    expect(response.data.jsonrpc, "Error response: 'data.jsonrpc' should equal '2.0'").to.be.equal('2.0');
    expect(response.data, "Error response: 'data' should have 'error' property").to.have.property('error');
    expect(response.data.error, "Error response: 'data.error' should have 'code' property").to.have.property('code');
    expect(response.data.error.code, "Error response: 'data.error.code' should equal passed 'code' value").to.be.equal(
      code,
    );
    expect(response.data.error, "Error response: 'error' should have 'message' property").to.have.property('message');
    expect(response.data.error.message).to.contain(message);
  }

  static unsupportedJsonRpcMethodChecks(response: any) {
    expect(response.status).to.eq(400);
    expect(response.statusText).to.eq('Bad Request');
    this.errorResponseChecks(response, -32601, 'Unsupported JSON-RPC method');
  }

  static notYetImplementedErrorCheck(response: any) {
    expect(response.status).to.eq(400);
    expect(response.statusText).to.eq('Bad Request');
    this.errorResponseChecks(response, -32601, 'Not yet implemented');
  }

  static batchDisabledErrorCheck(response: any) {
    expect(response.status).to.eq(400);
    expect(response.statusText).to.eq('Bad Request');

    expect(response.data.error.message).to.eq('Batch requests are disabled');
    expect(response.data.error.code).to.eq(-32202);
  }

  static methodNotFoundCheck(response: any, methodName: string) {
    expect(response.status).to.eq(400);
    expect(response.statusText).to.eq('Bad Request');
    this.errorResponseChecks(response, -32601, `Method ${methodName} not found`);
  }

  static batchRequestLimitError(response: any, amount: number, max: number) {
    expect(response.status).to.eq(400);
    expect(response.statusText).to.eq('Bad Request');
    expect(response.data.error.message).to.eq(`Batch request amount ${amount} exceeds max ${max}`);
    expect(response.data.error.code).to.eq(-32203);
  }

  static invalidParamError(response: any, code: number, message: string) {
    expect(response.status).to.eq(400);
    expect(response.statusText).to.eq('Bad Request');
    this.errorResponseChecks(response, code, message);
  }

  static invalidRequestSpecError(response: any, code: number, message: string) {
    BaseTest.validRequestIdCheck(response);
    expect(response.status).to.eq(400);
    expect(response.statusText).to.eq('Bad Request');
    expect(response, "Default response: Should have 'data' property").to.have.property('data');
    expect(response.data, "Default response: 'data' should have 'id' property").to.have.property('id');
    expect(response.data, "Default response: 'data' should have 'jsonrpc' property").to.have.property('jsonrpc');
    expect(response.data.jsonrpc, "Default response: 'data.jsonrpc' should equal '2.0'").to.be.equal('2.0');
    expect(response.data.error, "Error response: 'data.error' should have 'code' property").to.have.property('code');
    expect(response.data.error.code, "Error response: 'data.error.code' should equal passed 'code' value").to.be.equal(
      code,
    );
    expect(response.data.error, "Error response: 'error' should have 'message' property").to.have.property('message');
    expect(
      response.data.error.message.endsWith(message),
      "Error response: 'data.error.message' should end with passed 'message' value",
    ).to.be.true;
  }
}
