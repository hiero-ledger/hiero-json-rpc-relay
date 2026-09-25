// SPDX-License-Identifier: Apache-2.0

import type MockAdapter from 'axios-mock-adapter';
import { assert, expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

import { ConfigService } from '../../../../src/config-service/services';
import { numberTo0x } from '../../../../src/relay/formatters';
import { SDKClient } from '../../../../src/relay/lib/clients';
import constants from '../../../../src/relay/lib/constants';
import { JsonRpcError, predefined } from '../../../../src/relay/lib/errors/JsonRpcError';
import type { ContractService } from '../../../../src/relay/lib/services';
import {
  type IContractCallRequest,
  type IContractCallResponse,
  RequestDetails,
  type StateOverrideSet,
} from '../../../../src/relay/lib/types';
import {
  type IParamValidation,
  RPC_PARAM_VALIDATION_RULES_KEY,
  validateParams,
} from '../../../../src/relay/lib/validators';
import { Utils } from '../../../../src/relay/utils';
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
import { asSdkClientProvider, generateEthTestEnv, type SdkClientProvider } from './eth-helpers';

use(chaiAsPromised);

// @ts-expect-error: Interface 'ContractServiceTest' incorrectly extends interface 'ContractService'.
interface ContractServiceTest extends ContractService {
  callMirrorNode(): ContractService['callMirrorNode'];
}

let sdkClientStub: sinon.SinonStubbedInstance<SDKClient>;
let getSdkClientStub: sinon.SinonStubbedMember<SdkClientProvider['getSDKClient']>;

const BLOCKHASH = '0x378e5993d3756648e1ef0141e646d6290af5a652181055516a1a69e76e04b5db';

describe('@ethCall Eth Call spec', async function () {
  this.timeout(10000);
  const { restMock, web3Mock, hapiServiceInstance, ethImpl, cacheService } = generateEthTestEnv();

  const contractService = ethImpl['contractService'] as ContractServiceTest;

  const requestDetails = new RequestDetails({ requestId: 'eth_callTest', ipAddress: '0.0.0.0' });

  overrideEnvsInMochaDescribe({ ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE: 1 });

  this.beforeEach(async () => {
    // reset cache and restMock
    await cacheService.clear();
    restMock.reset();
    sdkClientStub = sinon.createStubInstance(SDKClient);
    getSdkClientStub = sinon.stub(asSdkClientProvider(hapiServiceInstance), 'getSDKClient').returns(sdkClientStub);
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

  describe('state override parameter binding', () => {
    const stateOverride = { [CONTRACT_ADDRESS_1]: { balance: '0x1' } };
    const callObject = { to: CONTRACT_ADDRESS_1, data: CONTRACT_CALL_DATA };
    let callStub: sinon.SinonStub;

    const dispatch = async (params: unknown[]): Promise<void> => {
      const args = Utils.arrangeRpcParams(
        ethImpl.call as Parameters<typeof Utils.arrangeRpcParams>[0],
        params,
        requestDetails,
      );
      await (ethImpl.call as (...methodArgs: unknown[]) => Promise<string>).apply(ethImpl, args);
    };

    beforeEach(() => {
      callStub = sinon.stub(contractService, 'call').resolves('0x');
    });

    afterEach(() => {
      callStub.restore();
    });

    it('keeps requestDetails in its own argument when a state override is sent', async () => {
      await dispatch([callObject, 'latest', stateOverride]);

      expect(callStub.firstCall.args[2]).to.equal(requestDetails);
      expect(callStub.firstCall.args[3]).to.deep.equal(stateOverride);
    });

    it('passes no state override when the caller sends two parameters', async () => {
      await dispatch([callObject, 'latest']);

      expect(callStub.firstCall.args[2]).to.equal(requestDetails);
      expect(callStub.firstCall.args[3]).to.be.undefined;
    });
  });

  describe('state overrides in the mirror node request', () => {
    const callData = { from: ACCOUNT_ADDRESS_1, to: CONTRACT_ADDRESS_2, data: CONTRACT_CALL_DATA };

    const postedBody = async (stateOverride?: StateOverrideSet): Promise<IContractCallRequest> => {
      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200, JSON.stringify(DEFAULT_CONTRACT_2));
      // replyOnce, so the handler does not outlive this test — afterEach only resets restMock.
      web3Mock.onPost('contracts/call').replyOnce(200, { result: '0x00' });
      web3Mock.resetHistory();

      await contractService.call({ ...callData }, 'latest', requestDetails, stateOverride);

      return JSON.parse(web3Mock.history.post[0].data);
    };

    it('sends the translated override set as state_overrides', async () => {
      const body = await postedBody({ [CONTRACT_ADDRESS_1]: { balance: '0x2540be400' } });

      expect(body.state_overrides).to.deep.equal([{ address: CONTRACT_ADDRESS_1.toLowerCase(), balance: '0x1' }]);
    });

    it('omits state_overrides when no override is passed', async () => {
      const body = await postedBody();

      expect(body).to.not.have.property('state_overrides');
    });

    it('omits state_overrides when every entry translates to nothing', async () => {
      const body = await postedBody({ [CONTRACT_ADDRESS_1]: {} });

      expect(body).to.not.have.property('state_overrides');
    });
  });

  describe('state override error paths', () => {
    const callData = { from: ACCOUNT_ADDRESS_1, to: CONTRACT_ADDRESS_2, data: CONTRACT_CALL_DATA };
    const stateOverride = { [CONTRACT_ADDRESS_1]: { balance: '0x1' } };

    const callWithOverride = (): Promise<string> => {
      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200, JSON.stringify(DEFAULT_CONTRACT_2));
      return contractService.call({ ...callData }, 'latest', requestDetails, stateOverride);
    };

    it('surfaces the mirror node feature-disabled 400 without calling it a revert', async () => {
      web3Mock.onPost('contracts/call').replyOnce(400, JSON.stringify(mockData.stateOverridesNotSupported));

      const error = await callWithOverride().catch((e: JsonRpcError) => e);

      expect(error).to.be.instanceOf(JsonRpcError);
      expect((error as JsonRpcError).code).to.equal(predefined.COULD_NOT_SIMULATE_TRANSACTION('').code);
      expect((error as JsonRpcError).message).to.contain('State overrides are not supported.');
    });

    it('maps a mirror node 500 to COULD_NOT_SIMULATE_TRANSACTION', async () => {
      web3Mock.onPost('contracts/call').replyOnce(500, JSON.stringify(mockData.internalServerError));

      const error = await callWithOverride().catch((e: JsonRpcError) => e);

      expect((error as JsonRpcError).code).to.equal(predefined.COULD_NOT_SIMULATE_TRANSACTION('').code);
    });
  });

  describe('state override parameter rules', () => {
    const rules = (ethImpl.call as unknown as Record<string, unknown>)[RPC_PARAM_VALIDATION_RULES_KEY] as Record<
      number,
      IParamValidation
    >;
    const CALL = { to: CONTRACT_ADDRESS_1, data: CONTRACT_CALL_DATA };

    it('declares a rule for the state override parameter', () => {
      expect(rules[2]).to.deep.equal({ type: 'stateOverride', required: false });
    });

    it('rejects null, which geth accepts as "no overrides"', () => {
      expect(() => validateParams([CALL, 'latest', null], rules)).to.throw('The value passed is not valid: null');
    });

    it('rejects movePrecompileToAddress', () => {
      expect(() =>
        validateParams(
          [CALL, 'latest', { [CONTRACT_ADDRESS_1]: { movePrecompileToAddress: CONTRACT_ADDRESS_1 } }],
          rules,
        ),
      ).to.throw("'movePrecompileToAddress' is not supported");
    });

    it('rejects a block override in the fourth parameter', () => {
      expect(() => validateParams([CALL, 'latest', {}, { number: '0x1' }], rules)).to.throw(
        'Block overrides are not supported',
      );
    });

    it('accepts the method being called without any override', () => {
      expect(() => validateParams([CALL, 'latest'], rules)).not.to.throw();
    });
  });

  describe('eth_call precheck failures', async function () {
    let sandbox: sinon.SinonSandbox;
    let callMirrorNodeSpy: sinon.SinonSpiedMember<ContractServiceTest['callMirrorNode']>;

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
        (error: JsonRpcError) => {
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

      web3Mock.resetHistory();

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
        { ...callData, gas: ConfigService.get('MAX_TRANSACTION_GAS_LIMIT'), block: 'latest' },
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

    withOverriddenEnvsInMochaTest({ MAX_TRANSACTION_GAS_LIMIT: 20_000_000 }, () => {
      it('eth_call caps gas to the configured MAX_TRANSACTION_GAS_LIMIT', async function () {
        const callData = {
          ...defaultCallData,
          gas: 25_000_000,
        };
        await mockContractCall(
          { ...callData, gas: 20_000_000, block: 'latest' },
          false,
          200,
          { result: '0x00' },
          requestDetails,
        );
        const res = await contractService.call(callData, 'latest', requestDetails);
        expect(res).to.equal('0x00');
      });

      it('eth_call does not cap gas below the configured MAX_TRANSACTION_GAS_LIMIT', async function () {
        const callData = {
          ...defaultCallData,
          gas: 18_000_000,
        };
        await mockContractCall(
          { ...callData, gas: 18_000_000, block: 'latest' },
          false,
          200,
          { result: '0x00' },
          requestDetails,
        );
        const res = await contractService.call(callData, 'latest', requestDetails);
        expect(res).to.equal('0x00');
      });
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

    it('eth_call with non-empty accessList', async () => {
      const callData = {
        ...defaultCallData,
        from: ACCOUNT_ADDRESS_1,
        to: CONTRACT_ADDRESS_2,
        data: CONTRACT_CALL_DATA,
        gas: MAX_GAS_LIMIT,
        accessList: [
          {
            address: CONTRACT_ADDRESS_2,
            storageKeys: [
              '0x0000000000000000000000000000000000000000000000000000000000000000',
              '0x0000000000000000000000000000000000000000000000000000000000000001',
            ],
          },
        ],
      };
      await mockContractCall({ ...callData, block: 'latest' }, false, 200, { result: '0x00' }, requestDetails);
      const result = await contractService.call(callData, 'latest', requestDetails);
      expect(result).to.equal('0x00');
    });

    it('eth_call with non-empty authorizationList', async () => {
      const authEntry = {
        chainId: '0x12a',
        nonce: '0x5',
        address: CONTRACT_ADDRESS_2,
        yParity: '0x0',
        r: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        s: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      };
      const callData = {
        ...defaultCallData,
        from: ACCOUNT_ADDRESS_1,
        to: CONTRACT_ADDRESS_2,
        data: CONTRACT_CALL_DATA,
        gas: MAX_GAS_LIMIT,
        authorizationList: [authEntry],
      };
      await mockContractCall({ ...callData, block: 'latest' }, false, 200, { result: '0x00' }, requestDetails);

      web3Mock.resetHistory();
      const result = await contractService.call(callData, 'latest', requestDetails);

      expect(result).to.equal('0x00');
      expect(web3Mock.history.post.length).to.gte(1);
      const sentBody = JSON.parse(web3Mock.history.post[0].data);
      expect(sentBody.authorizationList).to.be.an('array').with.lengthOf(1);
      expect(sentBody.authorizationList[0]).to.deep.equal(authEntry);
    });

    it('eth_call with all fields but mirrorNode throws 429 hence rejected with COULD_NOT_SIMULATE_TRANSACTION', async function () {
      const callData = {
        ...defaultCallData,
        from: ACCOUNT_ADDRESS_1,
        to: CONTRACT_ADDRESS_2,
        data: CONTRACT_CALL_DATA,
        gas: MAX_GAS_LIMIT,
      };
      await mockContractCall({ ...callData, block: 'latest' }, false, 429, mockData.tooManyRequests, requestDetails);

      const expectedError = predefined.COULD_NOT_SIMULATE_TRANSACTION(
        mockData.tooManyRequests._status.messages[0].message,
      );
      await expect(contractService.call(callData, 'latest', requestDetails))
        .to.be.rejectedWith(JsonRpcError, expectedError.message)
        .and.to.eventually.have.property('code', expectedError.code);
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
      const expectedError = predefined.CONTRACT_REVERT('CONTRACT_REVERT_EXECUTED');
      await expect(ethImpl.call(callData, 'latest', undefined, requestDetails))
        .to.be.rejectedWith(JsonRpcError)
        .and.eventually.satisfy((error: JsonRpcError) => {
          expect(error.code).to.equal(expectedError.code);
          expect(error.message).to.equal(expectedError.message);
          return true;
        });
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

      const expectedError = predefined.COULD_NOT_SIMULATE_TRANSACTION(mockData.notSuported._status.messages[0].message);
      await expect(contractService.call(callData, 'latest', requestDetails))
        .to.be.rejectedWith(JsonRpcError, expectedError.message)
        .and.to.eventually.have.property('code', expectedError.code);
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
      const expectedError = predefined.CONTRACT_REVERT('CONTRACT_REVERT_EXECUTED');
      await expect(ethImpl.call(callData, 'latest', undefined, requestDetails))
        .to.be.rejectedWith(JsonRpcError)
        .and.eventually.satisfy((error: JsonRpcError) => {
          expect(error.code).to.equal(expectedError.code);
          expect(error.message).to.equal(expectedError.message);
          return true;
        });
    });

    it('eth_call with 400 error that is not CONTRACT_REVERT but throws COULD_NOT_SIMULATE_TRANSACTION', async function () {
      const callData = {
        ...defaultCallData,
        from: ACCOUNT_ADDRESS_1,
        to: CONTRACT_ADDRESS_2,
        data: CONTRACT_CALL_DATA,
        gas: MAX_GAS_LIMIT,
      };

      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200, JSON.stringify(DEFAULT_CONTRACT_2));
      await mockContractCall({ ...callData, block: 'latest' }, false, 400, mockData.genericBadRequest, requestDetails);

      await expect(contractService.call(callData, 'latest', requestDetails))
        .to.be.rejectedWith(JsonRpcError)
        .and.eventually.satisfy((error: JsonRpcError) => {
          expect(error.code).to.equal(-32000);
          expect(error.message).to.contain('Error occurred during transaction simulation');
          expect(error.message).to.contain(mockData.genericBadRequest._status.messages[0].detail);
          return true;
        });
    });

    it('eth_call with mirrorNode throws 500 Internal Server Error is mapped to COULD_NOT_SIMULATE_TRANSACTION', async function () {
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
        500,
        mockData.internalServerError,
        requestDetails,
      );

      const expectedError = predefined.COULD_NOT_SIMULATE_TRANSACTION(
        mockData.internalServerError._status.messages[0].message,
      );
      await expect(contractService.call(callData, 'latest', requestDetails))
        .to.be.rejectedWith(JsonRpcError, expectedError.message)
        .and.to.eventually.have.property('code', expectedError.code);
    });

    it('eth_call with mirrorNode throws 502 Bad Gateway is mapped to COULD_NOT_SIMULATE_TRANSACTION', async function () {
      const callData = {
        ...defaultCallData,
        from: ACCOUNT_ADDRESS_1,
        to: CONTRACT_ADDRESS_2,
        data: CONTRACT_CALL_DATA,
        gas: MAX_GAS_LIMIT,
      };

      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200, JSON.stringify(DEFAULT_CONTRACT_2));
      await mockContractCall({ ...callData, block: 'latest' }, false, 502, mockData.badGateway, requestDetails);

      const expectedError = predefined.COULD_NOT_SIMULATE_TRANSACTION(mockData.badGateway._status.messages[0].message);
      await expect(contractService.call(callData, 'latest', requestDetails))
        .to.be.rejectedWith(JsonRpcError, expectedError.message)
        .and.to.eventually.have.property('code', expectedError.code);
    });

    it('eth_call with mirrorNode throws 503 Service Unavailable is mapped to COULD_NOT_SIMULATE_TRANSACTION', async function () {
      const callData = {
        ...defaultCallData,
        from: ACCOUNT_ADDRESS_1,
        to: CONTRACT_ADDRESS_2,
        data: CONTRACT_CALL_DATA,
        gas: MAX_GAS_LIMIT,
      };

      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200, JSON.stringify(DEFAULT_CONTRACT_2));
      await mockContractCall({ ...callData, block: 'latest' }, false, 503, mockData.serviceUnavailable, requestDetails);

      const expectedError = predefined.COULD_NOT_SIMULATE_TRANSACTION(
        mockData.serviceUnavailable._status.messages[0].message,
      );
      await expect(contractService.call(callData, 'latest', requestDetails))
        .to.be.rejectedWith(JsonRpcError, expectedError.message)
        .and.to.eventually.have.property('code', expectedError.code);
    });

    it('eth_call with mirrorNode throws 504 Gateway Timeout is mapped to COULD_NOT_SIMULATE_TRANSACTION', async function () {
      const callData = {
        ...defaultCallData,
        from: ACCOUNT_ADDRESS_1,
        to: CONTRACT_ADDRESS_2,
        data: CONTRACT_CALL_DATA,
        gas: MAX_GAS_LIMIT,
      };

      restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200, JSON.stringify(DEFAULT_CONTRACT_2));
      await mockContractCall({ ...callData, block: 'latest' }, false, 504, mockData.gatewayTimeout, requestDetails);
      const expectedError = predefined.COULD_NOT_SIMULATE_TRANSACTION(
        mockData.gatewayTimeout._status.messages[0].message,
      );
      await expect(contractService.call(callData, 'latest', requestDetails))
        .to.be.rejectedWith(JsonRpcError, expectedError.message)
        .and.to.eventually.have.property('code', expectedError.code);
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
                message: 'CONTRACT_REVERT_EXECUTED',
                detail: defaultErrorMessageText,
                data: defaultErrorMessageHex,
              },
            ],
          },
        },
        requestDetails,
      );

      const expectedError = predefined.CONTRACT_REVERT(defaultErrorMessageText);
      await expect(ethImpl.call(callData, 'latest', undefined, requestDetails))
        .to.be.rejectedWith(JsonRpcError)
        .and.eventually.satisfy((error: JsonRpcError) => {
          expect(error.code).to.equal(expectedError.code);
          expect(error.message).to.equal(expectedError.message);
          return true;
        });
    });

    it('Mirror Node returns 400 contract revert error with internal transactions details', async function () {
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
                message: 'CONTRACT_REVERT_EXECUTED',
                detail: '',
                data: '0x',
              },
              {
                message: 'TOKEN_NOT_ASSOCIATED_TO_ACCOUNT',
                detail: '',
                data: '',
              },
            ],
          },
        },
        requestDetails,
      );

      const expectedError = predefined.CONTRACT_REVERT('CONTRACT_REVERT_EXECUTED, TOKEN_NOT_ASSOCIATED_TO_ACCOUNT');
      await expect(ethImpl.call(callData, 'latest', undefined, requestDetails))
        .to.be.rejectedWith(JsonRpcError)
        .and.eventually.satisfy((error: JsonRpcError) => {
          expect(error.code).to.equal(expectedError.code);
          expect(error.message).to.equal(expectedError.message);
          return true;
        });
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

      const expectedError = predefined.COULD_NOT_SIMULATE_TRANSACTION(
        mockData.invalidTransaction._status.messages[0].message,
      );
      await expect(contractService.call(callData, 'latest', requestDetails))
        .to.be.rejectedWith(JsonRpcError, expectedError.message)
        .and.to.eventually.have.property('code', expectedError.code);
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
      await expect(contractService.call(callData, 'latest', requestDetails))
        .to.be.rejectedWith(JsonRpcError)
        .and.to.eventually.include({
          code: 3,
          message: 'execution reverted: FAIL_INVALID',
        });
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

    it('should return null when blockParam is null in extractBlockParam', function () {
      const result = contractService['extractBlockParam'](null);
      expect(result).to.be.null;
    });

    it('should return unchanged blockHash when blockHash is passed as a string on extractBlockParam', function () {
      const result = contractService['extractBlockParam'](BLOCKHASH);
      expect(result).to.be.equal(BLOCKHASH);
    });

    it('should return unchanged blockHash when blockHash is passed within an object on extractBlockParam', function () {
      const result = contractService['extractBlockParam']({ blockHash: BLOCKHASH });
      expect(result).to.be.equal(BLOCKHASH);
    });

    it('should throw error when neither block nor hash specified in extractBlockParam', function () {
      expect(() => contractService['extractBlockParam']({})).to.throw(JsonRpcError, 'neither block nor hash specified');
    });

    it('should handle invalid contract address in validateContractAddress', async function () {
      const invalidAddress = '0xinvalid';

      await expect(
        contractService.call(
          {
            from: ACCOUNT_ADDRESS_1,
            to: invalidAddress,
            data: CONTRACT_CALL_DATA,
          },
          'latest',
          requestDetails,
        ),
      )
        .to.be.rejectedWith(JsonRpcError)
        .and.eventually.satisfy((error: JsonRpcError) => {
          expect(error.code).to.equal(-32012);
          expect(error.message).to.contain(`Invalid Contract Address: ${invalidAddress}`);
          return true;
        });
    });

    async function mockContractCall(
      callData: IContractCallRequest,
      estimate: boolean,
      statusCode: number,
      result: IContractCallResponse,
      requestDetails: RequestDetails,
    ): Promise<MockAdapter> {
      const formattedCallData = { ...callData, estimate };
      await contractService['contractCallFormat'](formattedCallData, requestDetails);
      return web3Mock.onPost('contracts/call', formattedCallData).reply(statusCode, JSON.stringify(result));
    }
  });

  describe('contractCallFormat', () => {
    const operatorId = hapiServiceInstance.getOperatorAccountId();
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

    [
      { label: 'not provided', gasPrice: undefined },
      { label: '"0"', gasPrice: '0' },
      { label: 'empty string', gasPrice: '' },
      { label: 'number 0', gasPrice: 0 },
    ].forEach(({ label, gasPrice }) => {
      it(`should NOT populate gasPrice when it is ${label}`, async () => {
        const transaction: IContractCallRequest = {
          value: '0x2540BE400',
          gasPrice,
        };

        await contractService['contractCallFormat'](transaction, requestDetails);
        expect(transaction.gasPrice).to.be.undefined;
      });
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

    describe('formatStateOverrides', () => {
      const ZERO_SLOT = '0x' + '0'.repeat(64);
      const SLOT_3 = '0x' + '0'.repeat(63) + '3';
      const VALUE_1 = '0x' + '0'.repeat(63) + '1';

      it('should convert the address-keyed map into an array with lowercased addresses', () => {
        const result = contractService.formatStateOverrides({
          '0xAbC0000000000000000000000000000000000001': { nonce: '0x1' },
        });

        expect(result).to.deep.equal([{ address: '0xabc0000000000000000000000000000000000001', nonce: '0x1' }]);
      });

      it('should convert balance from weibars to tinybars', () => {
        const result = contractService.formatStateOverrides({ '0x1': { balance: '0x56bc75e2d63100000' } });

        expect(result[0].balance).to.equal('0x2540be400');
      });

      it('should cap a balance above the total supply', () => {
        const result = contractService.formatStateOverrides({ '0x1': { balance: `0x${'f'.repeat(64)}` } });

        expect(result[0].balance).to.equal(numberTo0x(BigInt(constants.TOTAL_SUPPLY_TINYBARS)));
      });

      it('should normalise nonce to minimal hex', () => {
        const result = contractService.formatStateOverrides({ '0x1': { nonce: '0x0000000000000001' } });

        expect(result[0].nonce).to.equal('0x1');
      });

      it('should pass code through unchanged', () => {
        const result = contractService.formatStateOverrides({ '0x1': { code: '0x602a60005260206000f3' } });

        expect(result[0].code).to.equal('0x602a60005260206000f3');
      });

      it('should rename stateDiff and convert its storage map to key/value pairs', () => {
        const result = contractService.formatStateOverrides({ '0x1': { stateDiff: { [SLOT_3]: VALUE_1 } } });

        expect(result[0].state_diff).to.deep.equal([{ key: SLOT_3, value: VALUE_1 }]);
        expect(result[0].state).to.be.undefined;
      });

      it('should convert a populated state map to key/value pairs', () => {
        const result = contractService.formatStateOverrides({ '0x1': { state: { [SLOT_3]: VALUE_1 } } });

        expect(result[0].state).to.deep.equal([{ key: SLOT_3, value: VALUE_1 }]);
      });

      it('should send a zero slot for an empty state map so all storage is replaced', () => {
        const result = contractService.formatStateOverrides({ '0x1': { state: {} } });

        expect(result[0].state).to.deep.equal([{ key: ZERO_SLOT, value: ZERO_SLOT }]);
      });

      it('should send an empty list for an empty stateDiff map', () => {
        const result = contractService.formatStateOverrides({ '0x1': { stateDiff: {} } });

        expect(result[0].state_diff).to.deep.equal([]);
      });

      it('should drop entries that carry no fields', () => {
        const result = contractService.formatStateOverrides({ '0x1': {}, '0x2': { nonce: '0x1' } });

        expect(result).to.deep.equal([{ address: '0x2', nonce: '0x1' }]);
      });

      it('should return an empty array when every entry is dropped', () => {
        expect(contractService.formatStateOverrides({ '0x1': {}, '0x2': {} })).to.deep.equal([]);
      });

      it('should return an empty array for an empty override set', () => {
        expect(contractService.formatStateOverrides({})).to.deep.equal([]);
      });
    });
  });
});
