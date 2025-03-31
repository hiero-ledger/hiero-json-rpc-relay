// SPDX-License-Identifier: Apache-2.0

// external resources
import { predefined } from '@hashgraph/json-rpc-relay/dist';
import { InvalidRequest, MethodNotFound } from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/RpcError';
import { expect } from 'chai';
import { ethers, WebSocketProvider } from 'ethers';
import WebSocket from 'ws';

import { WsTestConstant, WsTestHelper } from '../helper';

describe('@release @web-socket-batch-1 JSON-RPC requests validation', async function () {
  const BLOCK_NUMBER_METHOD_NAME = 'eth_blockNumber';
  const INVALID_REQUESTS = [
    {
      id: '1',
      method: BLOCK_NUMBER_METHOD_NAME,
      params: [],
    },
    {
      id: '1',
      jsonrpc: '2.0',
      params: [],
    },
    {
      id: '1',
      jsonrpc: 'hedera',
      method: BLOCK_NUMBER_METHOD_NAME,
      params: [],
    },
  ];

  const UNSUPPORTED_METHODS = ['eth_getChainId', 'getLogs', 'ethCall', 'blockNum', 'getGasPrice'];

  WsTestHelper.overrideEnvsInMochaDescribe({ REQUEST_ID_IS_OPTIONAL: true });

  let ethersWsProvider: WebSocketProvider;

  beforeEach(async () => {
    ethersWsProvider = new ethers.WebSocketProvider(WsTestConstant.WS_RELAY_URL);
  });

  afterEach(async () => {
    if (ethersWsProvider) await ethersWsProvider.destroy();
  });

  after(async () => {
    // expect all the connections to the WS server to be closed after all
    if (global && global.socketServer) {
      expect(global.socketServer._connections).to.eq(0);
    }
  });

  describe('Request  & Method Validations', () => {
    for (const request of INVALID_REQUESTS) {
      it('Should reject the requests because of the invalid JSON-RPC requests', async () => {
        const webSocket = new WebSocket(WsTestConstant.WS_RELAY_URL);

        let response: any;

        webSocket.on('open', () => {
          webSocket.send(JSON.stringify(request));
        });

        webSocket.on('message', (data: string) => {
          response = JSON.parse(data);
        });

        while (!response) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        const invalidRequest = new InvalidRequest();

        expect(response.error).to.exist;
        expect(response.error.message).to.eq(invalidRequest.message);
        expect(response.error.code).to.eq(invalidRequest.code);

        webSocket.close();
      });
    }

    for (const method of UNSUPPORTED_METHODS) {
      it('Should reject the requests because of the invalid JSON-RPC methods', async () => {
        const response = await WsTestHelper.sendRequestToStandardWebSocket(method, []);

        const methodNotFound = new MethodNotFound(method);
        expect(response.error).to.exist;
        expect(response.error.message).to.eq(methodNotFound.message);
        expect(response.error.code).to.eq(methodNotFound.code);
      });
    }
  });

  describe('Request with undefined params', () => {
    it('Should execute eth_chainId requests with undefined params and receive expected result', async () => {
      const response = await WsTestHelper.sendRequestToStandardWebSocket('eth_chainId', undefined);
      const expectedResult = await global.relay.call('eth_chainId', []);
      expect(response.result).to.eq(expectedResult);
    });

    it('Should execute eth_blockNumber requests with undefined params and receive expected result', async () => {
      const response = await WsTestHelper.sendRequestToStandardWebSocket('eth_blockNumber', undefined);
      const expectedResult = await global.relay.call('eth_blockNumber', []);
      expect(response.result).to.eq(expectedResult);
    });
    it('Should execute eth_sendRawTransaction requests with undefined params and receive MISSING_REQUIRED_PARAMETER error', async () => {
      const response = await WsTestHelper.sendRequestToStandardWebSocket('eth_sendRawTransaction', undefined);
      const expectedResult = predefined.MISSING_REQUIRED_PARAMETER(0);
      delete expectedResult.data;
      expect(response.error).to.exist;
      expect(response.error.message).to.contain(expectedResult.message);
      expect(response.error.code).to.eq(expectedResult.code);
    });
  });
});
