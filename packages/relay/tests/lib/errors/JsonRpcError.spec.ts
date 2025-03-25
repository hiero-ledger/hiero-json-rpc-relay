// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { AbiCoder, keccak256 } from 'ethers';

import { JsonRpcError, predefined } from '../../../src';

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

    it('Constructs correctly with request ID', () => {
      const err = new JsonRpcError(
        {
          code: -32999,
          message: 'test error: foo',
          data: 'some data',
        },
        'abcd-1234',
      );
      expect(err.code).to.eq(-32999);
      expect(err.data).to.eq('some data');
      // Check that request ID is prefixed
      expect(err.message).to.eq('[Request ID: abcd-1234] test error: foo');
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
  });
});
