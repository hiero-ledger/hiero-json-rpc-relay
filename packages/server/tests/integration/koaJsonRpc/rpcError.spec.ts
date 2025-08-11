// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { spec } from '../../../src/koaJsonRpc/lib/RpcError';

describe('RpcErrors', () => {
  describe('ParseError', () => {
    it('should create a ParseError with correct message and code', () => {
      expect(spec.ParseError).to.be.deep.equal({
        code: -32700,
        message: 'Parse error',
      });
    });
  });

  describe('InvalidRequest', () => {
    it('should create an InvalidRequest with correct message and code', () => {
      expect(spec.InvalidRequest).to.be.deep.equal({
        code: -32600,
        message: 'Invalid Request',
      });
    });
  });

  describe('MethodNotFound', () => {
    it('should create a MethodNotFound with correct message and code', () => {
      const methodName = 'testMethod';
      expect(spec.MethodNotFound(methodName)).to.be.deep.equal({
        code: -32601,
        message: `Method ${methodName} not found`,
      });
    });
  });

  describe('InternalError', () => {
    it('should create an InternalError with provided error message and code', () => {
      expect(spec.InternalError(new Error('Specific internal error'))).to.be.deep.equal({
        code: -32603,
        message: 'Specific internal error',
      });
    });

    [undefined, null, 'error', 1, {}].forEach((input) => {
      it(`should create an InternalError with default message when input is '${input}'`, function () {
        expect(spec.InternalError(input)).to.be.deep.equal({
          code: -32603,
          message: 'Internal error',
        });
      });
    });
  });

  describe('IPRateLimitExceeded', () => {
    it('should create an IPRateLimitExceeded error with correct message and code', () => {
      const methodName = 'testMethod';
      expect(spec.IPRateLimitExceeded(methodName)).to.be.deep.equal({
        code: -32605,
        message: `IP Rate limit exceeded on ${methodName}`,
      });
    });
  });
});
