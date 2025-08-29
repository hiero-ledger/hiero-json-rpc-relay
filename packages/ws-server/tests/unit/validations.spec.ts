// SPDX-License-Identifier: Apache-2.0

import { MirrorNodeClient } from '@hashgraph/json-rpc-relay/dist/lib/clients';
import { RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';
import { expect } from 'chai';
import pino from 'pino';
import sinon from 'sinon';

import { contractAddress1 } from '../../../relay/tests/helpers';
import Assertions from '../../../server/tests/helpers/assertions';
import { validateSubscribeEthLogsParams } from '../../dist/utils/validators';
import { WS_CONSTANTS } from '../../src/utils/constants';
import { validateJsonRpcRequest, verifySupportedMethod } from '../../src/utils/utils';
import { WsTestHelper } from '../helper';

const logger = pino({ level: 'silent' });

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

  it("Should execute verifySupportedMethod() to validate requests' methods and return true if methods are supported", () => {
    const SUPPORTED_METHODS = Object.keys(WS_CONSTANTS.METHODS);

    SUPPORTED_METHODS.forEach((method) => {
      expect(verifySupportedMethod(method)).to.be.true;
    });
  });

  it("Should execute verifySupportedMethod() to validate requests' methods and return false if methods are not supported", () => {
    const UNSUPPORTED_METHODS = ['eth_contractIdd', 'eth_getCall', 'getLogs', 'blockNum'];

    UNSUPPORTED_METHODS.forEach((method) => {
      expect(verifySupportedMethod(method)).to.be.false;
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

      try {
        await validateSubscribeEthLogsParams(
          {
            address: contractAddress1,
          },
          stubMirrorNodeClient,
          requestDetails,
        );
        Assertions.expectedError();
      } catch (e) {
        expect(e.code).to.equal(-32602);
      }
    });

    it('should throw error if passed address as array is non-existing', async function () {
      stubMirrorNodeClient.resolveEntityType.returns(false);

      try {
        await validateSubscribeEthLogsParams(
          {
            address: [contractAddress1],
          },
          stubMirrorNodeClient,
          requestDetails,
        );
        Assertions.expectedError();
      } catch (e) {
        expect(e.code).to.equal(-32602);
      }
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
