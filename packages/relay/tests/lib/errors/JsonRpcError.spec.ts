// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { AbiCoder, keccak256 } from 'ethers';
import { v4 as uuid } from 'uuid';

import { JsonRpcError, predefined } from '../../../src';
import constants from '../../../src/lib/constants';

describe('Errors', () => {
  describe('JsonRpcError', () => {
    it('Constructs correctly without request ID', () => {
      const err = new JsonRpcError({
        code: -32999,
        message: 'test error: foo',
        data: 'some data',
      });
      expect(err.code).to.eq(-32999);
      expect(err.data).to.eq('some data');

      // Check that request ID is *not* prefixed
      expect(err.message).to.eq('test error: foo');
    });

    describe('Constructor with RequestId handling', () => {
      const requestId = uuid();

      it('Constructs correctly with request ID', () => {
        const err = new JsonRpcError(
          {
            code: -32999,
            message: 'test error: foo',
            data: 'some data',
          },
          requestId,
        );

        expect(err.code).to.eq(-32999);
        expect(err.data).to.eq('some data');
        // Check that request ID is prefixed
        expect(err.message).to.eq(`[Request ID: ${requestId}] test error: foo`);
      });

      it('Should not duplicate request ID if message already has it', () => {
        const existingMessage = `[Request ID: ${requestId}] test error: foo`;
        const err = new JsonRpcError(
          {
            code: -32999,
            message: existingMessage,
            data: 'some data',
          },
          requestId,
        );
        expect(err.message).to.eq(existingMessage);
      });

      it('Should not add request ID if message includes the request ID pattern anywhere', () => {
        const messageWithRequestIdPattern = `Error occurred with [Request ID: ${requestId}] in the middle`;
        const err = new JsonRpcError(
          {
            code: -32999,
            message: messageWithRequestIdPattern,
            data: 'some data',
          },
          requestId,
        );
        expect(err.message).to.eq(messageWithRequestIdPattern);
      });

      it('Should add request ID when message does not have one', () => {
        const originalMessage = 'test error: foo';
        const err = new JsonRpcError(
          {
            code: -32999,
            message: originalMessage,
            data: 'some data',
          },
          requestId,
        );
        expect(err.message).to.eq(`[Request ID: ${requestId}] ${originalMessage}`);
      });
    });

    describe('newWithRequestId', () => {
      const requestId = uuid();

      it('Should add request ID to error message when not present', () => {
        const originalError = new JsonRpcError({
          code: -32999,
          message: 'test error: foo',
          data: 'some data',
        });

        const updatedError = JsonRpcError.newWithRequestId(originalError, requestId);

        expect(updatedError.message).to.eq(`[${constants.REQUEST_ID_STRING}${requestId}] test error: foo`);
        expect(updatedError.code).to.eq(originalError.code);
        expect(updatedError.data).to.eq(originalError.data);
        expect(updatedError).to.not.equal(originalError); // Should be a new object reference
      });

      it('Should not add request ID if message already has it', () => {
        const existingMessage = `[${constants.REQUEST_ID_STRING}${requestId}] test error: foo`;
        const originalError = new JsonRpcError({
          code: -32999,
          message: existingMessage,
          data: 'some data',
        });

        const updatedError = JsonRpcError.newWithRequestId(originalError, requestId);

        expect(updatedError.message).to.eq(existingMessage);
        expect(updatedError.code).to.eq(originalError.code);
        expect(updatedError.data).to.eq(originalError.data);
        expect(updatedError).to.not.equal(originalError); // Should be a new object reference
      });

      it('Should not add request ID if message includes the request ID pattern anywhere', () => {
        const messageWithRequestIdPattern = `Error occurred with [${constants.REQUEST_ID_STRING}${requestId}] in the middle`;
        const originalError = new JsonRpcError({
          code: -32999,
          message: messageWithRequestIdPattern,
          data: 'some data',
        });

        const updatedError = JsonRpcError.newWithRequestId(originalError, requestId);

        expect(updatedError.message).to.eq(messageWithRequestIdPattern);
        expect(updatedError.code).to.eq(originalError.code);
        expect(updatedError.data).to.eq(originalError.data);
        expect(updatedError).to.not.equal(originalError); // Should be a new object reference
      });
    });

    describe('predefined.CONTRACT_REVERT', () => {
      const defaultErrorSignature = keccak256(Buffer.from('Error(string)')).slice(0, 10); // 0x08c379a0
      const customErrorSignature = keccak256(Buffer.from('CustomError(string)')).slice(0, 10); // 0x8d6ea8be
      const decodedMessage = 'Some error message';
      const encodedMessage = new AbiCoder().encode(['string'], [decodedMessage]).replace('0x', '');
      const encodedCustomError = customErrorSignature + encodedMessage;
      const encodedDefaultError = defaultErrorSignature + encodedMessage;

      it('Returns decoded message when decoded message is provided as errorMessage and encoded default error is provided as data', () => {
        const error = predefined.CONTRACT_REVERT(decodedMessage, encodedDefaultError);
        expect(error.message).to.eq(`execution reverted: ${decodedMessage}`);
      });

      it('Returns decoded message when decoded message is provided as errorMessage and encoded custom error is provided as data', () => {
        const error = predefined.CONTRACT_REVERT(decodedMessage, encodedCustomError);
        expect(error.message).to.eq(`execution reverted: ${decodedMessage}`);
      });

      it('Returns decoded message when encoded default error is provided as errorMessage and data', () => {
        const error = predefined.CONTRACT_REVERT(encodedDefaultError, encodedDefaultError);
        expect(error.message).to.eq(`execution reverted: ${decodedMessage}`);
      });

      it('Returns decoded message when encoded custom error is provided as errorMessage and data', () => {
        const error = predefined.CONTRACT_REVERT(encodedCustomError, encodedCustomError);
        expect(error.message).to.eq(`execution reverted: ${decodedMessage}`);
      });

      it('Returns decoded message when decoded errorMessage is provided', () => {
        const error = predefined.CONTRACT_REVERT(decodedMessage);
        expect(error.message).to.eq(`execution reverted: ${decodedMessage}`);
      });

      it('Returns decoded message when encoded default error is provided as errorMessage', () => {
        const error = predefined.CONTRACT_REVERT(encodedDefaultError);
        expect(error.message).to.eq(`execution reverted: ${decodedMessage}`);
      });

      it('Returns decoded message when encoded custom error is provided as errorMessage', () => {
        const error = predefined.CONTRACT_REVERT(encodedCustomError);
        expect(error.message).to.eq(`execution reverted: ${decodedMessage}`);
      });

      it('Returns decoded message when encoded default error is provided as data', () => {
        const error = predefined.CONTRACT_REVERT(undefined, encodedDefaultError);
        expect(error.message).to.eq(`execution reverted: ${decodedMessage}`);
      });

      it('Returns decoded message when encoded custom error is provided as data', () => {
        const error = predefined.CONTRACT_REVERT(undefined, encodedCustomError);
        expect(error.message).to.eq(`execution reverted: ${decodedMessage}`);
      });

      it('Returns decoded message when message is empty and encoded default error is provided as data', () => {
        const error = predefined.CONTRACT_REVERT('', encodedDefaultError);
        expect(error.message).to.eq(`execution reverted: ${decodedMessage}`);
      });

      it('Returns decoded message when message is empty and encoded custom error is provided as data', () => {
        const error = predefined.CONTRACT_REVERT('', encodedCustomError);
        expect(error.message).to.eq(`execution reverted: ${decodedMessage}`);
      });

      it('Returns default message when errorMessage is empty', () => {
        const error = predefined.CONTRACT_REVERT('');
        expect(error.message).to.eq('execution reverted');
      });

      it('Returns default message when data is empty', () => {
        const error = predefined.CONTRACT_REVERT(undefined, '');
        expect(error.message).to.eq('execution reverted');
      });

      it('Returns default message when neither errorMessage nor data is provided', () => {
        const error = predefined.CONTRACT_REVERT();
        expect(error.message).to.eq('execution reverted');
      });
    });

    describe('predefined.MIRROR_NODE_UPSTREAM_FAIL', () => {
      it('Constructs correctly with error code and message', () => {
        const errCode = 500;
        const errMessage = 'Internal Server Error';
        const error = predefined.MIRROR_NODE_UPSTREAM_FAIL(errCode, errMessage);
        expect(error.code).to.eq(-32020);
        expect(error.message).to.eq(`Mirror node upstream failure: statusCode=${errCode}, message=${errMessage}`);
        expect(error.data).to.eq(errCode.toString());
      });

      it('Constructs correctly with different error code and message', () => {
        const errCode = 404;
        const errMessage = 'Not Found';
        const error = predefined.MIRROR_NODE_UPSTREAM_FAIL(errCode, errMessage);
        expect(error.code).to.eq(-32020);
        expect(error.message).to.eq(`Mirror node upstream failure: statusCode=${errCode}, message=${errMessage}`);
        expect(error.data).to.eq(errCode.toString());
      });
    });

    describe('predefined.IP_RATE_LIMIT_EXCEEDED', () => {
      it('Constructs correctly with method name', () => {
        const methodName = 'eth_getBalance';
        const error = predefined.IP_RATE_LIMIT_EXCEEDED(methodName);
        expect(error.code).to.eq(-32605);
        expect(error.message).to.eq(`IP Rate limit exceeded on ${methodName}`);
      });

      it('Constructs correctly with different method name', () => {
        const methodName = 'eth_call';
        const error = predefined.IP_RATE_LIMIT_EXCEEDED(methodName);
        expect(error.code).to.eq(-32605);
        expect(error.message).to.eq(`IP Rate limit exceeded on ${methodName}`);
      });
    });

    describe('predefined.REQUEST_BEYOND_HEAD_BLOCK', () => {
      it('Constructs correctly with requested and latest block numbers', () => {
        const requested = 1000;
        const latest = 500;
        const error = predefined.REQUEST_BEYOND_HEAD_BLOCK(requested, latest);
        expect(error.code).to.eq(-32000);
        expect(error.message).to.eq(`Request beyond head block: requested ${requested}, head ${latest}`);
      });

      it('Constructs correctly with different block numbers', () => {
        const requested = 2500;
        const latest = 2000;
        const error = predefined.REQUEST_BEYOND_HEAD_BLOCK(requested, latest);
        expect(error.code).to.eq(-32000);
        expect(error.message).to.eq(`Request beyond head block: requested ${requested}, head ${latest}`);
      });
    });

    describe('predefined.NON_EXISTING_CONTRACT', () => {
      it('Constructs correctly with valid address', () => {
        const address = '0x1234567890abcdef1234567890abcdef12345678';
        const error = predefined.NON_EXISTING_CONTRACT(address);
        expect(error.code).to.eq(-32013);
        expect(error.message).to.eq(`Non Existing Contract Address: ${address}. Expected a Contract or Token Address.`);
      });

      it('Constructs correctly with empty address', () => {
        const address = '';
        const error = predefined.NON_EXISTING_CONTRACT(address);
        expect(error.code).to.eq(-32013);
        expect(error.message).to.eq(`Non Existing Contract Address: ${address}.`);
      });

      it('Constructs correctly with null address', () => {
        const address = null;
        const error = predefined.NON_EXISTING_CONTRACT(address);
        expect(error.code).to.eq(-32013);
        expect(error.message).to.eq(`Non Existing Contract Address: ${address}.`);
      });

      it('Constructs correctly with undefined address', () => {
        const address = undefined;
        const error = predefined.NON_EXISTING_CONTRACT(address);
        expect(error.code).to.eq(-32013);
        expect(error.message).to.eq(`Non Existing Contract Address: ${address}.`);
      });
    });

    describe('predefined.UNSUPPORTED_HISTORICAL_EXECUTION', () => {
      it('Constructs correctly with block identifier', () => {
        const blockId = 'earliest';
        const error = predefined.UNSUPPORTED_HISTORICAL_EXECUTION(blockId);
        expect(error.code).to.eq(-32609);
        expect(error.message).to.eq(`Unsupported historical block identifier encountered: ${blockId}`);
      });

      it('Constructs correctly with different block identifier', () => {
        const blockId = '0x123abc';
        const error = predefined.UNSUPPORTED_HISTORICAL_EXECUTION(blockId);
        expect(error.code).to.eq(-32609);
        expect(error.message).to.eq(`Unsupported historical block identifier encountered: ${blockId}`);
      });
    });

    describe('predefined.UNSUPPORTED_OPERATION', () => {
      it('Constructs correctly with operation message', () => {
        const message = 'This operation is not supported in this version';
        const error = predefined.UNSUPPORTED_OPERATION(message);
        expect(error.code).to.eq(-32610);
        expect(error.message).to.eq(`Unsupported operation. ${message}`);
      });

      it('Constructs correctly with different operation message', () => {
        const message = 'Feature disabled in current configuration';
        const error = predefined.UNSUPPORTED_OPERATION(message);
        expect(error.code).to.eq(-32610);
        expect(error.message).to.eq(`Unsupported operation. ${message}`);
      });
    });

    describe('predefined.BATCH_REQUESTS_AMOUNT_MAX_EXCEEDED', () => {
      it('Constructs correctly with amount and max values', () => {
        const amount = 150;
        const max = 100;
        const error = predefined.BATCH_REQUESTS_AMOUNT_MAX_EXCEEDED(amount, max);
        expect(error.code).to.eq(-32203);
        expect(error.message).to.eq(`Batch request amount ${amount} exceeds max ${max}`);
      });

      it('Constructs correctly with different amount and max values', () => {
        const amount = 250;
        const max = 200;
        const error = predefined.BATCH_REQUESTS_AMOUNT_MAX_EXCEEDED(amount, max);
        expect(error.code).to.eq(-32203);
        expect(error.message).to.eq(`Batch request amount ${amount} exceeds max ${max}`);
      });
    });

    describe('predefined.WS_BATCH_REQUESTS_AMOUNT_MAX_EXCEEDED', () => {
      it('Constructs correctly with amount and max values', () => {
        const amount = 25;
        const max = 20;
        const error = predefined.WS_BATCH_REQUESTS_AMOUNT_MAX_EXCEEDED(amount, max);
        expect(error.code).to.eq(-32206);
        expect(error.message).to.eq(`Batch request amount ${amount} exceeds max ${max}`);
      });

      it('Constructs correctly with different amount and max values', () => {
        const amount = 50;
        const max = 30;
        const error = predefined.WS_BATCH_REQUESTS_AMOUNT_MAX_EXCEEDED(amount, max);
        expect(error.code).to.eq(-32206);
        expect(error.message).to.eq(`Batch request amount ${amount} exceeds max ${max}`);
      });
    });
  });
});
