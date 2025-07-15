// SPDX-License-Identifier: Apache-2.0

import { ContractFunctionResult } from '@hashgraph/sdk';
import { assert, expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

import { SDKClient } from '../../../src/lib/clients';
import constants from '../../../src/lib/constants';
import { JsonRpcError, predefined } from '../../../src/lib/errors/JsonRpcError';
import { MirrorNodeClientError } from '../../../src/lib/errors/MirrorNodeClientError';
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
  const { restMock, web3Mock, hapiServiceInstance, ethImpl, cacheService, commonService } = generateEthTestEnv();

  const contractService = ethImpl['contractService'];
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
    let callMirrorNodeSpy: sinon.SinonSpy;
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      callMirrorNodeSpy = sandbox.spy(contractService, 'callMirrorNode');
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('eth_call with incorrect `to` field length', async function () {
      await ethCallFailing(
        contractService,
        {
          from: CONTRACT_ADDRESS_1,
          to: constants.ZERO_HEX,
          data: CONTRACT_CALL_DATA,
          gas: MAX_GAS_LIMIT_HEX,
        },
        'latest',
        requestDetails,
        (error: any) => {
          expect(error.message).to.equal(
            `Invalid Contract Address: ${constants.ZERO_HEX}. Expected length of 42 chars but was 3.`,
          );
        },
      );
    });

    it('should execute "eth_call"', async function () {
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

      await contractService.call(
        { ...defaultCallData, gas: `0x${defaultCallData.gas.toString(16)}` },
        'latest',
        requestDetails,
      );
      assert(callMirrorNodeSpy.calledOnce);
    });

    it('to field is not a contract or token', async function () {
      restMock.onGet(`contracts/${ACCOUNT_ADDRESS_1}`).reply(404);
      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(404);
      restMock.onGet(`tokens/${CONTRACT_ID_2}`).reply(404);
      web3Mock.onPost(`contracts/call`).reply(200, JSON.stringify({ result: '0x1' }));

      await expect(
        contractService.call(
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
        contractService.call(
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

  describe('eth_call using mirror node', async function () {
    const defaultCallData = {
      gas: 400000,
      value: null,
    };

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

      const result = await contractService.call(callData, 'latest', requestDetails);
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

      const result = await contractService.call(callData, 'latest', requestDetails);

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

      const result = await contractService.call(callData, 'latest', requestDetails);
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
      const result = await contractService.call(callData, 'latest', requestDetails);
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
      const result = await contractService.call(callData, 'latest', requestDetails);
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
      const res = await contractService.call(callData, 'latest', requestDetails);
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
      const result = await contractService.call(
        { ...callData, value: ONE_TINYBAR_IN_WEI_HEX },
        'latest',
        requestDetails,
      );
      expect(result).to.equal('0x00');
    });

    it('eth_call with all fields but mirrorNode throws 429 hence rejected with MirrorNodeClientError', async function () {
      const callData = {
        ...defaultCallData,
        from: ACCOUNT_ADDRESS_1,
        to: CONTRACT_ADDRESS_2,
        data: CONTRACT_CALL_DATA,
        gas: MAX_GAS_LIMIT,
      };
      await mockContractCall({ ...callData, block: 'latest' }, false, 429, mockData.tooManyRequests, requestDetails);
      await expect(ethImpl.call(callData, 'latest', requestDetails))
        .to.be.rejectedWith(MirrorNodeClientError)
        .and.eventually.satisfy((error: MirrorNodeClientError) => {
          expect(error.statusCode).to.equal(429);
          expect(error.message).to.equal('Too Many Requests');
          expect(error.isRateLimit()).to.be.true;
          return true;
        });
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
      const result = await contractService.call(callData, 'latest', requestDetails);
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

      try {
        await ethImpl.call(callData, 'latest', requestDetails);
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).to.be.instanceOf(MirrorNodeClientError);
        expect(error.isNotSupported()).to.be.true;
        expect(error.message).to.equal(mockData.notSuported._status.messages[0].message);
      }
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
      const result = await contractService.call(callData, 'latest', requestDetails);
      sinon.assert.notCalled(sdkClientStub.submitContractCallQueryWithRetry);
      expect(result).to.not.be.null;
      expect((result as JsonRpcError).code).to.eq(3);
      expect((result as JsonRpcError).message).to.contain(mockData.contractReverted._status.messages[0].message);
    });

    it('Mirror Node returns 400 contract revert error', async function () {
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

      const result = await contractService.call(callData, 'latest', requestDetails);

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
      const result = await contractService.call(callData, 'latest', requestDetails);
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
      const result = await contractService.call(callData, 'latest', requestDetails);
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
      const result = await contractService.call(callData, 'latest', requestDetails);
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
      const result = await contractService.call(callData, 'latest', requestDetails);
      expect(result).to.eq(EXAMPLE_CONTRACT_BYTECODE);
    });

    it('should return null when blockParam is null in extractBlockNumberOrTag', async function () {
      const result = await contractService['extractBlockNumberOrTag'](null, requestDetails);
      expect(result).to.be.null;
    });

    it('should throw error when neither block nor hash specified in extractBlockNumberOrTag', async function () {
      try {
        await contractService['extractBlockNumberOrTag']({}, requestDetails);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.code).to.equal(-32000);
        expect(error.message).to.contain('neither block nor hash specified');
      }
    });

    it('should handle invalid contract address in validateContractAddress', async function () {
      const invalidAddress = '0xinvalid';

      try {
        await contractService.call(
          {
            from: ACCOUNT_ADDRESS_1,
            to: invalidAddress,
            data: CONTRACT_CALL_DATA,
          },
          'latest',
          requestDetails,
        );
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.code).to.equal(-32012);
        expect(error.message).to.contain(`Invalid Contract Address: ${invalidAddress}`);
      }
    });

    async function mockContractCall(
      callData: IContractCallRequest,
      estimate: boolean,
      statusCode: number,
      result: IContractCallResponse,
      requestDetails: RequestDetails,
    ) {
      const formattedCallData = { ...callData, estimate };
      await contractService['contractCallFormat'](formattedCallData, requestDetails);
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

      await contractService['contractCallFormat'](transaction, requestDetails);
      expect(transaction.value).to.equal(1);
    });

    it('should parse gasPrice to integer', async () => {
      const transaction = {
        gasPrice: '1000000000',
      };

      await contractService['contractCallFormat'](transaction, requestDetails);

      expect(transaction.gasPrice).to.equal(1000000000);
    });

    it('should parse gas to integer', async () => {
      const transaction = {
        gas: '50000',
      };

      await contractService['contractCallFormat'](transaction, requestDetails);

      expect(transaction.gas).to.equal(50000);
    });

    it('should accepts both input and data fields but copy value of input field to data field', async () => {
      const inputValue = 'input value';
      const dataValue = 'data value';
      const transaction = {
        input: inputValue,
        data: dataValue,
      };
      await contractService['contractCallFormat'](transaction, requestDetails);
      expect(transaction.data).to.eq(inputValue);
      expect(transaction.data).to.not.eq(dataValue);
      expect(transaction.input).to.be.undefined;
    });

    it('should not modify transaction if only data field is present', async () => {
      const dataValue = 'data value';
      const transaction = {
        data: dataValue,
      };
      await contractService['contractCallFormat'](transaction, requestDetails);
      expect(transaction.data).to.eq(dataValue);
    });

    it('should copy input to data if input is provided but data is not', async () => {
      const transaction = {
        input: 'input data',
      };

      await contractService['contractCallFormat'](transaction, requestDetails);

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

      await contractService['contractCallFormat'](transaction, requestDetails);

      expect(transaction.value).to.equal(1);
      expect(transaction.gasPrice).to.equal(1000000000);
      expect(transaction.gas).to.equal(50000);
    });

    it('should populate gas price if not provided', async () => {
      const transaction = {
        value: '0x2540BE400',
        gasPrice: undefined,
      };

      await contractService['contractCallFormat'](transaction, requestDetails);

      const expectedGasPrice = await commonService.gasPrice(requestDetails);
      expect(transaction.gasPrice).to.equal(parseInt(expectedGasPrice));
    });

    it('should populate the from field if the from field is not provided and value is provided', async () => {
      const transaction = {
        value: '0x2540BE400',
        to: CONTRACT_ADDRESS_2,
        from: undefined,
      };

      await contractService['contractCallFormat'](transaction, requestDetails);

      expect(transaction.from).to.equal(operatorEvmAddress);
    });
  });
});
