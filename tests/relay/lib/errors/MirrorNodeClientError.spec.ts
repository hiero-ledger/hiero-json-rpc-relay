// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { MirrorNodeClientError } from '../../../../src/relay/lib/errors/MirrorNodeClientError';
import { mockData } from '../../helpers';

describe('MirrorNodeClientError', () => {
  const mirrorNodeError = (statusCode: number, body: unknown): MirrorNodeClientError =>
    new MirrorNodeClientError({ response: { data: body } }, statusCode);

  describe('isInvalidRequestRateLimit', () => {
    it('should be true for a 429 with detail "Invalid request"', () => {
      expect(mirrorNodeError(429, mockData.requestRejected).isInvalidRequestRateLimit()).to.be.true;
    });

    it('should be false for a 429 without that detail', () => {
      expect(mirrorNodeError(429, mockData.tooManyRequests).isInvalidRequestRateLimit()).to.be.false;
    });

    it('should be false for a 429 with a different detail', () => {
      const rateLimited = {
        _status: { messages: [{ message: 'Too Many Requests', detail: 'Requests per second rate limit exceeded' }] },
      };
      expect(mirrorNodeError(429, rateLimited).isInvalidRequestRateLimit()).to.be.false;
    });

    it('should be false for a status other than 429 with detail "Invalid request"', () => {
      expect(mirrorNodeError(500, mockData.requestRejected).isInvalidRequestRateLimit()).to.be.false;
    });
  });
});
