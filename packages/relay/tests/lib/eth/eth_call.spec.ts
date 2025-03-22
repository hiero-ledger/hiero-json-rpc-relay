// SPDX-License-Identifier: Apache-2.0

import { ContractFunctionResult } from '@hashgraph/sdk';
import { assert, expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Counter } from 'prom-client';
import sinon from 'sinon';

import { SDKClient } from '../../../src/lib/clients';
import constants from '../../../src/lib/constants';
import { JsonRpcError, predefined } from '../../../src/lib/errors/JsonRpcError';
import { EthImpl } from '../../../src/lib/eth';
import { IContractCallRequest, IContractCallResponse, RequestDetails } from '../../../src/lib/types';
import RelayAssertions from '../../assertions';
import {
  defaultCallData,
  defaultContractResults,
  defaultErrorMessageHex,
  defaultErrorMessageText,
  ethCallFailing,
  mockData,
  overrideEnvsInMochaDescribe,
  withOverriddenEnvsInMochaTest,
} from '../../helpers';
import {
  ACCOUNT_ADDRESS_1,
  CONTRACT_ADDRESS_1,
  CONTRACT_ADDRESS_2,
  CONTRACT_CALL_DATA,
  CONTRACT_ID_2,
  DEFAULT_CONTRACT,
  DEFAULT_CONTRACT_2,
  DEFAULT_CONTRACT_3_EMPTY_BYTECODE,
  DEFAULT_NETWORK_FEES,
  EXAMPLE_CONTRACT_BYTECODE,
  MAX_GAS_LIMIT,
  MAX_GAS_LIMIT_HEX,
  NO_TRANSACTIONS,
  NON_EXISTENT_CONTRACT_ADDRESS,
  ONE_TINYBAR_IN_WEI_HEX,
  WRONG_CONTRACT_ADDRESS,
} from './eth-config';
import { generateEthTestEnv } from './eth-helpers';

use(chaiAsPromised);

let sdkClientStub: sinon.SinonStubbedInstance<SDKClient>;
let getSdkClientStub: sinon.SinonStub;

