// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import pino from 'pino';
import sinon from 'sinon';

import { RpcMethodDispatcher } from '../../../src/lib/dispatcher/rpcMethodDispatcher';
import { JsonRpcError, predefined } from '../../../src/lib/errors/JsonRpcError';
import { MirrorNodeClientError } from '../../../src/lib/errors/MirrorNodeClientError';
import { SDKClientError } from '../../../src/lib/errors/SDKClientError';
import { RequestDetails, RpcMethodRegistry } from '../../../src/lib/types';
import * as Validator from '../../../src/lib/validators';
import { Utils } from '../../../src/utils';

chai.use(chaiAsPromised);

describe('RpcMethodDispatcher', () => {
  // Test fixtures
  const TEST_METHOD_NAME = 'test_method';
  const TEST_PARAMS = ['param1', 'param2'];
  const TEST_PARAMS_REARRANGED = ['rearranged1', 'rearranged2'];
  const TEST_PARAMS_REARRANGED_DEFAULT = ['default1', 'default2'];
  const TEST_RESULT = { success: true };
  const TEST_REQUEST_ID = '123456';
  const TEST_REQUEST_DETAILS: RequestDetails = {
    requestId: TEST_REQUEST_ID,
    formattedRequestId: `[Request ID: ${TEST_REQUEST_ID}]`,
    ipAddress: '127.0.0.1',
    formattedConnectionId: 'connection-123',
    formattedLogPrefix: 'test',
  };
  const logger = pino({ level: 'silent' });

  // Mocks and stubs
  let methodRegistry: RpcMethodRegistry;
  let operationHandler: sinon.SinonStub;
  let validateParamsStub: sinon.SinonStub;
  let arrangeRpcParamsStub: sinon.SinonStub;

  // System under test
  let dispatcher: RpcMethodDispatcher;

  beforeEach(() => {
    // Set up registry mock
    methodRegistry = new Map();
    operationHandler = sinon.stub().resolves(TEST_RESULT);
    methodRegistry.set(TEST_METHOD_NAME, operationHandler);

    // Set up Validator mock
    validateParamsStub = sinon.stub(Validator, 'validateParams');

    // Set up args rearrangement mock
    arrangeRpcParamsStub = sinon.stub(Utils, 'arrangeRpcParams');
    arrangeRpcParamsStub.callsFake((method) => {
      if (method.name === 'functionStub') {
        return TEST_PARAMS_REARRANGED;
      }
      return TEST_PARAMS_REARRANGED_DEFAULT;
    });

    // Create the system under test
    dispatcher = new RpcMethodDispatcher(methodRegistry, logger);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('dispatch()', () => {
    it('should execute the complete dispatch flow and return result', async () => {
      // Spy on private methods to verify they are called
      const validateSpy = sinon.spy(dispatcher as any, 'precheckRpcMethod');
      const processSpy = sinon.spy(dispatcher as any, 'processRpcMethod');

      const result = await dispatcher.dispatch(TEST_METHOD_NAME, TEST_PARAMS, TEST_REQUEST_DETAILS);

      // Verify the dispatch flow
      expect(validateSpy.calledOnce).to.be.true;
      expect(validateSpy.calledWith(TEST_METHOD_NAME, TEST_PARAMS, TEST_REQUEST_DETAILS)).to.be.true;

      expect(processSpy.calledOnce).to.be.true;
      expect(processSpy.calledWith(operationHandler, TEST_PARAMS, TEST_REQUEST_DETAILS)).to.be.true;

      // Verify the final result
      expect(result).to.equal(TEST_RESULT);
    });

    it('should handle and format errors from any phase of dispatch', async () => {
      // Make validation throw an error
      const testError = new JsonRpcError({ code: -32000, message: 'Validation error' });
      sinon.stub(dispatcher as any, 'precheckRpcMethod').throws(testError);

      // Spy on error handler to verify it's called
      const errorHandlerSpy = sinon.spy(dispatcher as any, 'handleRpcMethodError');

      const result = await dispatcher.dispatch(TEST_METHOD_NAME, TEST_PARAMS, TEST_REQUEST_DETAILS);

      // Verify error handling flow
      expect(errorHandlerSpy.calledOnce).to.be.true;
      expect(errorHandlerSpy.calledWith(testError, TEST_METHOD_NAME, TEST_REQUEST_DETAILS)).to.be.true;

      // Verify the error result
      expect(result).to.be.instanceOf(JsonRpcError);
      expect(result.code).to.equal(-32000);
      expect(result.message).to.equal(`${TEST_REQUEST_DETAILS.formattedRequestId} Validation error`);
    });
  });

  describe('precheckRpcMethod()', () => {
    it('should return the operation handler when method is registered', () => {
      const result = (dispatcher as any).precheckRpcMethod(TEST_METHOD_NAME, TEST_PARAMS, TEST_REQUEST_DETAILS);

      expect(result).to.equal(operationHandler);
    });

    it('should validate parameters when schema exists', () => {
      // Set up validation schema
      const validationRules = { 0: { type: 'string', required: true } };
      operationHandler[Validator.RPC_PARAM_VALIDATION_RULES_KEY] = validationRules;

      (dispatcher as any).precheckRpcMethod(TEST_METHOD_NAME, TEST_PARAMS, TEST_REQUEST_DETAILS);

      expect(validateParamsStub.calledOnce).to.be.true;
      expect(validateParamsStub.calledWith(TEST_PARAMS, validationRules)).to.be.true;
    });

    it('should skip validation when no schema exists', () => {
      // Ensure there's no validation schema
      delete operationHandler[Validator.RPC_PARAM_VALIDATION_RULES_KEY];

      (dispatcher as any).precheckRpcMethod(TEST_METHOD_NAME, TEST_PARAMS, TEST_REQUEST_DETAILS);

      expect(validateParamsStub.called).to.be.false;
    });

    it('should throw and call throwUnregisteredRpcMethods for unknown methods', () => {
      // Spy on throwUnregisteredRpcMethods to verify it's called
      const throwUnregisteredSpy = sinon.spy(dispatcher as any, 'throwUnregisteredRpcMethods');

      try {
        (dispatcher as any).precheckRpcMethod('unknown_method', TEST_PARAMS, TEST_REQUEST_DETAILS);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(throwUnregisteredSpy.calledOnce).to.be.true;
        expect(throwUnregisteredSpy.calledWith('unknown_method')).to.be.true;
      }
    });
  });

  describe('processRpcMethod()', () => {
    it('should invoke handler with rearranged arguments', async () => {
      const result = await (dispatcher as any).processRpcMethod(operationHandler, TEST_PARAMS, TEST_REQUEST_DETAILS);

      expect(result).to.equal(TEST_RESULT);
      expect(operationHandler.calledOnce).to.be.true;
      expect(operationHandler.calledWith(...TEST_PARAMS_REARRANGED)).to.be.true;
    });

    it('should use handler-specific argument rearrangement when available', async () => {
      // Set the name property on the handler for the stub to match
      Object.defineProperty(operationHandler, 'name', { value: 'functionStub' });

      // Configure the stub to return specific values for this test
      arrangeRpcParamsStub
        .withArgs(sinon.match.same(operationHandler), TEST_PARAMS, TEST_REQUEST_DETAILS)
        .returns(TEST_PARAMS_REARRANGED);

      await (dispatcher as any).processRpcMethod(operationHandler, TEST_PARAMS, TEST_REQUEST_DETAILS);

      expect(arrangeRpcParamsStub.calledOnce).to.be.true;
      expect(operationHandler.calledWith(...TEST_PARAMS_REARRANGED)).to.be.true;
    });

    it('should use default argument rearrangement when handler-specific is not available', async () => {
      // Configure the stub to return specific values for this test
      arrangeRpcParamsStub
        .withArgs(sinon.match.same(operationHandler), TEST_PARAMS, TEST_REQUEST_DETAILS)
        .returns(TEST_PARAMS_REARRANGED_DEFAULT);

      await (dispatcher as any).processRpcMethod(operationHandler, TEST_PARAMS, TEST_REQUEST_DETAILS);

      expect(arrangeRpcParamsStub.calledOnce).to.be.true;
      expect(operationHandler.calledWith(...TEST_PARAMS_REARRANGED_DEFAULT)).to.be.true;
    });

    it('should preserve and rethrow exception even when the handler returns an exception', async () => {
      const jsonRpcError = new JsonRpcError({ code: -32000, message: 'Handler error' });
      operationHandler.returns(jsonRpcError);

      await expect(
        (dispatcher as any).processRpcMethod(operationHandler, TEST_PARAMS, TEST_REQUEST_DETAILS),
      ).to.eventually.rejectedWith(jsonRpcError.message);
    });
  });

  describe('handleRpcMethodError()', () => {
    it('should return JsonRpcError with request ID when error is JsonRpcError', () => {
      const error = new JsonRpcError({ code: -32000, message: 'Test error' });

      const result = (dispatcher as any).handleRpcMethodError(error, TEST_METHOD_NAME, TEST_REQUEST_DETAILS);

      expect(result).to.be.instanceOf(JsonRpcError);
      expect(result.code).to.equal(-32000);
      expect(result.message).to.equal(`${TEST_REQUEST_DETAILS.formattedRequestId} Test error`);
    });

    it('should return non time out SDKClientError as INTERNAL_ERROR', () => {
      const error = new SDKClientError(new Error('SDK error'), 'SDK error');

      const result = (dispatcher as any).handleRpcMethodError(error, TEST_METHOD_NAME, TEST_REQUEST_DETAILS);
      const expected = new JsonRpcError(
        {
          code: predefined.INTERNAL_ERROR(error.message).code,
          message: predefined.INTERNAL_ERROR(error.message).message,
        },
        TEST_REQUEST_DETAILS.requestId,
      );

      expect(result).to.deep.equal(expected);
    });

    it('should return INTERNAL_ERROR for other error types', () => {
      const error = new Error('Unexpected error');

      const result = (dispatcher as any).handleRpcMethodError(error, TEST_METHOD_NAME, TEST_REQUEST_DETAILS);
      const expected = new JsonRpcError(
        {
          code: predefined.INTERNAL_ERROR('Unexpected error').code,
          message: predefined.INTERNAL_ERROR('Unexpected error').message,
        },
        TEST_REQUEST_DETAILS.requestId,
      );

      expect(result).to.deep.equal(expected);
    });
  });

  describe('handleRpcMethodError() with MirrorNodeClientError', () => {
    it('should handle rate limit (429) errors correctly', () => {
      const error = new MirrorNodeClientError(
        new Error('Rate limit exceeded'),
        MirrorNodeClientError.statusCodes.TOO_MANY_REQUESTS,
      );
      sinon.stub(error, 'isRateLimit').returns(true);

      const result = (dispatcher as any).handleRpcMethodError(error, TEST_METHOD_NAME, TEST_REQUEST_DETAILS);

      expect(result).to.be.instanceOf(JsonRpcError);
      expect(result.code).to.equal(predefined.MIRROR_NODE_UPSTREAM_FAIL(error.statusCode, error.message).code);
      expect(result.message).to.include('Rate limit exceeded');
    });

    it('should handle timeout (504) errors correctly', () => {
      const error = new MirrorNodeClientError(
        new Error('Connection aborted'),
        MirrorNodeClientError.ErrorCodes.ECONNABORTED,
      );
      sinon.stub(error, 'isTimeout').returns(true);

      const result = (dispatcher as any).handleRpcMethodError(error, TEST_METHOD_NAME, TEST_REQUEST_DETAILS);

      expect(result).to.be.instanceOf(JsonRpcError);
      expect(result.code).to.equal(predefined.MIRROR_NODE_UPSTREAM_FAIL(error.statusCode, error.message).code);
      expect(result.message).to.include('Connection aborted');
    });

    it('should handle not supported (501) errors correctly', () => {
      const error = new MirrorNodeClientError(
        new Error('Not supported'),
        MirrorNodeClientError.ErrorCodes.NOT_SUPPORTED,
      );
      sinon.stub(error, 'isNotSupported').returns(true);

      const result = (dispatcher as any).handleRpcMethodError(error, TEST_METHOD_NAME, TEST_REQUEST_DETAILS);

      expect(result).to.be.instanceOf(JsonRpcError);
      expect(result.code).to.equal(predefined.MIRROR_NODE_UPSTREAM_FAIL(error.statusCode, error.message).code);
      expect(result.message).to.include('Not supported');
    });

    it('should handle not found (404) errors correctly', () => {
      const error = new MirrorNodeClientError(
        new Error('Resource not found'),
        MirrorNodeClientError.statusCodes.NOT_FOUND,
      );
      sinon.stub(error, 'isNotFound').returns(true);

      const result = (dispatcher as any).handleRpcMethodError(error, TEST_METHOD_NAME, TEST_REQUEST_DETAILS);

      expect(result).to.be.instanceOf(JsonRpcError);
      expect(result.code).to.equal(predefined.MIRROR_NODE_UPSTREAM_FAIL(error.statusCode, error.message).code);
      expect(result.message).to.include('Resource not found');
    });

    it('should handle internal server error (500) correctly', () => {
      const error = new MirrorNodeClientError(new Error('Internal server error'), 500);

      const result = (dispatcher as any).handleRpcMethodError(error, TEST_METHOD_NAME, TEST_REQUEST_DETAILS);

      expect(result).to.be.instanceOf(JsonRpcError);
      expect(result.code).to.equal(predefined.MIRROR_NODE_UPSTREAM_FAIL(error.statusCode, error.message).code);
      expect(result.message).to.include('Internal server error');
    });

    it('should handle bad gateway (502) errors correctly', () => {
      const error = new MirrorNodeClientError(new Error('Bad gateway'), 502);

      const result = (dispatcher as any).handleRpcMethodError(error, TEST_METHOD_NAME, TEST_REQUEST_DETAILS);

      expect(result).to.be.instanceOf(JsonRpcError);
      expect(result.code).to.equal(predefined.MIRROR_NODE_UPSTREAM_FAIL(error.statusCode, error.message).code);
      expect(result.message).to.include('Bad gateway');
    });

    it('should handle service unavailable (503) errors correctly', () => {
      const error = new MirrorNodeClientError(new Error('Service unavailable'), 503);

      const result = (dispatcher as any).handleRpcMethodError(error, TEST_METHOD_NAME, TEST_REQUEST_DETAILS);

      expect(result).to.be.instanceOf(JsonRpcError);
      expect(result.code).to.equal(predefined.MIRROR_NODE_UPSTREAM_FAIL(error.statusCode, error.message).code);
      expect(result.message).to.include('Service unavailable');
    });

    it('should handle mirror node errors with no message', () => {
      const error = new MirrorNodeClientError(new Error(), 400);
      error.message = ''; // Explicitly set empty message

      const result = (dispatcher as any).handleRpcMethodError(error, TEST_METHOD_NAME, TEST_REQUEST_DETAILS);

      expect(result).to.be.instanceOf(JsonRpcError);
      expect(result.message).to.include('Mirror node upstream failure');
    });
  });

  describe('throwUnregisteredRpcMethods()', () => {
    const testCases = [
      {
        method: 'engine_getPayload',
        expected: predefined.UNSUPPORTED_METHOD,
        description: 'engine_ namespace methods',
      },
      {
        method: 'engine_newPayloadV1',
        expected: predefined.UNSUPPORTED_METHOD,
        description: 'engine_ namespace methods',
      },
      { method: 'trace_call', expected: predefined.NOT_YET_IMPLEMENTED, description: 'trace_ namespace methods' },
      {
        method: 'trace_rawTransaction',
        expected: predefined.NOT_YET_IMPLEMENTED,
        description: 'trace_ namespace methods',
      },
      {
        method: 'debug_traceTransaction',
        expected: predefined.NOT_YET_IMPLEMENTED,
        description: 'debug_ namespace methods',
      },
      { method: 'debug_traceCall', expected: predefined.NOT_YET_IMPLEMENTED, description: 'debug_ namespace methods' },
    ];

    testCases.forEach(({ method, expected, description }) => {
      it(`should throw ${expected.message} for ${description} (${method})`, () => {
        try {
          (dispatcher as any).throwUnregisteredRpcMethods(method);
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error).to.deep.equal(expected);
        }
      });
    });

    it('should throw METHOD_NOT_FOUND with method name for unknown methods', () => {
      const unknownMethod = 'unknown_method';

      try {
        (dispatcher as any).throwUnregisteredRpcMethods(unknownMethod);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.code).to.equal(predefined.METHOD_NOT_FOUND(unknownMethod).code);
        expect(error.message).to.include(unknownMethod);
      }
    });
  });

  describe('End-to-end dispatch tests', () => {
    it('should handle INVALID_PARAMETERS error properly', async () => {
      validateParamsStub.throws(predefined.INVALID_PARAMETERS);
      operationHandler[Validator.RPC_PARAM_VALIDATION_RULES_KEY] = { 0: { type: 'boolean' } };

      const result = await dispatcher.dispatch(TEST_METHOD_NAME, ['false', null], TEST_REQUEST_DETAILS);
      expect(result).to.be.instanceOf(JsonRpcError);
      expect(result.code).to.equal(predefined.INVALID_PARAMETERS.code);
    });

    it('should handle registered methods with and without parameter validation', async () => {
      // Test with no schema
      let result = await dispatcher.dispatch(TEST_METHOD_NAME, TEST_PARAMS, TEST_REQUEST_DETAILS);
      expect(result).to.equal(TEST_RESULT);
      expect(validateParamsStub.called).to.be.false;

      // Test with schema
      validateParamsStub.reset();
      const validationRules = { 0: { type: 'string', required: true } };
      operationHandler[Validator.RPC_PARAM_VALIDATION_RULES_KEY] = validationRules;

      result = await dispatcher.dispatch(TEST_METHOD_NAME, TEST_PARAMS, TEST_REQUEST_DETAILS);
      expect(result).to.equal(TEST_RESULT);
      expect(validateParamsStub.calledOnce).to.be.true;
    });

    it('should handle unregistered methods with appropriate error responses', async () => {
      // Engine namespace
      const engineResult = await dispatcher.dispatch('engine_test', [], TEST_REQUEST_DETAILS);
      expect(engineResult).to.be.instanceOf(JsonRpcError);
      expect(engineResult.code).to.equal(predefined.UNSUPPORTED_METHOD.code);

      // Debug namespace
      const debugResult = await dispatcher.dispatch('debug_test', [], TEST_REQUEST_DETAILS);
      expect(debugResult).to.be.instanceOf(JsonRpcError);
      expect(debugResult.code).to.equal(predefined.NOT_YET_IMPLEMENTED.code);

      // Unknown method
      const unknownResult = await dispatcher.dispatch('unknown_test', [], TEST_REQUEST_DETAILS);
      expect(unknownResult).to.be.instanceOf(JsonRpcError);
      expect(unknownResult.code).to.equal(predefined.METHOD_NOT_FOUND('unknown_test').code);
    });

    it('should handle and properly format errors from different phases', async () => {
      //   Validation error
      validateParamsStub.throws(predefined.INVALID_PARAMETERS);
      const validationRules = { 0: { type: 'string', required: true } };
      operationHandler[Validator.RPC_PARAM_VALIDATION_RULES_KEY] = validationRules;

      let result = await dispatcher.dispatch(TEST_METHOD_NAME, TEST_PARAMS, TEST_REQUEST_DETAILS);
      expect(result).to.be.instanceOf(JsonRpcError);
      expect(result.code).to.equal(predefined.INVALID_PARAMETERS.code);

      // Execution error
      validateParamsStub.reset();
      delete operationHandler[Validator.RPC_PARAM_VALIDATION_RULES_KEY];
      operationHandler.rejects(new Error('Execution failed'));

      result = await dispatcher.dispatch(TEST_METHOD_NAME, TEST_PARAMS, TEST_REQUEST_DETAILS);
      const expected = new JsonRpcError(
        {
          code: predefined.INTERNAL_ERROR('Execution failed').code,
          message: predefined.INTERNAL_ERROR('Execution failed').message,
        },
        TEST_REQUEST_DETAILS.requestId,
      );

      expect(result).to.deep.equal(expected);
    });
  });
});
