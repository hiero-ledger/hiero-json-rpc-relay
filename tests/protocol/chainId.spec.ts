// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { ConfigService } from '../../src/config-service/services';
import { ALL_PROTOCOL_CLIENTS } from './helpers/protocolClient';

describe('@release @protocol-acceptance eth_chainId', async function () {
  this.timeout(240 * 1000);
  const METHOD_NAME = 'eth_chainId';
  const CHAIN_ID = ConfigService.get('CHAIN_ID');

  // @ts-ignore
  const { relay } = global;

  after(async () => {
    if (global?.socketServer) {
      expect(global.socketServer._connections).to.eq(0);
    }
  });

  for (const client of ALL_PROTOCOL_CLIENTS) {
    describe(client.label, () => {
      it('should execute "eth_chainId"', async () => {
        const res = (await client.call(METHOD_NAME, [null])) as string;
        expect(res).to.be.equal(CHAIN_ID);
      });

      it('Should execute eth_chainId requests with undefined params and receive expected result', async () => {
        const response = await client.callRaw(METHOD_NAME, undefined);
        const expectedResult = await relay.call('eth_chainId', []);

        expect(response.error).to.not.exist;
        expect(response.result).to.eq(expectedResult);
      });
    });
  }
});
