// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { jsonRespError, jsonRespResult } from '../../../src/koaJsonRpc/lib/RpcResponse';

describe('RpcResponse', function () {
  describe('jsonRespResult', function () {
    it('should return a valid JSON-RPC response with result', () => {
      const response = jsonRespResult(1, { key: 'value' });
      expect(response).to.be.deep.equal({
        jsonrpc: '2.0',
        id: 1,
        result: { key: 'value' },
      });
    });

    it('should return a valid JSON-RPC response with `null` result', () => {
      const response = jsonRespResult(2, null);
      expect(response).to.be.deep.equal({
        jsonrpc: '2.0',
        id: 2,
        result: null,
      });
    });

    it('should throw a TypeError for invalid id type', () => {
      const result = { key: 'value' };
      // @ts-expect-error: Argument of type '{}' is not assignable to parameter of type 'string | number | null'.
      expect(() => jsonRespResult({}, result)).to.throw(TypeError, 'Invalid id type object');
    });

    it('should handle null id and return a valid response', () => {
      const result = { key: 'value' };

      const response = jsonRespResult(null, result);

      expect(response).to.deep.equal({
        jsonrpc: '2.0',
        id: null,
        result: { key: 'value' },
      });
    });

    it('should handle string id and return a valid response', () => {
      const result = { key: 'value' };

      const response = jsonRespResult('request-1', result);

      expect(response).to.deep.equal({
        jsonrpc: '2.0',
        id: 'request-1',
        result: { key: 'value' },
      });
    });
  });

  describe('jsonRespError', function () {
    it('should return a valid JSON-RPC response with error', () => {
      const response = jsonRespError(1, { code: 123, message: 'An error occurred' }, 'req-123');

      expect(response).to.deep.equal({
        jsonrpc: '2.0',
        id: 1,
        error: { code: 123, data: undefined, message: '[Request ID: req-123] An error occurred' },
      });
    });

    it('should throw a TypeError for invalid id type ', () => {
      const error = { code: 123, message: 'An error occurred' };
      expect(() => jsonRespError({} as any, error, '')).to.throw(TypeError, 'Invalid id type object');
    });

    it('should throw a TypeError for invalid error code type', () => {
      const id = 1;
      const error = { code: 'invalid_code', message: 'An error occurred' };

      expect(() => jsonRespError(id, error as any, '')).to.throw(TypeError, 'Invalid error code type string');
    });

    it('should throw a TypeError for invalid error message type', () => {
      const id = 1;
      const error = { code: 123, message: 456 };

      expect(() => jsonRespError(id, error as any, '')).to.throw(TypeError, 'Invalid error message type number');
    });
  });
});
