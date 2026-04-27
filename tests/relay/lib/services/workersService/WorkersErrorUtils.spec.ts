// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import * as sinon from 'sinon';

import { JsonRpcError, MirrorNodeClientError, predefined } from '../../../../../src/relay';
import { unwrapError, wrapError } from '../../../../../src/relay/lib/services/workersService/WorkersErrorUtils';

describe('WorkersErrorUtils Test Suite', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('wrapError', () => {
    it('should return the original error unchanged when called outside a worker context', () => {
      // On the main thread, parentPort is null and serialization is intentionally skipped.
      // wrapError must preserve the original reference so callers relying on instanceof
      // checks or prototype-chain features continue to work correctly.
      const jsonRpcError = predefined.INSUFFICIENT_ACCOUNT_BALANCE;

      const result = wrapError(jsonRpcError);

      expect(result).to.equal(jsonRpcError);
    });

    it('should return a JSON-encoded Error when called inside a worker context', () => {
      // Stub parentPort to simulate being inside a worker thread.
      // Core module exports accessed via ESM 'import *' are often read-only, but the
      // CommonJS 'require' cache still holds the mutable module object in Node.js.
      const wt = 'worker_threads';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const workerThreads = require(wt);
      sinon.stub(workerThreads, 'parentPort').value({ postMessage: () => {} });

      const originalError = new JsonRpcError({ code: -32000, message: 'worker error', data: 'some data' });
      const result = wrapError(originalError);

      expect(result).to.be.instanceOf(Error);
      const parsed = JSON.parse((result as Error).message);
      expect(parsed.name).to.equal(JsonRpcError.name);
      expect(parsed.code).to.equal(originalError.code);
      expect(parsed.message).to.equal(originalError.message);
      expect(parsed.data).to.equal(originalError.data);
    });
  });

  describe('unwrapError', () => {
    it('should return INTERNAL_ERROR if input is not an Error instance', () => {
      const result = unwrapError('not-an-error');

      expect(result).to.be.instanceOf(Error);
      expect(result.message).to.include('Failed unwrapping piscina error');
    });

    it('should return INTERNAL_ERROR when the input is null', () => {
      const result = unwrapError(null);

      expect(result).to.be.instanceOf(Error);
      expect(result.message).to.include('value is not an Error instance');
    });

    it('should return INTERNAL_ERROR when Error.message is not valid JSON', () => {
      const result = unwrapError(new Error('this is not json'));

      expect(result).to.be.instanceOf(Error);
      expect(result.message).to.include('Failed parsing wrapped piscina error');
    });

    it('should return INTERNAL_ERROR when Error.message is an empty string', () => {
      const result = unwrapError(new Error(''));

      expect(result).to.be.instanceOf(Error);
      expect(result.message).to.include('Failed parsing wrapped piscina error');
    });

    describe('JsonRpcError', () => {
      it('should reconstruct a JsonRpcError with all fields', () => {
        const wrapped = new Error(
          JSON.stringify({ name: JsonRpcError.name, message: 'RPC failed', code: -32603, data: 'extra data' }),
        );

        const result = unwrapError(wrapped);

        expect(result).to.be.instanceOf(JsonRpcError);
        expect(result.message).to.equal('RPC failed');
        expect((result as JsonRpcError).code).to.equal(-32603);
        expect((result as JsonRpcError).data).to.equal('extra data');
      });

      it('should reconstruct a JsonRpcError when the optional data field is absent', () => {
        const wrapped = new Error(JSON.stringify({ name: JsonRpcError.name, message: 'simple error', code: -32000 }));

        const result = unwrapError(wrapped);

        expect(result).to.be.instanceOf(JsonRpcError);
        expect((result as JsonRpcError).code).to.equal(-32000);
        expect((result as JsonRpcError).data).to.be.undefined;
      });

      it('should return INTERNAL_ERROR when the JsonRpcError envelope is missing a numeric code', () => {
        const wrapped = new Error(JSON.stringify({ name: JsonRpcError.name, message: 'oops' }));

        const result = unwrapError(wrapped);

        expect(result).to.be.instanceOf(Error);
        expect(result.message).to.include('missing numeric code');
      });

      it('should return INTERNAL_ERROR when code is a non-numeric value', () => {
        const wrapped = new Error(JSON.stringify({ name: JsonRpcError.name, message: 'oops', code: 'bad' }));

        const result = unwrapError(wrapped);

        expect(result).to.be.instanceOf(Error);
        expect(result.message).to.include('missing numeric code');
      });

      it('should correctly roundtrip a JsonRpcError through the serialize/deserialize cycle', () => {
        // Simulates the full worker→main-thread error transport path: wrapError serialises
        // in the worker (represented here by manual JSON.stringify via toJSON), unwrapError
        // reconstructs on the main thread.
        const original = new JsonRpcError({ code: -32000, message: 'roundtrip', data: 'payload' });
        const wrapped = new Error(JSON.stringify(original));

        const reconstructed = unwrapError(wrapped) as JsonRpcError;

        expect(reconstructed).to.be.instanceOf(JsonRpcError);
        expect(reconstructed.code).to.equal(original.code);
        expect(reconstructed.message).to.equal(original.message);
        expect(reconstructed.data).to.equal(original.data);
      });
    });

    describe('MirrorNodeClientError', () => {
      it('should reconstruct a MirrorNodeClientError with all fields', () => {
        const wrapped = new Error(
          JSON.stringify({
            name: MirrorNodeClientError.name,
            message: 'Mirror node error',
            statusCode: 404,
            data: 'Not Found',
            detail: 'Account does not exist',
          }),
        );

        const result = unwrapError(wrapped) as MirrorNodeClientError;

        expect(result).to.be.instanceOf(MirrorNodeClientError);
        expect(result.message).to.equal('Mirror node error');
        expect(result.statusCode).to.equal(404);
        expect(result.data).to.equal('Not Found');
        expect(result.detail).to.equal('Account does not exist');
      });

      it('should reconstruct a MirrorNodeClientError when optional data and detail are absent', () => {
        const wrapped = new Error(
          JSON.stringify({ name: MirrorNodeClientError.name, message: 'minimal', statusCode: 503 }),
        );

        const result = unwrapError(wrapped) as MirrorNodeClientError;

        expect(result).to.be.instanceOf(MirrorNodeClientError);
        expect(result.statusCode).to.equal(503);
        expect(result.data).to.be.undefined;
        expect(result.detail).to.be.undefined;
      });

      it('should return INTERNAL_ERROR when the MirrorNodeClientError envelope is missing a numeric statusCode', () => {
        const wrapped = new Error(JSON.stringify({ name: MirrorNodeClientError.name, message: 'oops' }));

        const result = unwrapError(wrapped);

        expect(result).to.be.instanceOf(Error);
        expect(result.message).to.include('missing numeric statusCode');
      });

      it('should return INTERNAL_ERROR when statusCode is a non-numeric value', () => {
        const wrapped = new Error(
          JSON.stringify({ name: MirrorNodeClientError.name, message: 'oops', statusCode: 'bad' }),
        );

        const result = unwrapError(wrapped);

        expect(result).to.be.instanceOf(Error);
        expect(result.message).to.include('missing numeric statusCode');
      });

      it('should correctly roundtrip a MirrorNodeClientError through the serialize/deserialize cycle', () => {
        // MirrorNodeClientError.toJSON() emits { statusCode, data, detail, message, name }.
        const original = MirrorNodeClientError.fromJSON(429, 'rate limit exceeded', 'retry-after: 60', 'slow down');
        const wrapped = new Error(JSON.stringify(original));

        const reconstructed = unwrapError(wrapped) as MirrorNodeClientError;

        expect(reconstructed).to.be.instanceOf(MirrorNodeClientError);
        expect(reconstructed.message).to.equal(original.message);
        expect(reconstructed.statusCode).to.equal(original.statusCode);
        expect(reconstructed.data).to.equal(original.data);
        expect(reconstructed.detail).to.equal(original.detail);
      });
    });

    it('should return INTERNAL_ERROR for an unrecognised error type', () => {
      const wrapped = new Error(JSON.stringify({ name: 'UnknownError', message: 'something strange' }));

      const result = unwrapError(wrapped);

      expect(result).to.be.instanceOf(Error);
      expect(result.message).to.equal(predefined.INTERNAL_ERROR('Failed unwrapping piscina error.').message);
    });

    it('should return INTERNAL_ERROR when the name field is null', () => {
      const wrapped = new Error(JSON.stringify({ name: null, message: 'no name' }));

      const result = unwrapError(wrapped);

      expect(result).to.be.instanceOf(Error);
      expect(result.message).to.include('Failed unwrapping piscina error');
    });
  });
});