describe('@ethCall Eth Call spec', async function () {
  this.timeout(10000);
  const { restMock, web3Mock, hapiServiceInstance, ethImpl, cacheService } = generateEthTestEnv();

  const ETH_CALL_REQ_ARGS = {
    from: ACCOUNT_ADDRESS_1,
    to: CONTRACT_ADDRESS_2,
    data: CONTRACT_CALL_DATA,
    gas: MAX_GAS_LIMIT_HEX,
  };

  const requestDetails = new RequestDetails({ requestId: 'eth_callTest', ipAddress: '0.0.0.0' });

  overrideEnvsInMochaDescribe({ ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE: 1 });

  this.beforeEach(async () => {
    // reset cache and restMock
    await cacheService.clear(requestDetails);
    restMock.reset();
    sdkClientStub = sinon.createStubInstance(SDKClient);
    getSdkClientStub = sinon.stub(hapiServiceInstance, 'getSDKClient').returns(sdkClientStub);
    restMock.onGet('network/fees').reply(200, JSON.stringify(DEFAULT_NETWORK_FEES));
    restMock.onGet(`accounts/${ACCOUNT_ADDRESS_1}${NO_TRANSACTIONS}`).reply(
      200,
      JSON.stringify({
        account: '0.0.1723',
        evm_address: ACCOUNT_ADDRESS_1,
      }),
    );
  });

  this.afterEach(() => {
    getSdkClientStub.restore();
    restMock.resetHandlers();
  });

  describe('eth_call precheck failures', async function () {
    let callConsensusNodeSpy: sinon.SinonSpy;
    let callMirrorNodeSpy: sinon.SinonSpy;
    let sandbox: sinon.SinonSandbox;

    overrideEnvsInMochaDescribe({ ETH_CALL_DEFAULT_TO_CONSENSUS_NODE: false });

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      callConsensusNodeSpy = sandbox.spy(ethImpl, 'callConsensusNode');
      callMirrorNodeSpy = sandbox.spy(ethImpl, 'callMirrorNode');
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('eth_call with incorrect `to` field length', async function () {
      await ethCallFailing(
        ethImpl,
        {
          from: CONTRACT_ADDRESS_1,
          to: EthImpl.zeroHex,
          data: CONTRACT_CALL_DATA,
          gas: MAX_GAS_LIMIT_HEX,
        },
        'latest',
        requestDetails,
        (error: any) => {
          expect(error.message).to.equal(
            `Invalid Contract Address: ${EthImpl.zeroHex}. Expected length of 42 chars but was 3.`,
          );
        },
      );
    });

    withOverriddenEnvsInMochaTest({ ETH_CALL_DEFAULT_TO_CONSENSUS_NODE: false }, () => {
      it('should execute "eth_call" against mirror node with a false ETH_CALL_DEFAULT_TO_CONSENSUS_NODE', async function () {
        web3Mock.onPost('contracts/call').reply(200);
        restMock.onGet(`contracts/${defaultCallData.from}`).reply(404);
        restMock.onGet(`accounts/${defaultCallData.from}${NO_TRANSACTIONS}`).reply(
          200,
          JSON.stringify({
            account: '0.0.1723',
            evm_address: defaultCallData.from,
          }),
        );
        restMock.onGet(`contracts/${defaultCallData.to}`).reply(200, JSON.stringify(DEFAULT_CONTRACT));

        await ethImpl.call(
          { ...defaultCallData, gas: `0x${defaultCallData.gas.toString(16)}` },
          'latest',
          requestDetails,
        );

        assert(callMirrorNodeSpy.calledOnce);
        assert(callConsensusNodeSpy.notCalled);
      });
    });

    withOverriddenEnvsInMochaTest({ ETH_CALL_DEFAULT_TO_CONSENSUS_NODE: undefined }, () => {
      it('should execute "eth_call" against mirror node with an undefined ETH_CALL_DEFAULT_TO_CONSENSUS_NODE', async function () {
        web3Mock.onPost('contracts/call').reply(200);
        restMock.onGet(`contracts/${defaultCallData.from}`).reply(404);
        restMock.onGet(`accounts/${defaultCallData.from}${NO_TRANSACTIONS}`).reply(
          200,
          JSON.stringify({
            account: '0.0.1723',
            evm_address: defaultCallData.from,
          }),
        );
        restMock.onGet(`contracts/${defaultCallData.to}`).reply(200, JSON.stringify(DEFAULT_CONTRACT));

        await ethImpl.call(
          { ...defaultCallData, gas: `0x${defaultCallData.gas.toString(16)}` },
          'latest',
          requestDetails,
        );

        assert(callMirrorNodeSpy.calledOnce);
        assert(callConsensusNodeSpy.notCalled);
      });
    });

    withOverriddenEnvsInMochaTest({ ETH_CALL_DEFAULT_TO_CONSENSUS_NODE: true }, () => {
      it('should execute "eth_call" against consensus node with a ETH_CALL_DEFAULT_TO_CONSENSUS_NODE set to true', async function () {
        restMock.onGet(`contracts/${defaultCallData.from}`).reply(404);
        restMock.onGet(`accounts/${defaultCallData.from}${NO_TRANSACTIONS}`).reply(
          200,
          JSON.stringify({
            account: '0.0.1723',
            evm_address: defaultCallData.from,
          }),
        );
        restMock.onGet(`contracts/${defaultCallData.to}`).reply(200, JSON.stringify(DEFAULT_CONTRACT));

        await ethImpl.call(
          { ...defaultCallData, gas: `0x${defaultCallData.gas.toString(16)}` },
          'latest',
          requestDetails,
        );

        assert(callMirrorNodeSpy.notCalled);
        assert(callConsensusNodeSpy.calledOnce);
      });
    });

    it('to field is not a contract or token', async function () {
      restMock.onGet(`contracts/${ACCOUNT_ADDRESS_1}`).reply(404);
      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(404);
      restMock.onGet(`tokens/${CONTRACT_ID_2}`).reply(404);
      web3Mock.onPost(`contracts/call`).reply(200, JSON.stringify({ result: '0x1' }));

      await expect(
        ethImpl.call(
          {
            from: ACCOUNT_ADDRESS_1,
            to: CONTRACT_ADDRESS_2,
            data: CONTRACT_CALL_DATA,
            gas: MAX_GAS_LIMIT_HEX,
          },
          'latest',
          requestDetails,
        ),
      ).to.eventually.be.fulfilled.and.equal('0x1');
    });

    // support for web3js.
    it('the input is set with the encoded data for the data field', async function () {
      restMock.onGet(`contracts/${ACCOUNT_ADDRESS_1}`).reply(200);
      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200);
      restMock.onGet(`tokens/${CONTRACT_ID_2}`).reply(200);
      web3Mock.onPost(`contracts/call`).reply(200, JSON.stringify({ result: '0x1' }));

      await expect(
        ethImpl.call(
          {
            from: ACCOUNT_ADDRESS_1,
            to: CONTRACT_ADDRESS_2,
            input: CONTRACT_CALL_DATA,
            gas: MAX_GAS_LIMIT_HEX,
          },
          'latest',
          requestDetails,
        ),
      ).to.eventually.be.fulfilled.and.equal('0x1');
    });
  });

  describe('eth_call using consensus node', async function () {
    overrideEnvsInMochaDescribe({ ETH_CALL_DEFAULT_TO_CONSENSUS_NODE: true });

    it('eth_call with no gas', async function () {
      restMock.onGet(`contracts/${ACCOUNT_ADDRESS_1}`).reply(404);
      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200, JSON.stringify(DEFAULT_CONTRACT_2));

      sdkClientStub.submitContractCallQueryWithRetry.resolves({
        asBytes: function () {
          return Uint8Array.of(0);
        },
      } as unknown as ContractFunctionResult);

      const result = await ethImpl.call(
        {
          from: ACCOUNT_ADDRESS_1,
          to: CONTRACT_ADDRESS_2,
          data: CONTRACT_CALL_DATA,
        },
        'latest',
        requestDetails,
      );

      sinon.assert.calledWith(
        sdkClientStub.submitContractCallQueryWithRetry,
        CONTRACT_ADDRESS_2,
        CONTRACT_CALL_DATA,
        400_000,
        ACCOUNT_ADDRESS_1,
        'eth_call',
      );
      expect(result).to.equal('0x00');
    });

    it('eth_call with no data', async function () {
      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200, JSON.stringify(DEFAULT_CONTRACT_2));
      sdkClientStub.submitContractCallQueryWithRetry.resolves({
        asBytes: function () {
          return Uint8Array.of(0);
        },
      } as unknown as ContractFunctionResult);

      const result = await ethImpl.call(
        {
          from: ACCOUNT_ADDRESS_1,
          to: CONTRACT_ADDRESS_2,
          gas: MAX_GAS_LIMIT_HEX,
        },
        'latest',
        requestDetails,
      );

      sinon.assert.calledWith(
        sdkClientStub.submitContractCallQueryWithRetry,
        CONTRACT_ADDRESS_2,
        undefined,
        MAX_GAS_LIMIT,
        ACCOUNT_ADDRESS_1,
        'eth_call',
      );
      expect(result).to.equal('0x00');
    });

    it('eth_call with no "from" address', async function () {
      const callData = {
        ...defaultCallData,
        from: undefined,
        to: CONTRACT_ADDRESS_2,
        data: CONTRACT_CALL_DATA,
        gas: MAX_GAS_LIMIT,
      };

      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200, JSON.stringify(DEFAULT_CONTRACT_2));
      sdkClientStub.submitContractCallQueryWithRetry.resolves({
        asBytes: function () {
          return Uint8Array.of(0);
        },
      } as unknown as ContractFunctionResult);

      const result = await ethImpl.call(callData, 'latest', requestDetails);
      expect(result).to.equal('0x00');
    });

    it('eth_call with a bad "from" address', async function () {
      const callData = {
        ...defaultCallData,
        from: '0x00000000000000000000000000000000000000',
        to: CONTRACT_ADDRESS_2,
        data: CONTRACT_CALL_DATA,
        gas: MAX_GAS_LIMIT,
      };

      const result = await ethImpl.call(callData, 'latest', requestDetails);

      expect((result as JsonRpcError).code).to.equal(-32014);
      expect((result as JsonRpcError).message).to.equal(
        `Non Existing Account Address: ${callData.from}. Expected an Account Address.`,
      );
    });

    it('eth_call with all fields', async function () {
      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200, JSON.stringify(DEFAULT_CONTRACT_2));
      sdkClientStub.submitContractCallQueryWithRetry.resolves({
        asBytes: function () {
          return Uint8Array.of(0);
        },
      } as unknown as ContractFunctionResult);

      const result = await ethImpl.call(ETH_CALL_REQ_ARGS, 'latest', requestDetails);

      sinon.assert.calledWith(
        sdkClientStub.submitContractCallQueryWithRetry,
        CONTRACT_ADDRESS_2,
        CONTRACT_CALL_DATA,
        MAX_GAS_LIMIT,
        ACCOUNT_ADDRESS_1,
        'eth_call',
      );
      expect(result).to.equal('0x00');
    });

    //Return once the value, then it's being fetched from cache. After the loop we reset the sdkClientStub, so that it returns nothing, if we get an error in the next request that means that the cache was cleared.
    it('eth_call should cache the response for 200ms', async function () {
      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200, JSON.stringify(DEFAULT_CONTRACT_2));
      sdkClientStub.submitContractCallQueryWithRetry.resolves({
        asBytes: function () {
          return Uint8Array.of(0);
        },
      } as unknown as ContractFunctionResult);

      for (let index = 0; index < 3; index++) {
        const result = await ethImpl.call(
          {
            from: ACCOUNT_ADDRESS_1,
            to: CONTRACT_ADDRESS_2,
            data: CONTRACT_CALL_DATA,
            gas: MAX_GAS_LIMIT_HEX,
          },
          'latest',
          requestDetails,
        );
        expect(result).to.equal('0x00');
        await new Promise((r) => setTimeout(r, 50));
      }

      await new Promise((r) => setTimeout(r, 200));

      const expectedError = predefined.INVALID_CONTRACT_ADDRESS(CONTRACT_ADDRESS_2);
      sdkClientStub.submitContractCallQueryWithRetry.throws(expectedError);
      const call: string | JsonRpcError = await ethImpl.call(ETH_CALL_REQ_ARGS, 'latest', requestDetails);

      expect((call as JsonRpcError).code).to.equal(expectedError.code);
      expect((call as JsonRpcError).message).to.equal(expectedError.message);
    });

    it('SDK returns a precheck error', async function () {
      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200, JSON.stringify(DEFAULT_CONTRACT_2));
      sdkClientStub.submitContractCallQueryWithRetry.throws(
        predefined.CONTRACT_REVERT(defaultErrorMessageText, defaultErrorMessageHex),
      );

      const result = await ethImpl.call(ETH_CALL_REQ_ARGS, 'latest', requestDetails);

      expect(result).to.exist;
      expect((result as JsonRpcError).code).to.equal(3);
      expect((result as JsonRpcError).message).to.equal(`execution reverted: ${defaultErrorMessageText}`);
      expect((result as JsonRpcError).data).to.equal(defaultErrorMessageHex);
    });

    it('eth_call with wrong `to` field', async function () {
      const args = [
        {
          from: CONTRACT_ADDRESS_1,
          to: WRONG_CONTRACT_ADDRESS,
          data: CONTRACT_CALL_DATA,
          gas: MAX_GAS_LIMIT_HEX,
        },
        'latest',
        requestDetails,
      ];

      await RelayAssertions.assertRejection(
        predefined.INVALID_CONTRACT_ADDRESS(WRONG_CONTRACT_ADDRESS),
        ethImpl.call,
        false,
        ethImpl,
        args,
      );
    });

    it('eth_call throws internal error when consensus node times out and submitContractCallQueryWithRetry returns undefined', async function () {
      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200, JSON.stringify(DEFAULT_CONTRACT_2));

      sdkClientStub.submitContractCallQueryWithRetry.resolves(undefined);

      const result = await ethImpl.call(
        {
          to: CONTRACT_ADDRESS_2,
          data: CONTRACT_CALL_DATA,
          gas: 5_000_000,
        },
        'latest',
        requestDetails,
      );

      expect(result).to.exist;
      expect((result as JsonRpcError).code).to.equal(-32603);
      expect((result as JsonRpcError).message).to.equal(
        'Error invoking RPC: Invalid contractCallResponse from consensus-node: undefined',
      );
    });

    it('should update execution counter and list the correct data when eth_call is executed', async function () {
      const labelsSpy = sinon.spy(ethImpl['ethExecutionsCounter'], 'labels');
      const expectedLabelsValue = ['eth_call', ETH_CALL_REQ_ARGS.data, ETH_CALL_REQ_ARGS.from, ETH_CALL_REQ_ARGS.to];

      await ethImpl.call(ETH_CALL_REQ_ARGS, 'latest', requestDetails);

      expect(ethImpl['ethExecutionsCounter']).to.be.instanceOf(Counter);
      labelsSpy.args[0].map((labelValue, index) => {
        expect(labelValue).to.equal(expectedLabelsValue[index]);
      });

      sinon.restore();
    });
  });

  describe('eth_call using mirror node', async function () {
    const defaultCallData = {
      gas: 400000,
      value: null,
    };

    overrideEnvsInMochaDescribe({ ETH_CALL_DEFAULT_TO_CONSENSUS_NODE: false });

    //temporary workaround until precompiles are implemented in Mirror node evm module
    beforeEach(() => {
      restMock.onGet(`tokens/${defaultContractResults.results[1].contract_id}`).reply(404, null);
      web3Mock.reset();
    });

    it('eth_call with all fields, but mirror-node returns empty response', async function () {
      const callData = {
        ...defaultCallData,
        from: ACCOUNT_ADDRESS_1,
        to: CONTRACT_ADDRESS_2,
        data: CONTRACT_CALL_DATA,
        gas: MAX_GAS_LIMIT,
      };
      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200, DEFAULT_CONTRACT_3_EMPTY_BYTECODE);
      web3Mock.onPost(`contracts/call`).replyOnce(200, {});

      const result = await ethImpl.call(callData, 'latest', requestDetails);
      expect(result).to.equal('0x');
    });

    it('eth_call with no gas', async function () {
      const callData = {
        from: ACCOUNT_ADDRESS_1,
        to: CONTRACT_ADDRESS_2,
        data: CONTRACT_CALL_DATA,
      };

      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200, JSON.stringify(DEFAULT_CONTRACT_2));
      await mockContractCall({ ...callData, block: 'latest' }, false, 200, { result: '0x00' }, requestDetails);

      web3Mock.history.post = [];

      const result = await ethImpl.call(callData, 'latest', requestDetails);

      expect(web3Mock.history.post.length).to.gte(1);
      expect(web3Mock.history.post[0].data).to.equal(JSON.stringify({ ...callData, estimate: false, block: 'latest' }));

      expect(result).to.equal('0x00');
    });

    it('eth_call with no data', async function () {
      const callData = {
        ...defaultCallData,
        from: ACCOUNT_ADDRESS_1,
        to: CONTRACT_ADDRESS_2,
        gas: MAX_GAS_LIMIT,
      };
      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200, JSON.stringify(DEFAULT_CONTRACT_2));
      await mockContractCall({ ...callData, block: 'latest' }, false, 200, { result: '0x00' }, requestDetails);

      const result = await ethImpl.call(callData, 'latest', requestDetails);
      expect(result).to.equal('0x00');
    });

    it('eth_call with no from address', async function () {
      const callData = {
        ...defaultCallData,
        to: CONTRACT_ADDRESS_2,
        data: CONTRACT_CALL_DATA,
        gas: MAX_GAS_LIMIT,
      };
      await mockContractCall({ ...callData, block: 'latest' }, false, 200, { result: '0x00' }, requestDetails);
      const result = await ethImpl.call(callData, 'latest', requestDetails);
      expect(result).to.equal('0x00');
    });

    it('eth_call with all fields', async function () {
      const callData = {
        ...defaultCallData,
        from: ACCOUNT_ADDRESS_1,
        to: CONTRACT_ADDRESS_2,
        data: CONTRACT_CALL_DATA,
        gas: MAX_GAS_LIMIT,
      };
      await mockContractCall({ ...callData, block: 'latest' }, false, 200, { result: '0x00' }, requestDetails);
      const result = await ethImpl.call(callData, 'latest', requestDetails);
      expect(result).to.equal('0x00');
    });

    it('eth_call with gas capping', async function () {
      const callData = {
        ...defaultCallData,
        gas: 25_000_000,
      };
      await mockContractCall(
        { ...callData, gas: constants.MAX_GAS_PER_SEC, block: 'latest' },
        false,
        200,
        {
          result: '0x00',
        },
        requestDetails,
      );
      const res = await ethImpl.call(callData, 'latest', requestDetails);
      expect(res).to.equal('0x00');
    });

    it('eth_call with all fields and value', async function () {
      const callData = {
        ...defaultCallData,
        gas: MAX_GAS_LIMIT,
        data: CONTRACT_CALL_DATA,
        to: CONTRACT_ADDRESS_2,
        from: ACCOUNT_ADDRESS_1,
        value: 1, // Mirror node is called with value in Tinybars
        block: 'latest',
      };

      await mockContractCall({ ...callData, block: 'latest' }, false, 200, { result: '0x00' }, requestDetails);
      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200, JSON.stringify(DEFAULT_CONTRACT_2));

      // Relay is called with value in Weibars
      const result = await ethImpl.call({ ...callData, value: ONE_TINYBAR_IN_WEI_HEX }, 'latest', requestDetails);
      expect(result).to.equal('0x00');
    });

    it('eth_call with all fields but mirrorNode throws 429', async function () {
      const callData = {
        ...defaultCallData,
        from: ACCOUNT_ADDRESS_1,
        to: CONTRACT_ADDRESS_2,
        data: CONTRACT_CALL_DATA,
        gas: MAX_GAS_LIMIT,
      };
      await mockContractCall({ ...callData, block: 'latest' }, false, 429, mockData.tooManyRequests, requestDetails);
      const result = await ethImpl.call(callData, 'latest', requestDetails);
      expect(result).to.be.not.null;
      expect((result as JsonRpcError).code).to.eq(-32605);
    });

    it('eth_call with all fields but mirrorNode throws 400', async function () {
      const callData = {
        ...defaultCallData,
        from: ACCOUNT_ADDRESS_1,
        to: CONTRACT_ADDRESS_2,
        data: CONTRACT_CALL_DATA,
        gas: MAX_GAS_LIMIT,
      };
      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200, JSON.stringify(DEFAULT_CONTRACT_2));
      await mockContractCall({ ...callData, block: 'latest' }, false, 400, mockData.contractReverted, requestDetails);
      const result = await ethImpl.call(callData, 'latest', requestDetails);
      expect(result).to.be.not.null;
      expect((result as JsonRpcError).code).to.eq(3);
      expect((result as JsonRpcError).message).to.contain(mockData.contractReverted._status.messages[0].message);
    });

    it('eth_call with all fields, but mirror node throws NOT_SUPPORTED', async function () {
      const callData = {
        ...defaultCallData,
        from: ACCOUNT_ADDRESS_1,
        to: CONTRACT_ADDRESS_2,
        data: CONTRACT_CALL_DATA,
        gas: MAX_GAS_LIMIT,
      };

      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200, JSON.stringify(DEFAULT_CONTRACT_2));
      await mockContractCall({ ...callData, block: 'latest' }, false, 501, mockData.notSuported, requestDetails);

      sdkClientStub.submitContractCallQueryWithRetry.resolves({
        asBytes: function () {
          return Uint8Array.of(0);
        },
      } as unknown as ContractFunctionResult);

      const result = await ethImpl.call(callData, 'latest', requestDetails);

      sinon.assert.calledWith(
        sdkClientStub.submitContractCallQueryWithRetry,
        CONTRACT_ADDRESS_2,
        CONTRACT_CALL_DATA,
        MAX_GAS_LIMIT,
        ACCOUNT_ADDRESS_1,
        'eth_call',
      );
      expect(result).to.equal('0x00');
    });

    it('eth_call with all fields, but mirror node throws CONTRACT_REVERTED', async function () {
      const callData = {
        ...defaultCallData,
        from: ACCOUNT_ADDRESS_1,
        to: CONTRACT_ADDRESS_2,
        data: CONTRACT_CALL_DATA,
        gas: MAX_GAS_LIMIT,
      };

      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200, JSON.stringify(DEFAULT_CONTRACT_2));
      await mockContractCall({ ...callData, block: 'latest' }, false, 400, mockData.contractReverted, requestDetails);
      sinon.reset();
      const result = await ethImpl.call(callData, 'latest', requestDetails);
      sinon.assert.notCalled(sdkClientStub.submitContractCallQueryWithRetry);
      expect(result).to.not.be.null;
      expect((result as JsonRpcError).code).to.eq(3);
      expect((result as JsonRpcError).message).to.contain(mockData.contractReverted._status.messages[0].message);
    });

    it('SDK returns a precheck error', async function () {
      const callData = {
        ...defaultCallData,
        from: ACCOUNT_ADDRESS_1,
        to: CONTRACT_ADDRESS_2,
        data: CONTRACT_CALL_DATA,
        gas: MAX_GAS_LIMIT,
      };

      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200, JSON.stringify(DEFAULT_CONTRACT_2));
      await mockContractCall(
        { ...callData, block: 'latest' },
        false,
        400,
        {
          _status: {
            messages: [
              {
                message: '',
                detail: defaultErrorMessageText,
                data: defaultErrorMessageHex,
              },
            ],
          },
        },
        requestDetails,
      );

      const result = await ethImpl.call(callData, 'latest', requestDetails);

      expect(result).to.exist;
      expect((result as JsonRpcError).code).to.eq(3);
      expect((result as JsonRpcError).message).to.equal(`execution reverted: ${defaultErrorMessageText}`);
      expect((result as JsonRpcError).data).to.equal(defaultErrorMessageHex);
    });

    it('eth_call with wrong `to` field', async function () {
      const args = [
        {
          ...defaultCallData,
          from: CONTRACT_ADDRESS_1,
          to: WRONG_CONTRACT_ADDRESS,
          data: CONTRACT_CALL_DATA,
          gas: MAX_GAS_LIMIT,
        },
        'latest',
        requestDetails,
      ];

      await RelayAssertions.assertRejection(
        predefined.INVALID_CONTRACT_ADDRESS(WRONG_CONTRACT_ADDRESS),
        ethImpl.call,
        false,
        ethImpl,
        args,
      );
    });

    it('eth_call with all fields but mirrorNode throws 400 due to non-existent `to` address (INVALID_TRANSACTION)', async function () {
      const callData = {
        ...defaultCallData,
        from: ACCOUNT_ADDRESS_1,
        to: NON_EXISTENT_CONTRACT_ADDRESS,
        data: CONTRACT_CALL_DATA,
        gas: MAX_GAS_LIMIT,
      };

      await mockContractCall({ ...callData, block: 'latest' }, false, 400, mockData.invalidTransaction, requestDetails);
      const result = await ethImpl.call(callData, 'latest', requestDetails);
      expect(result).to.be.not.null;
      expect(result).to.equal('0x');
    });

    it('eth_call with all fields but mirrorNode throws 400 due to non-existent `to` address (FAIL_INVALID)', async function () {
      const callData = {
        ...defaultCallData,
        from: ACCOUNT_ADDRESS_1,
        to: NON_EXISTENT_CONTRACT_ADDRESS,
        data: CONTRACT_CALL_DATA,
        gas: MAX_GAS_LIMIT,
      };

      await mockContractCall({ ...callData, block: 'latest' }, false, 400, mockData.failInvalid, requestDetails);
      const result = await ethImpl.call(callData, 'latest', requestDetails);
      expect(result).to.be.not.null;
      expect(result).to.equal('0x');
    });

    it('eth_call to simulate deploying a smart contract with `to` field being null', async function () {
      const callData = {
        data: EXAMPLE_CONTRACT_BYTECODE,
        to: null,
        from: ACCOUNT_ADDRESS_1,
      };

      await mockContractCall(
        { ...callData, block: 'latest' },
        false,
        200,
        { result: EXAMPLE_CONTRACT_BYTECODE },
        requestDetails,
      );
      const result = await ethImpl.call(callData, 'latest', requestDetails);
      expect(result).to.eq(EXAMPLE_CONTRACT_BYTECODE);
    });

    it('eth_call to simulate deploying a smart contract with `to` field being empty/undefined', async function () {
      const callData = {
        data: EXAMPLE_CONTRACT_BYTECODE,
        from: ACCOUNT_ADDRESS_1,
      };

      await mockContractCall(
        { ...callData, block: 'latest' },
        false,
        200,
        { result: EXAMPLE_CONTRACT_BYTECODE },
        requestDetails,
      );
      const result = await ethImpl.call(callData, 'latest', requestDetails);
      expect(result).to.eq(EXAMPLE_CONTRACT_BYTECODE);
    });

    it('should update execution counter and list the correct data when eth_call is executed', async function () {
      const labelsSpy = sinon.spy(ethImpl['ethExecutionsCounter'], 'labels');
      const expectedLabelsValue = ['eth_call', CONTRACT_CALL_DATA, ACCOUNT_ADDRESS_1, CONTRACT_ADDRESS_2];

      const callData = {
        ...defaultCallData,
        from: ACCOUNT_ADDRESS_1,
        to: CONTRACT_ADDRESS_2,
        data: CONTRACT_CALL_DATA,
        gas: MAX_GAS_LIMIT,
      };
      await mockContractCall({ ...callData, block: 'latest' }, false, 200, { result: '0x00' }, requestDetails);
      await ethImpl.call(callData, 'latest', requestDetails);

      expect(ethImpl['ethExecutionsCounter']).to.be.instanceOf(Counter);

      labelsSpy.args[0].map((labelValue, index) => {
        expect(labelValue).to.equal(expectedLabelsValue[index]);
      });

      sinon.restore();
    });

    async function mockContractCall(
      callData: IContractCallRequest,
      estimate: boolean,
      statusCode: number,
      result: IContractCallResponse,
      requestDetails: RequestDetails,
    ) {
      const formattedCallData = { ...callData, estimate };
      await ethImpl.contractCallFormat(formattedCallData, requestDetails);
      return web3Mock.onPost('contracts/call', formattedCallData).reply(statusCode, JSON.stringify(result));
    }
  });

  describe('contractCallFormat', () => {
    const operatorId = hapiServiceInstance.getMainClientInstance().operatorAccountId;
    const operatorEvmAddress = ACCOUNT_ADDRESS_1;

    beforeEach(() => {
      restMock.onGet(`accounts/${operatorId!.toString()}?transactions=false`).reply(
        200,
        JSON.stringify({
          account: operatorId!.toString(),
          evm_address: operatorEvmAddress,
        }),
      );
    });

    it('should format transaction value to tiny bar integer', async () => {
      const transaction = {
        value: '0x2540BE400',
      };

      await ethImpl.contractCallFormat(transaction, requestDetails);
      expect(transaction.value).to.equal(1);
    });

    it('should parse gasPrice to integer', async () => {
      const transaction = {
        gasPrice: '1000000000',
      };

      await ethImpl.contractCallFormat(transaction, requestDetails);

      expect(transaction.gasPrice).to.equal(1000000000);
    });

    it('should parse gas to integer', async () => {
      const transaction = {
        gas: '50000',
      };

      await ethImpl.contractCallFormat(transaction, requestDetails);

      expect(transaction.gas).to.equal(50000);
    });

    it('should accepts both input and data fields but copy value of input field to data field', async () => {
      const inputValue = 'input value';
      const dataValue = 'data value';
      const transaction = {
        input: inputValue,
        data: dataValue,
      };
      await ethImpl.contractCallFormat(transaction, requestDetails);
      expect(transaction.data).to.eq(inputValue);
      expect(transaction.data).to.not.eq(dataValue);
      expect(transaction.input).to.be.undefined;
    });

    it('should not modify transaction if only data field is present', async () => {
      const dataValue = 'data value';
      const transaction = {
        data: dataValue,
      };
      await ethImpl.contractCallFormat(transaction, requestDetails);
      expect(transaction.data).to.eq(dataValue);
    });

    it('should copy input to data if input is provided but data is not', async () => {
      const transaction = {
        input: 'input data',
      };

      await ethImpl.contractCallFormat(transaction, requestDetails);

      // @ts-ignore
      expect(transaction.data).to.equal('input data');
      expect(transaction.input).to.be.undefined;
    });

    it('should not modify transaction if input and data fields are not provided', async () => {
      const transaction = {
        value: '0x2540BE400',
        gasPrice: '1000000000',
        gas: '50000',
      };

      await ethImpl.contractCallFormat(transaction, requestDetails);

      expect(transaction.value).to.equal(1);
      expect(transaction.gasPrice).to.equal(1000000000);
      expect(transaction.gas).to.equal(50000);
    });

    it('should populate gas price if not provided', async () => {
      const transaction = {
        value: '0x2540BE400',
        gasPrice: undefined,
      };

      await ethImpl.contractCallFormat(transaction, requestDetails);

      const expectedGasPrice = await ethImpl.gasPrice(requestDetails);
      expect(transaction.gasPrice).to.equal(parseInt(expectedGasPrice));
    });

    it('should populate the from field if the from field is not provided and value is provided', async () => {
      const transaction = {
        value: '0x2540BE400',
        to: CONTRACT_ADDRESS_2,
        from: undefined,
      };

      await ethImpl.contractCallFormat(transaction, requestDetails);

      expect(transaction.from).to.equal(operatorEvmAddress);
    });
  });

  describe('eth_call using consensus node because of redirect by selector', async function () {
    const REDIRECTED_SELECTOR = '0x4d8fdd6d';
    const NON_REDIRECTED_SELECTOR = '0xaaaaaaaa';
    let callConsensusNodeSpy: sinon.SinonSpy;
    let callMirrorNodeSpy: sinon.SinonSpy;
    let sandbox: sinon.SinonSandbox;

    overrideEnvsInMochaDescribe({
      ETH_CALL_DEFAULT_TO_CONSENSUS_NODE: false,
      ETH_CALL_CONSENSUS_SELECTORS: [REDIRECTED_SELECTOR.slice(2)],
    });

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      callConsensusNodeSpy = sandbox.spy(ethImpl, 'callConsensusNode');
      callMirrorNodeSpy = sandbox.spy(ethImpl, 'callMirrorNode');
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('eth_call with matched selector redirects to consensus', async function () {
      await ethImpl.call(
        {
          to: ACCOUNT_ADDRESS_1,
          data: REDIRECTED_SELECTOR,
        },
        'latest',
        requestDetails,
      );

      assert(callConsensusNodeSpy.calledOnce);
      assert(callMirrorNodeSpy.notCalled);
    });

    it('eth_call with non-matched selector redirects to consensus', async function () {
      await ethImpl.call(
        {
          to: ACCOUNT_ADDRESS_1,
          data: NON_REDIRECTED_SELECTOR,
        },
        'latest',
        requestDetails,
      );

      assert(callConsensusNodeSpy.notCalled);
      assert(callMirrorNodeSpy.calledOnce);
    });
  });
});
