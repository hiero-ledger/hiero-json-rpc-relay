// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { ConfigService } from '../../../src/config-service/services';
import { Utils } from '../helpers/utils';

describe('@server-config Server Configuration Options Coverage', function () {
  describe('Koa Server Timeout', () => {
    it('should timeout a request after the specified time', async () => {
      const requestTimeoutMs: number = ConfigService.get('SERVER_REQUEST_TIMEOUT_MS');
      const host = ConfigService.get('SERVER_HOST') || 'localhost';
      const port = ConfigService.get('SERVER_PORT');
      const method = 'eth_blockNumber';
      const params: any[] = [];

      try {
        await Utils.sendJsonRpcRequestWithDelay(host, port, method, params, requestTimeoutMs + 1000);
        throw new Error('Request did not timeout as expected'); // Force the test to fail if the request does not time out
      } catch (err: any) {
        expect(err.code).to.equal('ECONNRESET');
        expect(err.message).to.equal('socket hang up');
      }
    });
  });
});
