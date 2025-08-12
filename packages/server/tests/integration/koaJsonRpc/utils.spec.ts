// SPDX-License-Identifier: Apache-2.0

import { Server } from 'node:http';

import constants from '@hashgraph/json-rpc-relay/dist/lib/constants';
import { expect } from 'chai';
import sinon from 'sinon';

import { withOverriddenEnvsInMochaTest } from '../../../../relay/tests/helpers';
import * as utils from '../../../src/koaJsonRpc/lib/utils';

describe('utils.ts', () => {
  describe('setServerTimeout', () => {
    let server: Server;
    let spy: sinon.SinonSpy;
    beforeEach(() => {
      server = new Server();
      spy = sinon.spy(server, 'setTimeout');
    });

    afterEach(() => {
      sinon.restore();
    });

    withOverriddenEnvsInMochaTest({ SERVER_REQUEST_TIMEOUT_MS: 30000 }, () => {
      it('should set server timeout from environment variable', () => {
        utils.setServerTimeout(server);
        expect(spy.calledWith(30000)).to.eq(true);
      });
    });

    withOverriddenEnvsInMochaTest({ SERVER_REQUEST_TIMEOUT_MS: undefined }, () => {
      it('should set server timeout to default value when environment variable is not set', () => {
        utils.setServerTimeout(server);
        expect(spy.calledWith(60000)).to.eq(true);
      });
    });
  });

  describe('getBatchRequestsMaxSize', () => {
    withOverriddenEnvsInMochaTest({ BATCH_REQUESTS_MAX_SIZE: 150 }, () => {
      it('should return the batch request max size from environment variable', () => {
        const result = utils.getBatchRequestsMaxSize();
        expect(result).to.equal(150);
      });
    });

    withOverriddenEnvsInMochaTest({ BATCH_REQUESTS_MAX_SIZE: undefined }, () => {
      it('should return default batch request max size when environment variable is not set', () => {
        const result = utils.getBatchRequestsMaxSize();
        expect(result).to.equal(100);
      });
    });
  });

  describe('getLimitDuration', () => {
    withOverriddenEnvsInMochaTest({ LIMIT_DURATION: 500 }, () => {
      it('should return the limit duration from environment variable', () => {
        const result = utils.getLimitDuration();
        expect(result).to.equal(500);
      });
    });

    withOverriddenEnvsInMochaTest({ LIMIT_DURATION: undefined }, () => {
      it('should return the default limit duration when environment variable is not set', () => {
        const result = utils.getLimitDuration();
        expect(result).to.equal(constants.DEFAULT_RATE_LIMIT.DURATION);
      });
    });
  });

  describe('getDefaultRateLimit', () => {
    withOverriddenEnvsInMochaTest({ DEFAULT_RATE_LIMIT: 250 }, () => {
      it('should return the default rate limit from environment variable', () => {
        const result = utils.getDefaultRateLimit();
        expect(result).to.equal(250);
      });
    });

    withOverriddenEnvsInMochaTest({ DEFAULT_RATE_LIMIT: undefined }, () => {
      it('should return the default rate limit when environment variable is not set', () => {
        const result = utils.getDefaultRateLimit();
        expect(result).to.equal(200);
      });
    });
  });

  describe('getRequestIdIsOptional', () => {
    withOverriddenEnvsInMochaTest({ REQUEST_ID_IS_OPTIONAL: true }, () => {
      it('should return true when REQUEST_ID_IS_OPTIONAL is set to true', () => {
        const result = utils.getRequestIdIsOptional();
        expect(result).to.be.true;
      });
    });

    withOverriddenEnvsInMochaTest({ REQUEST_ID_IS_OPTIONAL: false }, () => {
      it('should return false when REQUEST_ID_IS_OPTIONAL is not set to true', () => {
        const result = utils.getRequestIdIsOptional();
        expect(result).to.be.false;
      });
    });
  });

  describe('getBatchRequestsEnabled', () => {
    withOverriddenEnvsInMochaTest({ BATCH_REQUESTS_ENABLED: true }, () => {
      it('should return true when BATCH_REQUESTS_ENABLED is set to true', () => {
        const result = utils.getBatchRequestsEnabled();
        expect(result).to.be.true;
      });
    });

    withOverriddenEnvsInMochaTest({ BATCH_REQUESTS_ENABLED: false }, () => {
      it('should return false when BATCH_REQUESTS_ENABLED is not set to true', () => {
        const result = utils.getBatchRequestsEnabled();
        expect(result).to.be.false;
      });
    });
  });
});
