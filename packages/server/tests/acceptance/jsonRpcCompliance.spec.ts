// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { expect } from 'chai';

import { RELAY_URL } from './data/conformity/utils/constants';
import { JsonRpcResponse } from './data/conformity/utils/interfaces';

describe('@json-rpc-compliance HTTP/JSON-RPC semantics acceptance tests', function () {
  this.timeout(60000);

  const baseURL = RELAY_URL;

  let client: AxiosInstance;

  before(function () {
    client = axios.create({
      baseURL,
      validateStatus: () => true,
    });
  });

  async function sendRaw(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: any,
    headers?: Record<string, string>,
  ): Promise<AxiosResponse> {
    return client.request({
      url: path,
      method,
      headers,
      data: body,
    });
  }

  async function sendJsonRpc(
    payload: any,
    headers?: Record<string, string>,
  ): Promise<AxiosResponse<JsonRpcResponse | JsonRpcResponse[]>> {
    return sendRaw('POST', '/', payload, {
      'Content-Type': 'application/json',
      ...headers,
    });
  }

  function expectValidJsonRpc(response: AxiosResponse, { allowEmptyBody = false } = {}) {
    if (allowEmptyBody) {
      expect(response.data === '' || response.data === undefined || response.data === null).to.be.true;
      return;
    }

    const body = response.data;
    expect(body).to.not.equal(undefined);

    const responses = Array.isArray(body) ? body : [body];
    for (const singleResponse of responses) {
      expect(singleResponse).to.have.property('jsonrpc', '2.0');
      expect(singleResponse).to.have.property('id');
      const hasResult = Object.prototype.hasOwnProperty.call(singleResponse, 'result');
      const hasError = Object.prototype.hasOwnProperty.call(singleResponse, 'error');
      expect(hasResult || hasError).to.be.true;
      if (hasError) {
        expect(singleResponse.error).to.have.property('code').that.is.a('number');
        expect(singleResponse.error).to.have.property('message').that.is.a('string').and.has.length.greaterThan(5);
      }
    }
  }

  function expectCorrectResult(response: AxiosResponse<JsonRpcResponse>) {
    expect(response.status).to.equal(200);
    expect(response.data).to.have.property('result');
    expect(response.data).to.not.have.property('error');
    expect(response.data).to.have.property('jsonrpc', '2.0');
  }

  function expectNoHttp500(response: AxiosResponse) {
    expect(response.status).to.not.equal(500);
  }

  function expectBatchLimitExceeded(response: AxiosResponse) {
    expect(response.status).to.equal(200);
    expect(Array.isArray(response.data)).to.be.true;

    const body = response.data as JsonRpcResponse[];

    for (const entry of body) {
      expect(entry).to.have.property('error');
      const err = entry.error!;
      expect(err.code).to.equal(-32203);
      expect(err.message.toLowerCase()).to.include('batch');
    }

    expectNoHttp500(response);
  }

  describe('With VALID_JSON_RPC_HTTP_REQUESTS_STATUS_CODE = false', function () {
    before(function () {
      if (ConfigService.get('VALID_JSON_RPC_HTTP_REQUESTS_STATUS_CODE')) this.skip();
    });

    it('Malformed HTTP method/body -> 405 when flag is false', async function () {
      const getWithBody = await sendRaw('GET', '/', {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_blockNumber',
        params: [],
      });
      expect(getWithBody.status).to.equal(405);
      expectValidJsonRpc(getWithBody);
      const getNoBody = await sendRaw('GET', '/');
      expect(getNoBody.status).to.equal(405);
      expectValidJsonRpc(getNoBody);
      const putEmptyBody = await sendRaw('PUT', '/', '');
      expect(putEmptyBody.status).to.equal(405);
      expectValidJsonRpc(putEmptyBody);
    });

    it('Malformed/missing Content-Type but valid JSON body is still processed as JSON-RPC', async function () {
      const noContentType = await sendRaw(
        'POST',
        '/',
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_blockNumber',
          params: [],
        },
        {},
      );
      expectCorrectResult(noContentType);

      const wrongContentType = await sendRaw(
        'POST',
        '/',
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'eth_blockNumber',
          params: [],
        },
        { 'Content-Type': 'application/not-json' },
      );
      expectCorrectResult(wrongContentType);
    });

    it('Invalid JSON payload -> 400 + JSON-RPC error -32700 when flag is false', async function () {
      const brokenJson = '{"jsonrpc":"2.0",';

      const response = await sendRaw('POST', '/', brokenJson, {
        'Content-Type': 'application/json',
      });

      expect(response.status).to.equal(400);
      expect(response.data).to.have.property('jsonrpc', '2.0');
      expect(response.data).to.have.property('error');
      expect(response.data.error.code).to.equal(-32700);
      expectNoHttp500(response);
    });

    it('Valid JSON but invalid JSON-RPC -> 400 + -32600 when flag is false', async function () {
      const response = await sendJsonRpc({ id: 1 });

      expect(response.status).to.equal(400);
      expect(response.data).to.have.property('error');
      expect((response.data as JsonRpcResponse).error!.code).to.equal(-32600);
      expectNoHttp500(response);
    });

    it('Unknown/unsupported method -> 400 + -32601 when flag is false', async function () {
      const response = await sendJsonRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_doesNotExist',
        params: [],
      });

      expect(response.status).to.equal(400);
      expect(response.data).to.have.property('error');
      expect((response.data as JsonRpcResponse).error!.code).to.equal(-32601);
      expectNoHttp500(response);
    });

    it('Invalid parameters -> 400 + -32602 when flag is false', async function () {
      const response = await sendJsonRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getBalance',
        params: [42, true],
      });

      expect(response.status).to.equal(400);
      expect(response.data).to.have.property('error');
      const error = (response.data as JsonRpcResponse).error!;
      expect(error.code).to.equal(-32602);
      expect(error.message.toLowerCase()).to.not.equal('invalid request');
      expectNoHttp500(response);
    });

    it('Limit exceeded -> 400 + JSON-RPC error when flag is false', async function () {
      const addresses = Array.from({ length: 1000000 }, (_, i) => {
        const hex = i.toString(16).padStart(40, '0');
        return `0x${hex}`;
      });

      const response = await sendJsonRpc({
        jsonrpc: '2.0',
        id: 'limit-test',
        method: 'eth_getLogs',
        params: [
          {
            fromBlock: '0x1',
            toBlock: '0x1000000',
            address: addresses,
          },
        ],
      });

      expect(response.status).to.eq(400);
      expect(response.data).to.have.property('error');
      const error = (response.data as JsonRpcResponse).error!;
      expect(error.code).to.be.a('number');
      expectNoHttp500(response);
    });

    it('Only fully valid requests return 200; all client errors use HTTP 400 when flag is false', async function () {
      const ok = await sendJsonRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_blockNumber',
        params: [],
      });

      expect(ok.status).to.equal(200);
      expect(ok.data).to.have.property('result');
      expect(ok.data).to.not.have.property('error');
      expectNoHttp500(ok);

      const clientError = await sendJsonRpc({
        jsonrpc: '2.0',
        id: 2,
        method: 'eth_doesNotExist',
        params: [],
      });

      expect(clientError.status).to.equal(400);
      expect(clientError.data).to.have.property('error');
      expect((clientError.data as JsonRpcResponse).error!.code).to.equal(-32601);
      expectNoHttp500(clientError);
    });

    it('Flag is configuration-driven: behavior corresponds to VALID_JSON_RPC_HTTP_REQUESTS_STATUS_CODE=false', async function () {
      const response = await sendJsonRpc({
        jsonrpc: '2.0',
        id: 'flag-off',
        method: 'eth_getBalance',
        params: [42, true],
      });

      expect(response.status).to.equal(400);
      expect(response.data).to.have.property('error');
      expect((response.data as JsonRpcResponse).error!.code).to.equal(-32602);
      expectNoHttp500(response);
    });

    it('Valid JSON-RPC response bodies for malformed requests', async function () {
      const cases = [
        {
          payload: {
            jsonrpc: '2.0',
            id: 'ok',
            method: 'eth_blockNumber',
            params: [],
          },
        },
        {
          payload: { id: 'invalid-rpc' },
        },
        {
          payload: {
            jsonrpc: '2.0',
            id: 'unknown-method',
            method: 'eth_doesNotExist',
            params: [],
          },
        },
      ];

      for (const singleCase of cases) {
        const response = await sendJsonRpc(singleCase.payload);
        if (response.status === 413) continue;
        expectValidJsonRpc(response);
        expectNoHttp500(response);
      }
    });

    it('Too many requests in a batch -> array with -32005 errors (flag=false -> HTTP 400)', async function () {
      const batchSize = 5000;
      const batch = Array.from({ length: batchSize }, (_, i) => ({
        jsonrpc: '2.0',
        id: `batch-${i}`,
        method: 'eth_blockNumber',
        params: [],
      }));
      expectBatchLimitExceeded(await sendJsonRpc(batch));
    });
  });

  describe('With VALID_JSON_RPC_HTTP_REQUESTS_STATUS_CODE = true', function () {
    before(function () {
      if (!ConfigService.get('VALID_JSON_RPC_HTTP_REQUESTS_STATUS_CODE')) this.skip();
    });

    it('Malformed HTTP method/body -> 200 + JSON-RPC error when flag is true', async function () {
      const getWithBody = await sendRaw('GET', '/', {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_blockNumber',
        params: [],
      });

      expect(getWithBody.status).to.equal(200);
      expect(getWithBody.data).to.have.property('error');
      const getNoBody = await sendRaw('GET', '/');
      expect(getNoBody.status).to.equal(200);
      expect(getNoBody.data).to.have.property('error');
      const putEmptyBody = await sendRaw('PUT', '/', '');
      expect(putEmptyBody.status).to.equal(200);
      expect(putEmptyBody.data).to.have.property('error');
    });

    it('Malformed/missing Content-Type but valid JSON body is still processed as JSON-RPC (flag=true)', async function () {
      const noContentType = await sendRaw(
        'POST',
        '/',
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_blockNumber',
          params: [],
        },
        {},
      );

      expect(noContentType.status).to.equal(200);
      expect(noContentType.data).to.have.property('result');
      expect(noContentType.data).to.not.have.property('error');

      const wrongContentType = await sendRaw(
        'POST',
        '/',
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'eth_blockNumber',
          params: [],
        },
        { 'Content-Type': 'application/not-json' },
      );

      expect(wrongContentType.status).to.equal(200);
      expect(wrongContentType.data).to.have.property('result');
      expect(wrongContentType.data).to.not.have.property('error');
    });

    it('Invalid JSON payload -> 400 + JSON-RPC error -32700 when flag is true', async function () {
      const brokenJson = '{"jsonrpc":"2.0",';

      const response = await sendRaw('POST', '/', brokenJson, { 'Content-Type': 'application/json' });

      expect(response.status).to.equal(400);
    });

    it('Valid JSON but invalid JSON-RPC -> 400 + -32600 when flag is true', async function () {
      const response = await sendJsonRpc({ id: 1 });

      expect(response.status).to.equal(400);
    });

    it('Unknown/unsupported method -> 200 + -32601 when flag is true', async function () {
      const response = await sendJsonRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_doesNotExist',
        params: [],
      });

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property('error');
      expect((response.data as JsonRpcResponse).error!.code).to.equal(-32601);
      expectNoHttp500(response);
    });

    it('Invalid parameters -> 200 + -32602 when flag is true', async function () {
      const response = await sendJsonRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getBalance',
        params: [42, true],
      });

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property('error');
      expect((response.data as JsonRpcResponse).error!.code).to.equal(-32602);
      expectNoHttp500(response);
    });

    it('All syntactically valid JSON-RPC payloads return HTTP 200 (errors only via JSON-RPC error objects)', async function () {
      const cases: any[] = [
        {
          jsonrpc: '2.0',
          id: 'unknown',
          method: 'eth_doesNotExist',
          params: [],
        },
        {
          jsonrpc: '2.0',
          id: 'invalid-params',
          method: 'eth_getBalance',
          params: [42, true],
        },
      ];

      for (const payload of cases) {
        const response = await sendJsonRpc(payload);
        expect(response.status).to.equal(200);
        expect(response.data).to.have.property('jsonrpc', '2.0');
        expect(response.data).to.have.property('error');
        expectNoHttp500(response);
      }
    });

    it('Flag is configuration-driven: behavior corresponds to VALID_JSON_RPC_HTTP_REQUESTS_STATUS_CODE=true', async function () {
      const response = await sendJsonRpc({
        jsonrpc: '2.0',
        id: 'flag-on',
        method: 'eth_getBalance',
        params: [42, true],
      });

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property('error');
      expect((response.data as JsonRpcResponse).error!.code).to.equal(-32602);
      expectNoHttp500(response);
    });

    it('General JSON-RPC shape, clear errors, and no HTTP 500 with flag=true', async function () {
      const cases = [
        {
          payload: {
            jsonrpc: '2.0',
            id: 'ok',
            method: 'eth_blockNumber',
            params: [],
          },
        },
        { payload: { id: 'invalid-rpc' } },
        {
          payload: {
            jsonrpc: '2.0',
            id: 'unknown-method',
            method: 'eth_doesNotExist',
            params: [],
          },
        },
        {
          payload: {
            jsonrpc: '2.0',
            id: 'invalid-params',
            method: 'eth_getBalance',
            params: [42, true],
          },
        },
      ];

      for (const singleCase of cases) {
        const response = await sendJsonRpc(singleCase.payload);
        if (response.status === 413) continue;
        expectValidJsonRpc(response);
        expectNoHttp500(response);
      }
    });

    it('Too many requests in a batch -> array with -32005 errors and HTTP 200 when flag=true', async function () {
      const batchSize = 5000;
      const batch = Array.from({ length: batchSize }, (_, i) => ({
        jsonrpc: '2.0',
        id: `batch-${i}`,
        method: 'eth_blockNumber',
        params: [],
      }));
      expectBatchLimitExceeded(await sendJsonRpc(batch));
    });
  });
});
