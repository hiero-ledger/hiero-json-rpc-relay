// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import pino from 'pino';
import sinon from 'sinon';

import { MirrorNodeClient } from '../../../src/relay/lib/clients';
import { RequestDetails } from '../../../src/relay/lib/types';
import { WS_CONSTANTS } from '../../../src/ws-server/utils/constants';
import { validateJsonRpcRequest, verifySupportedMethod } from '../../../src/ws-server/utils/utils';
import { validateSubscribeEthLogsParams } from '../../../src/ws-server/utils/validators';
import { contractAddress1, contractAddress2 } from '../../relay/helpers';
import { RPC_METHODS, WsTestHelper } from '../helper';

const logger = pino({ level: 'silent' });

import chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);

describe('validations unit test', async function () {
  const FAKE_REQUEST_ID = '3';
  const FAKE_CONNECTION_ID = '9';
  const requestDetails = new RequestDetails({
    requestId: FAKE_REQUEST_ID,
    ipAddress: '0.0.0.0',
    connectionId: FAKE_CONNECTION_ID,
  });

  it('Should execute validateJsonRpcRequest() to validate valid JSON RPC request and return true', () => {
    const VALID_REQEST = {
      id: 1,
      jsonrpc: '2.0',
      method: 'eth_chainId',
      params: [],
    };

    expect(validateJsonRpcRequest(VALID_REQEST, logger, requestDetails)).to.be.true;
  });

  it('Should execute validateJsonRpcRequest() to validate invalid JSON RPC requests and return false', () => {
    const INVALID_REQUESTS = [
      {
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
      },
      {
        id: 1,
        method: 'eth_chainId',
        params: [],
      },
      {
        id: 1,
        jsonrpc: '2.0',
        params: [],
      },
    ];

    INVALID_REQUESTS.forEach((request) => {
      // @ts-ignore
      expect(validateJsonRpcRequest(request, logger, requestDetails)).to.be.false;
    });
  });

  WsTestHelper.withOverriddenEnvsInMochaTest({ REQUEST_ID_IS_OPTIONAL: 'true' }, () => {
    it('Should execute validateJsonRpcRequest() to validate JSON RPC request that has no id field but return true because REQUEST_ID_IS_OPTIONAL=true', () => {
      const REQUEST = {
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
      };
      // @ts-ignore
      expect(validateJsonRpcRequest(REQUEST, logger, requestDetails)).to.be.true;
    });
  });

  describe('verifySupportedMethod()', () => {
    it('should return true for methods present in the relay registry', () => {
      const mockRelay = {
        rpcMethodRegistry: new Map(RPC_METHODS.REGISTRY_METHODS.map((m) => [m, sinon.stub()])),
      } as any;

      RPC_METHODS.REGISTRY_METHODS.forEach((method) => {
        expect(verifySupportedMethod(mockRelay, method), method).to.be.true;
      });
    });

    it('should return true for WS-only methods eth_subscribe and eth_unsubscribe even when not in registry', () => {
      const mockRelay = { rpcMethodRegistry: new Map() } as any;

      expect(verifySupportedMethod(mockRelay, WS_CONSTANTS.METHODS.ETH_SUBSCRIBE)).to.be.true;
      expect(verifySupportedMethod(mockRelay, WS_CONSTANTS.METHODS.ETH_UNSUBSCRIBE)).to.be.true;
    });

    it('should return false for unknown method names', () => {
      const mockRelay = { rpcMethodRegistry: new Map() } as any;
      const GARBAGE_METHODS = [
        ...RPC_METHODS.UNSUPPORTED_METHODS,
        'eth_contractIdd',
        'eth_getCall',
        'getLogs',
        'blockNum',
        'eth_feehistory',
        'debug_unknownOp',
        'net_unknownMethod',
        'web3_unknownMethod',
      ];

      GARBAGE_METHODS.forEach((method) => {
        expect(verifySupportedMethod(mockRelay, method), method).to.be.false;
      });
    });
  });

  describe('validateSubscribeEthLogsParams', async function () {
    let stubMirrorNodeClient: MirrorNodeClient;
    const requestDetails = new RequestDetails({
      requestId: '3',
      ipAddress: '0.0.0.0',
      connectionId: '9',
    });

    beforeEach(() => {
      stubMirrorNodeClient = sinon.createStubInstance(MirrorNodeClient);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should throw error if passed address as string is non-existing', async function () {
      stubMirrorNodeClient.resolveEntityType.returns(false);

      await expect(
        validateSubscribeEthLogsParams(
          {
            address: contractAddress1,
          },
          stubMirrorNodeClient,
          requestDetails,
        ),
      ).to.be.eventually.rejected.and.have.property('code', -32602);
    });

    it('should throw error if passed address as array is non-existing', async function () {
      stubMirrorNodeClient.resolveEntityType.returns(false);

      await expect(
        validateSubscribeEthLogsParams(
          {
            address: [contractAddress1, contractAddress2],
          },
          stubMirrorNodeClient,
          requestDetails,
        ),
      ).to.be.eventually.rejected.and.have.property('code', -32602);
    });

    it('should be able to pass address as a string', async function () {
      stubMirrorNodeClient.resolveEntityType.returns(true);

      await validateSubscribeEthLogsParams(
        {
          address: contractAddress1,
        },
        stubMirrorNodeClient,
        requestDetails,
      );
    });

    it('should be able to pass address as an array', async function () {
      stubMirrorNodeClient.resolveEntityType.returns(true);

      await validateSubscribeEthLogsParams(
        {
          address: [contractAddress1],
        },
        stubMirrorNodeClient,
        requestDetails,
      );
    });
  });
});
