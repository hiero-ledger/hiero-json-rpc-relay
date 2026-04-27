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

      await expect(
        Utils.sendJsonRpcRequestWithDelay(host, port, method, params, requestTimeoutMs + 1000),
      ).to.eventually.be.rejected.and.satisfy(
        ({ code, message }) => code === 'ECONNRESET' && message === 'socket hang up',
      );
    });

    // The socket hang-up error will cause all the acceptance "after" hooks depending on the open port 50211
    // to fail as well. This is a workaround to avoid that
    before(async () => {
      const balance = await global.servicesNode.getOperatorBalance();
      global.servicesNode.getOperatorBalance = () => Promise.resolve(balance);
    });
  });
});
