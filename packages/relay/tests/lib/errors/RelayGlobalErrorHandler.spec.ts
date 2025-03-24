// SPDX-License-Identifier: Apache-2.0
import { expect } from 'chai';
import pino from 'pino';
import sinon from 'sinon';

import { JsonRpcError, predefined } from '../../../src/lib/errors/JsonRpcError';
import { MirrorNodeClientError } from '../../../src/lib/errors/MirrorNodeClientError';
import { RelayGlobalErrorHandler } from '../../../src/lib/errors/RelayGlobalErrorHandler';

describe('RelayGlobalErrorHandler', function () {
  let errorHandler: RelayGlobalErrorHandler;
  let logger: pino.Logger;

  beforeEach(function () {
    logger = pino({ level: 'silent' });
    errorHandler = new RelayGlobalErrorHandler(logger);
  });

  afterEach(function () {
    sinon.restore();
  });

  describe('createErrorHandlingProxy', function () {
    // Test data
    const syncSuccessValue = 'success';
    const asyncSuccessValue = 'async success';
    const syncErrorMessage = 'Sync error';
    const asyncErrorMessage = 'Async error';
    const methodName = 'TestService.method';

    // Test methods
    const syncMethodSuccess = () => syncSuccessValue;
    const syncMethodError = () => {
      throw new Error(syncErrorMessage);
    };
    const asyncMethodSuccess = async () => asyncSuccessValue;
    const asyncMethodError = async () => {
      throw new Error(asyncErrorMessage);
    };

    it('should handle synchronous methods that throw errors', function () {
      const wrappedMethod = errorHandler.createErrorHandlingProxy(syncMethodError, `${methodName}Sync`, false);
      const result = wrappedMethod();

      expect(result).to.be.instanceOf(JsonRpcError);
      expect((result as JsonRpcError).message).to.include(syncErrorMessage);
    });

    it('should handle asynchronous methods that throw errors', async function () {
      const wrappedMethod = errorHandler.createErrorHandlingProxy(asyncMethodError, `${methodName}Async`, true);
      const result = await wrappedMethod();

      expect(result).to.be.instanceOf(JsonRpcError);
      expect((result as JsonRpcError).message).to.include(asyncErrorMessage);
    });

    it('should pass through successful synchronous results', function () {
      const wrappedMethod = errorHandler.createErrorHandlingProxy(syncMethodSuccess, `${methodName}Sync`, false);
      const result = wrappedMethod();

      expect(result).to.equal(syncSuccessValue);
    });

    it('should pass through successful asynchronous results', async function () {
      const wrappedMethod = errorHandler.createErrorHandlingProxy(asyncMethodSuccess, `${methodName}Async`, true);
      const result = await wrappedMethod();

      expect(result).to.equal(asyncSuccessValue);
    });
  });

  describe('convertToJsonRpcError', function () {
    it('should return the original error if it is already a JsonRpcError', function () {
      const originalError = predefined.INTERNAL_ERROR('Test error');
      const result = errorHandler.convertToJsonRpcError(originalError, []);

      expect(result).to.equal(originalError);
    });

    it('should map MirrorNodeClientError to appropriate JsonRpcError', function () {
      const mirrorError = new MirrorNodeClientError(
        { message: MirrorNodeClientError.messages.CONTRACT_REVERT_EXECUTED, detail: 'Reverted' },
        400,
      );

      const result = errorHandler.convertToJsonRpcError(mirrorError, []);
      const expectedError = predefined.CONTRACT_REVERT(MirrorNodeClientError.messages.CONTRACT_REVERT_EXECUTED);

      expect(result).to.be.instanceOf(JsonRpcError);
      expect(result.code).to.equal(expectedError.code);
      expect(result.message).to.eq(expectedError.message);
    });

    it('should log unhandled errors with context information', function () {
      const loggerSpy = sinon.spy(logger, 'error');
      const error = new Error('Unknown error');
      const contextInfo = 'TestService.method';

      errorHandler.convertToJsonRpcError(error, [], contextInfo);

      expect(loggerSpy.calledOnce).to.be.true;
    });

    it('should return INTERNAL_ERROR for unhandled errors', function () {
      const error = new Error('Unknown error');
      const result = errorHandler.convertToJsonRpcError(error, []);

      expect(result).to.be.instanceOf(JsonRpcError);
      expect(result.code).to.equal(-32603); // INTERNAL_ERROR code
      expect(result.message).to.include('Unknown error');
    });
  });

  describe('mapMirrorNodeError', function () {
    // Helper function to test error mapping
    const testErrorMapping = (
      errorConfig: { message: string; detail?: string; data?: string },
      statusCode: number,
      expectedErrorCreator: Function,
      expectedStatusCode?: number,
      expectedMessage?: string,
    ) => {
      const mirrorError = new MirrorNodeClientError(errorConfig, statusCode);
      const result = (errorHandler as any).mapMirrorNodeError(mirrorError);

      const expectedError = expectedErrorCreator(
        expectedStatusCode || statusCode,
        expectedMessage || errorConfig.message,
        errorConfig.data,
      );

      expect(result).to.be.instanceOf(JsonRpcError);
      expect(result.code).to.equal(expectedError.code);
      expect(result.message).to.eq(expectedError.message);

      if (errorConfig.data) {
        expect(result.data).to.eq(errorConfig.data);
      }

      return result;
    };

    it('should map contract revert errors correctly', function () {
      testErrorMapping(
        {
          message: MirrorNodeClientError.messages.CONTRACT_REVERT_EXECUTED,
          detail: 'Reverted',
        },
        400,
        (_, message) => predefined.CONTRACT_REVERT(message),
      );
    });

    it('should map rate limit errors correctly', function () {
      const { statusCode, message } = MirrorNodeClientError.HttpStatusResponses.TOO_MANY_REQUESTS;

      testErrorMapping(
        { message: 'Rate limit exceeded' },
        statusCode,
        predefined.MIRROR_NODE_UPSTREAM_FAIL,
        statusCode,
        message,
      );
    });

    it('should map internal server errors correctly', function () {
      const { statusCode, message } = MirrorNodeClientError.HttpStatusResponses.INTERNAL_SERVER_ERROR;

      testErrorMapping(
        { message: 'Internal server error' },
        statusCode,
        predefined.MIRROR_NODE_UPSTREAM_FAIL,
        statusCode,
        message,
      );
    });

    it('should map not supported errors correctly', function () {
      const { statusCode, message } = MirrorNodeClientError.HttpStatusResponses.NOT_SUPPORTED;

      testErrorMapping(
        { message: 'Not supported' },
        statusCode,
        predefined.MIRROR_NODE_UPSTREAM_FAIL,
        statusCode,
        message,
      );
    });

    it('should map bad gateway errors correctly', function () {
      const { statusCode, message } = MirrorNodeClientError.HttpStatusResponses.BAD_GATEWAY;

      testErrorMapping(
        { message: 'Bad gateway' },
        statusCode,
        predefined.MIRROR_NODE_UPSTREAM_FAIL,
        statusCode,
        message,
      );
    });

    it('should map service unavailable errors correctly', function () {
      const { statusCode, message } = MirrorNodeClientError.HttpStatusResponses.SERVICE_UNAVAILABLE;

      testErrorMapping(
        { message: 'Service unavailable' },
        statusCode,
        predefined.MIRROR_NODE_UPSTREAM_FAIL,
        statusCode,
        message,
      );
    });

    it('should map timeout errors correctly', function () {
      const { statusCode, message } = MirrorNodeClientError.HttpStatusResponses.ECONNABORTED;

      testErrorMapping(
        { message: 'Connection timed out' },
        statusCode,
        predefined.MIRROR_NODE_UPSTREAM_FAIL,
        statusCode,
        message,
      );
    });

    it('should map general errors with status code correctly', function () {
      testErrorMapping(
        { message: 'Custom error' },
        418, // I'm a teapot
        predefined.MIRROR_NODE_UPSTREAM_FAIL,
      );
    });
  });
});
