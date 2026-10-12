// SPDX-License-Identifier: Apache-2.0

// external resources
import { expect } from 'chai';

import { type WsJsonRpcRequest, type WsJsonRpcResponse, WsTestHelper } from '../helper';

describe('@web-socket-batch-1 EIP-1898 block identifier objects', async function () {
  const BATCH_REQUEST_METHOD_NAME = 'batch_request';

  let address: string;
  let blockNumber: string;
  let blockHash: string;

  before(async () => {
    address = global.accounts[0].address;
    blockNumber = await global.relay.call('eth_blockNumber', []);
    blockHash = (await global.relay.call('eth_getBlockByNumber', [blockNumber, false])).hash;
  });

  const requestsFor = (blockParam: unknown): WsJsonRpcRequest[] => [
    { id: 1, jsonrpc: '2.0', method: 'eth_getBalance', params: [address, blockParam] },
    { id: 2, jsonrpc: '2.0', method: 'eth_getCode', params: [address, blockParam] },
    { id: 3, jsonrpc: '2.0', method: 'eth_getTransactionCount', params: [address, blockParam] },
    { id: 4, jsonrpc: '2.0', method: 'eth_getStorageAt', params: [address, '0x0', blockParam] },
    { id: 5, jsonrpc: '2.0', method: 'eth_call', params: [{ to: address, data: '0x' }, blockParam] },
  ];

  const sendSingle = (request: WsJsonRpcRequest): Promise<WsJsonRpcResponse> =>
    WsTestHelper.sendRequestToStandardWebSocket(request.method, request.params);

  it('answers {"blockNumber"}, {"blockHash"} and {"blockHash", "requireCanonical"} like the string form', async () => {
    const stringForm = await Promise.all(requestsFor(blockNumber).map(sendSingle));

    for (const objectForm of [{ blockNumber }, { blockHash }, { blockHash, requireCanonical: true }]) {
      const responses = await Promise.all(requestsFor(objectForm).map(sendSingle));

      responses.forEach((response, i) => {
        expect(response.error, `${requestsFor(objectForm)[i].method} ${JSON.stringify(objectForm)}`).to.not.exist;
        expect(response.result).to.deep.equal(stringForm[i].result);
      });
    }
  });

  WsTestHelper.withOverriddenEnvsInMochaTest({ WS_BATCH_REQUESTS_ENABLED: true }, () => {
    it('answers object forms inside a batch like single requests, failing only the malformed entry', async () => {
      const requests: WsJsonRpcRequest[] = [
        ...requestsFor({ blockHash, requireCanonical: true }),
        { id: 6, jsonrpc: '2.0', method: 'eth_getBalance', params: [address, {}] },
        { id: 7, jsonrpc: '2.0', method: 'eth_call', params: [{ to: address }, { blockHash, blockNumber }] },
      ];

      const batchResponses = await WsTestHelper.sendRequestToStandardWebSocket<WsJsonRpcResponse[]>(
        BATCH_REQUEST_METHOD_NAME,
        requests,
      );
      const individualResponses = await Promise.all(requests.map(sendSingle));

      expect(batchResponses.length).to.equal(requests.length);
      batchResponses.forEach((batch, i) => {
        const single = individualResponses[i];
        if (batch.error) {
          expect(batch.error.code).to.equal(single.error!.code);
          expect(batch.error.message.split('] ').pop()).to.equal(single.error!.message.split('] ').pop());
        } else {
          expect(batch.result).to.deep.equal(single.result);
        }
      });

      expect(batchResponses.slice(0, 5).every((response) => !response.error)).to.be.true;
      expect(batchResponses[5].error!.code).to.equal(-32602);
      expect(batchResponses[6].error!.code).to.equal(-32602);
    });
  });
});
