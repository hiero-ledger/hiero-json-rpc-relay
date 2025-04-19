// SPDX-License-Identifier: Apache-2.0

import { JsonRpcError } from '@hashgraph/json-rpc-relay';
import { expect } from 'chai';

import { translateRpcErrorToHttpStatus } from '../../src/koaJsonRpc/lib/httpErrorMapper';

describe('translateRpcErrorToHttpStatus', () => {
  const requestId = 'req-123';
  const requestIdPrefix = `[Request ID: ${requestId}]`;

  // Helper function to test error code mappings
  const testErrorCodeMapping = (errorCode, errorMessage, expectedStatusCode, errorData: any = undefined) => {
    const result = translateRpcErrorToHttpStatus(
      new JsonRpcError({ code: errorCode, message: errorMessage, data: errorData }, requestId),
    );

    expect(result.statusErrorCode).to.equal(expectedStatusCode);
    return result;
  };

  describe('Standard JSON-RPC error codes', () => {
    const errorCodeMappings = [
      { code: 3, message: 'Contract reverted', expectedStatus: 200 },
      { code: -32603, message: 'Internal error', expectedStatus: 500 },
      { code: -32600, message: 'Invalid request', expectedStatus: 400 },
      { code: -32602, message: 'Invalid params', expectedStatus: 400 },
      { code: -32601, message: 'Method not found', expectedStatus: 400 },
      { code: -32605, message: 'Rate limit exceeded', expectedStatus: 429 },
      { code: -99999, message: 'Unknown error', expectedStatus: 400 },
    ];

    errorCodeMappings.forEach(({ code, message, expectedStatus }) => {
      it(`should map ${message} (${code}) to HTTP ${expectedStatus}`, () => {
        testErrorCodeMapping(code, message, expectedStatus);
      });
    });
  });

  describe('Mirror Node error handling', () => {
    const mirrorNodeErrorCode = -32020;

    const mirrorNodeErrorMappings = [
      { status: '404', message: 'Method Not Found', expectedStatus: 400 },
      { status: '429', message: 'Mirror Node rate limit exceeded', expectedStatus: 429 },
      { status: '500', message: 'Internal Server Error', expectedStatus: 500 },
      { status: '501', message: 'Not implemented', expectedStatus: 501 },
      { status: '502', message: 'Bad Gateway', expectedStatus: 500 },
      { status: '503', message: 'Service Unavailable', expectedStatus: 500 },
      { status: '504', message: 'Gateway Timeout', expectedStatus: 500 },
      { status: '567', message: 'Unknown Mirror Node error', expectedStatus: 500 },
    ];

    mirrorNodeErrorMappings.forEach(({ status, message, expectedStatus }) => {
      it(`should map Mirror Node ${status} error to HTTP ${expectedStatus}`, () => {
        const result = testErrorCodeMapping(mirrorNodeErrorCode, message, expectedStatus, status);
        expect(result.statusErrorMessage).to.equal(`${requestIdPrefix} ${message}`);
      });
    });

    it('should handle Mirror Node errors without error data', () => {
      const result = testErrorCodeMapping(
        mirrorNodeErrorCode,
        'Mirror Node error without data',
        400, // Default behavior when no error data
      );
      expect(result.statusErrorMessage).to.equal(`${requestIdPrefix} Mirror Node error without data`);
    });
  });
});
