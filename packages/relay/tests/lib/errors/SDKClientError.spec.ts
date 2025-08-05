// SPDX-License-Identifier: Apache-2.0

import { Status } from '@hashgraph/sdk';
import { expect } from 'chai';

import { SDKClientError } from '../../../src/lib/errors/SDKClientError'; // Update the path to point to the SDKClientError file

describe('SDKClientError', () => {
  it('should set status to Unknown if status is not provided in error', () => {
    const error = new SDKClientError({ message: 'Unknown error' });
    expect(error.status).to.equal(Status.Unknown);
    expect(error.isValidNetworkError()).to.be.false;
  });

  it('should set status and validNetworkError if status is provided in error', () => {
    const error = new SDKClientError({ status: Status.InvalidAccountId, message: 'INVALID_ACCOUNT_ID' });
    expect(error.status).to.equal(Status.InvalidAccountId);
    expect(error.isValidNetworkError()).to.be.true;
  });

  it('should return the correct status code', () => {
    const error = new SDKClientError({ status: Status.InvalidAccountId, message: 'INVALID_ACCOUNT_ID' });
    expect(error.statusCode).to.equal(Status.InvalidAccountId._code);
  });

  it('should correctly identify invalid account ID', () => {
    const error = new SDKClientError({ status: Status.InvalidAccountId, message: 'INVALID_ACCOUNT_ID' });
    expect(error.isInvalidAccountId()).to.be.true;
  });

  it('should correctly identify invalid contract ID by status code', () => {
    const error = new SDKClientError({ status: Status.InvalidContractId, message: 'INVALID_CONTRACT_ID' });
    expect(error.isInvalidContractId()).to.be.true;
  });

  it('should correctly identify invalid contract ID by message', () => {
    const error = new SDKClientError({ status: Status.Unknown, message: 'INVALID_CONTRACT_ID' });
    expect(error.isInvalidContractId()).to.be.true;
  });

  it('should correctly identify contract deletion', () => {
    const error = new SDKClientError({ status: Status.ContractDeleted, message: 'Contract deleted' });
    expect(error.isContractDeleted()).to.be.true;
  });

  it('should correctly identify insufficient transaction fee', () => {
    const error = new SDKClientError({ status: Status.InsufficientTxFee, message: 'Insufficient transaction fee' });
    expect(error.isInsufficientTxFee()).to.be.true;
  });

  it('should correctly identify contract revert execution', () => {
    const error = new SDKClientError({ status: Status.ContractRevertExecuted, message: 'Contract revert executed' });
    expect(error.isContractRevertExecuted()).to.be.true;
  });

  it('should correctly identify timeout exceeded', () => {
    const error = new SDKClientError({ status: Status.Unknown, message: 'timeout exceeded' });
    expect(error.isTimeoutExceeded()).to.be.true;
  });

  it('should correctly identify connection dropped', () => {
    const error = new SDKClientError({ status: Status.Unknown, message: 'Connection dropped' });
    expect(error.isConnectionDropped()).to.be.true;
  });

  it('should correctly identify gRPC timeout', () => {
    const error = new SDKClientError({ status: Status.InvalidTransactionId, message: 'gRPC timeout' });
    expect(error.isGrpcTimeout()).to.be.true;
  });

  it('should not identify gRPC timeout when the status code is different', () => {
    const error = new SDKClientError({ status: Status.InvalidAccountId, message: 'Not a gRPC timeout' });
    expect(error.isGrpcTimeout()).to.be.false;
  });

  it('should handle cases where status is undefined', () => {
    const error = new SDKClientError({ message: 'Some error without status' });
    expect(error.status).to.equal(Status.Unknown);
    expect(error.isValidNetworkError()).to.be.false;
  });

  it('should correctly handle an error without a status field', () => {
    const error = new SDKClientError({ message: 'Generic error' });
    expect(error.status).to.equal(Status.Unknown);
    expect(error.isValidNetworkError()).to.be.false;
  });

  it('should correctly handle a valid network error with a status field', () => {
    const error = new SDKClientError({ status: Status.InsufficientTxFee, message: 'Insufficient fee' });
    expect(error.isValidNetworkError()).to.be.true;
    expect(error.status).to.equal(Status.InsufficientTxFee);
  });

  it('should correctly handle an invalid status code in the error object', () => {
    const invalidStatus = { _code: 9999 };
    const error = new SDKClientError({ status: invalidStatus, message: 'Invalid status code' });
    expect(error.statusCode).to.equal(invalidStatus._code);
    expect(error.isValidNetworkError()).to.be.true;
  });

  it('should be able to get nodeAccountId', () => {
    const nodeId = '0.0.3';
    const error = new SDKClientError({}, undefined, undefined, nodeId);
    expect(error.nodeAccountId).to.equal(nodeId);
  });

  it('should use e.message when e.status._code exists, ignoring provided message parameter', () => {
    const errorWithStatus = { status: { _code: 123 }, message: 'Error from status object' };
    const customMessage = 'Custom error message';

    const error = new SDKClientError(errorWithStatus, customMessage);

    expect(error.message).to.equal('Error from status object');
    expect(error.message).to.not.equal(customMessage);
    expect(error.isValidNetworkError()).to.be.true;
  });

  it('should identify invalid contract ID when message contains Status.InvalidContractId string', () => {
    const invalidContractMessage = `Some error containing ${Status.InvalidContractId.toString()} in the message`;
    const error = new SDKClientError({ status: Status.Unknown, message: invalidContractMessage });

    expect(error.isInvalidContractId()).to.be.true;
    expect(error.isValidNetworkError()).to.be.true;
  });

  it('should handle transactionId parameter in constructor', () => {
    const testTransactionId = '0.0.123@1234567890.123456789';
    const error = new SDKClientError({}, 'Test message', testTransactionId);

    expect(error.transactionId).to.equal(testTransactionId);
  });

  it('should handle empty transactionId parameter', () => {
    const error = new SDKClientError({}, 'Test message', '');

    expect(error.transactionId).to.equal('');
  });

  it('should handle undefined transactionId parameter', () => {
    const error = new SDKClientError({}, 'Test message', undefined);

    expect(error.transactionId).to.equal('');
  });

  it('should use provided message when e.status._code is falsy', () => {
    const errorWithoutStatusCode = { status: { _code: 0 }, message: 'Error message' };
    const customMessage = 'Custom error message';

    const error = new SDKClientError(errorWithoutStatusCode, customMessage);

    expect(error.message).to.equal(customMessage);
    expect(error.isValidNetworkError()).to.be.false;
  });

  it('should handle error object without status property', () => {
    const errorWithoutStatus = { message: 'Error without status' };
    const customMessage = 'Custom error message';

    const error = new SDKClientError(errorWithoutStatus, customMessage);

    expect(error.message).to.equal(customMessage);
    expect(error.isValidNetworkError()).to.be.false;
    expect(error.status).to.equal(Status.Unknown);
  });

  it('should not identify invalid contract ID when not a valid network error', () => {
    const error = new SDKClientError({}, 'Some error message');

    expect(error.isInvalidContractId()).to.be.false;
    expect(error.isValidNetworkError()).to.be.false;
  });

  it('should identify invalid contract ID when message includes Status.InvalidContractId string but not valid network error', () => {
    const invalidContractMessage = `Error containing ${Status.InvalidContractId.toString()}`;
    const error = new SDKClientError({}, invalidContractMessage);

    expect(error.isInvalidContractId()).to.be.false; // Should be false because it's not a valid network error
    expect(error.isValidNetworkError()).to.be.false;
  });

  it('should not identify timeout exceeded when message is null', () => {
    const error = new SDKClientError({ status: Status.Unknown, message: null });
    expect(error.isTimeoutExceeded()).to.be.false;
  });

  it('should not identify timeout exceeded when message does not contain timeout text', () => {
    const error = new SDKClientError({ status: Status.Unknown, message: 'some other error' });
    expect(error.isTimeoutExceeded()).to.be.false;
  });

  it('should not identify connection dropped when message is null', () => {
    const error = new SDKClientError({ status: Status.Unknown, message: null });
    expect(error.isConnectionDropped()).to.be.false;
  });

  it('should not identify connection dropped when message does not contain connection text', () => {
    const error = new SDKClientError({ status: Status.Unknown, message: 'some other error' });
    expect(error.isConnectionDropped()).to.be.false;
  });

  it('should not identify invalid account ID when status code is different', () => {
    const error = new SDKClientError({ status: Status.InvalidContractId, message: 'Different error' });
    expect(error.isInvalidAccountId()).to.be.false;
  });

  it('should not identify contract deletion when status code is different', () => {
    const error = new SDKClientError({ status: Status.InvalidAccountId, message: 'Different error' });
    expect(error.isContractDeleted()).to.be.false;
  });

  it('should not identify insufficient tx fee when status code is different', () => {
    const error = new SDKClientError({ status: Status.InvalidAccountId, message: 'Different error' });
    expect(error.isInsufficientTxFee()).to.be.false;
  });

  it('should not identify contract revert execution when status code is different', () => {
    const error = new SDKClientError({ status: Status.InvalidAccountId, message: 'Different error' });
    expect(error.isContractRevertExecuted()).to.be.false;
  });

  it('should not identify timeout exceeded when status code is not Unknown', () => {
    const error = new SDKClientError({ status: Status.InvalidAccountId, message: 'timeout exceeded' });
    expect(error.isTimeoutExceeded()).to.be.false;
  });

  it('should not identify connection dropped when status code is not Unknown', () => {
    const error = new SDKClientError({ status: Status.InvalidAccountId, message: 'Connection dropped' });
    expect(error.isConnectionDropped()).to.be.false;
  });

  it('should handle status object with falsy _code property', () => {
    const errorWithZeroCode = { status: { _code: 0 }, message: 'Error with zero code' };
    const customMessage = 'Custom message for zero code';

    const error = new SDKClientError(errorWithZeroCode, customMessage);

    expect(error.message).to.equal(customMessage); // Should use custom message since _code is falsy
    expect(error.isValidNetworkError()).to.be.false; // Should be false since _code is falsy
    expect(error.status).to.equal(Status.Unknown); // Should default to Unknown
  });

  it('should handle status object with null _code property', () => {
    const errorWithNullCode = { status: { _code: null }, message: 'Error with null code' };
    const customMessage = 'Custom message for null code';

    const error = new SDKClientError(errorWithNullCode, customMessage);

    expect(error.message).to.equal(customMessage);
    expect(error.isValidNetworkError()).to.be.false;
    expect(error.status).to.equal(Status.Unknown);
  });

  it('should identify invalid contract ID when valid network error AND message contains InvalidContractId string', () => {
    const invalidContractMessage = `Some error containing ${Status.InvalidContractId.toString()} in the message`;
    const error = new SDKClientError({ status: Status.InsufficientTxFee, message: invalidContractMessage });

    expect(error.isInvalidContractId()).to.be.true; // Should be true: valid network error AND message contains string
    expect(error.isValidNetworkError()).to.be.true;
  });

  it('should handle empty error object with message parameter', () => {
    const error = new SDKClientError({}, 'Test message');

    expect(error.message).to.equal('Test message');
    expect(error.isValidNetworkError()).to.be.false;
    expect(error.status).to.equal(Status.Unknown);
  });

  it('should handle error object with status but no _code property', () => {
    const errorWithStatusButNoCode = { status: {}, message: 'Error message' };
    const customMessage = 'Custom error message';

    const error = new SDKClientError(errorWithStatusButNoCode, customMessage);

    expect(error.message).to.equal(customMessage); // Should use custom message since status._code is undefined
    expect(error.isValidNetworkError()).to.be.false;
    expect(error.status).to.equal(Status.Unknown);
  });

  it('should handle null error object', () => {
    const customMessage = 'Custom error message';

    const error = new SDKClientError(null, customMessage);

    expect(error.message).to.equal(customMessage);
    expect(error.isValidNetworkError()).to.be.false;
    expect(error.status).to.equal(Status.Unknown);
  });

  it('should handle undefined error object', () => {
    const customMessage = 'Custom error message';

    const error = new SDKClientError(undefined, customMessage);

    expect(error.message).to.equal(customMessage);
    expect(error.isValidNetworkError()).to.be.false;
    expect(error.status).to.equal(Status.Unknown);
  });

  it('should handle error object with null status', () => {
    const errorWithNullStatus = { status: null, message: 'Error message' };
    const customMessage = 'Custom error message';

    const error = new SDKClientError(errorWithNullStatus, customMessage);

    expect(error.message).to.equal(customMessage);
    expect(error.isValidNetworkError()).to.be.false;
    expect(error.status).to.equal(Status.Unknown);
  });

  it('should handle error object with undefined status', () => {
    const errorWithUndefinedStatus = { status: undefined, message: 'Error message' };
    const customMessage = 'Custom error message';

    const error = new SDKClientError(errorWithUndefinedStatus, customMessage);

    expect(error.message).to.equal(customMessage);
    expect(error.isValidNetworkError()).to.be.false;
    expect(error.status).to.equal(Status.Unknown);
  });

  it('should handle error object with valid status._code but null e.message', () => {
    const errorWithNullMessage = { status: { _code: 123 }, message: null };
    const customMessage = 'Custom error message';

    const error = new SDKClientError(errorWithNullMessage, customMessage);

    expect(error.message).to.equal('null');
    expect(error.isValidNetworkError()).to.be.true;
  });

  it('should handle error object with valid status._code but undefined e.message', () => {
    const errorWithUndefinedMessage = { status: { _code: 123 }, message: undefined };
    const customMessage = 'Custom error message';

    const error = new SDKClientError(errorWithUndefinedMessage, customMessage);

    expect(error.message).to.equal('');
    expect(error.isValidNetworkError()).to.be.true;
  });

  it('should test isInvalidContractId with null message', () => {
    const error = new SDKClientError({ status: { _code: 123 }, message: null });
    expect(error.isInvalidContractId()).to.be.false; // this.message is null, so includes() will return false
  });

  it('should test isInvalidContractId with undefined message', () => {
    const error = new SDKClientError({ status: { _code: 123 }, message: undefined });
    expect(error.isInvalidContractId()).to.be.false; // this.message is undefined, so includes() will return false
  });

  it('should test isTimeoutExceeded with statusCode NOT equal to Unknown', () => {
    const error = new SDKClientError({ status: Status.InvalidAccountId, message: 'timeout exceeded' });
    expect(error.isTimeoutExceeded()).to.be.false; // First condition fails, short-circuit
  });

  it('should test isTimeoutExceeded with statusCode equal to Unknown but message null', () => {
    const error = new SDKClientError({ status: Status.Unknown, message: null });
    expect(error.isTimeoutExceeded()).to.be.false; // Second condition fails (null?.includes returns undefined)
  });

  it('should test isTimeoutExceeded with statusCode equal to Unknown but message undefined', () => {
    const error = new SDKClientError({ status: Status.Unknown, message: undefined });
    expect(error.isTimeoutExceeded()).to.be.false; // Second condition fails (undefined?.includes returns undefined)
  });

  it('should test isTimeoutExceeded with statusCode equal to Unknown and message contains timeout', () => {
    const error = new SDKClientError({ status: Status.Unknown, message: 'timeout exceeded' });
    expect(error.isTimeoutExceeded()).to.be.true; // Both conditions true
  });

  it('should test isTimeoutExceeded with statusCode equal to Unknown and message does not contain timeout', () => {
    const error = new SDKClientError({ status: Status.Unknown, message: 'some other error' });
    expect(error.isTimeoutExceeded()).to.be.false; // Second condition fails
  });

  it('should test isConnectionDropped with statusCode NOT equal to Unknown', () => {
    const error = new SDKClientError({ status: Status.InvalidAccountId, message: 'Connection dropped' });
    expect(error.isConnectionDropped()).to.be.false; // First condition fails, short-circuit
  });

  it('should test isConnectionDropped with statusCode equal to Unknown but message null', () => {
    const error = new SDKClientError({ status: Status.Unknown, message: null });
    expect(error.isConnectionDropped()).to.be.false; // Second condition fails (null?.includes returns undefined)
  });

  it('should test isConnectionDropped with statusCode equal to Unknown but message undefined', () => {
    const error = new SDKClientError({ status: Status.Unknown, message: undefined });
    expect(error.isConnectionDropped()).to.be.false; // Second condition fails (undefined?.includes returns undefined)
  });

  it('should test isConnectionDropped with statusCode equal to Unknown and message contains connection text', () => {
    const error = new SDKClientError({ status: Status.Unknown, message: 'Connection dropped' });
    expect(error.isConnectionDropped()).to.be.true; // Both conditions true
  });

  it('should test isConnectionDropped with statusCode equal to Unknown and message does not contain connection text', () => {
    const error = new SDKClientError({ status: Status.Unknown, message: 'some other error' });
    expect(error.isConnectionDropped()).to.be.false; // Second condition fails
  });
});
