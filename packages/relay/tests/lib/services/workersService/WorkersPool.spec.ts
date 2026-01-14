// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { JsonRpcError, MirrorNodeClientError, predefined } from '../../../../dist';
import { WorkersPool } from '../../../../dist/lib/services/workersService/WorkersPool';

describe('WorkersPool Test Suite', () => {
  describe('wrapError', () => {
    it('should wrap an JsonRpcError in Error.message', () => {
      const jsonRpcError = predefined.INSUFFICIENT_ACCOUNT_BALANCE;

      const wrapped = WorkersPool.wrapError(jsonRpcError);
      expect(wrapped).to.be.instanceOf(Error);

      const wrappedParsed = JSON.parse(wrapped.message);
      expect(jsonRpcError.code).to.equal(wrappedParsed.code);
      expect(jsonRpcError.message).to.equal(wrappedParsed.message);
    });
  });

  describe('unwrapError', () => {
    it('should return INTERNAL_ERROR if input is not an Error instance', () => {
      const result = WorkersPool.unwrapError('not-an-error');

      expect(result).to.be.instanceOf(Error);
      expect(result.message).to.include('Failed unwrapping piscina error');
    });

    it('should return INTERNAL_ERROR if Error.message is not valid JSON', () => {
      const err = new Error('this is not json');

      const result = WorkersPool.unwrapError(err);

      expect(result).to.be.instanceOf(Error);
      expect(result.message).to.include('Failed parsing wrapped piscina error');
    });

    it('should unwrap a JsonRpcError correctly', () => {
      const wrapped = new Error(
        JSON.stringify({
          name: JsonRpcError.name,
          message: 'RPC failed',
          code: -32603,
          data: 'extra data',
        }),
      );
      const result = WorkersPool.unwrapError(wrapped);

      expect(result).to.be.instanceOf(JsonRpcError);
      expect(result.message).to.equal('RPC failed');
      expect((result as JsonRpcError).code).to.equal(-32603);
      expect((result as JsonRpcError).data).to.equal('extra data');
    });

    it('should unwrap a MirrorNodeClientError correctly', () => {
      const envelope = {
        name: MirrorNodeClientError.name,
        message: 'Mirror node error',
        statusCode: 404,
        data: 'Not Found',
        detail: 'Account does not exist',
      };

      const wrapped = new Error(JSON.stringify(envelope));
      const result = WorkersPool.unwrapError(wrapped);

      expect(result).to.be.instanceOf(MirrorNodeClientError);
      expect(result.message).to.equal('Mirror node error');
      expect((result as any).statusCode).to.equal(404);
    });

    it('should return INTERNAL_ERROR for unsupported error types', () => {
      const envelope = {
        name: 'UnknownError',
        message: 'Something strange happened',
      };

      const wrapped = new Error(JSON.stringify(envelope));
      const result = WorkersPool.unwrapError(wrapped);

      expect(result).to.be.instanceOf(Error);
      expect(result.message).to.equal(predefined.INTERNAL_ERROR('Failed unwrapping piscina error.').message);
    });
  });
});
