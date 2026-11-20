// SPDX-License-Identifier: Apache-2.0

import { Status } from '@hiero-ledger/sdk';
import { expect } from 'chai';

import {
  CLIENT_HEDERA_STATUSES,
  isClientHederaStatus,
  isClientHttpStatus,
} from '../../../../src/relay/lib/errors/errorClassification';

describe('errorClassification', () => {
  describe('isClientHttpStatus', () => {
    [400, 401, 403, 404, 413, 499].forEach((status) => {
      it(`treats ${status} as a client error`, () => {
        expect(isClientHttpStatus(status)).to.be.true;
      });
    });

    [undefined, 200, 302, 429, 500, 501, 502, 503, 504, 567].forEach((status) => {
      it(`treats ${status} as a server error`, () => {
        expect(isClientHttpStatus(status)).to.be.false;
      });
    });
  });

  describe('isClientHederaStatus', () => {
    it('treats listed statuses as client errors', () => {
      expect(isClientHederaStatus(Status.InvalidSignature.toString())).to.be.true;
      expect(isClientHederaStatus(Status.WrongNonce.toString())).to.be.true;
    });

    it('treats statuses the relay operator can cause as server errors', () => {
      expect(isClientHederaStatus(Status.InsufficientPayerBalance.toString())).to.be.false;
      expect(isClientHederaStatus(Status.PayerAccountNotFound.toString())).to.be.false;
      expect(isClientHederaStatus(Status.InsufficientTxFee.toString())).to.be.false;
    });

    it('treats any other status as a server error', () => {
      expect(isClientHederaStatus(Status.Busy.toString())).to.be.false;
      expect(isClientHederaStatus(Status.Unknown.toString())).to.be.false;
      expect(isClientHederaStatus(undefined)).to.be.false;
    });

    it('lists only statuses the SDK knows', () => {
      const known = new Set<string>();
      for (let code = 0; code < 1000; code++) {
        try {
          known.add(Status._fromCode(code).toString());
        } catch {
          // not a status code
        }
      }

      expect([...CLIENT_HEDERA_STATUSES].filter((status) => !known.has(status))).to.deep.equal([]);
    });
  });
});
