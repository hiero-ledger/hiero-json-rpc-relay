// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { ConfigService } from '../../src/config-service/services';
import RelayClient from '../server/clients/relayClient';
import { ALL_PROTOCOL_CLIENTS } from './helpers/protocolClient';

describe('@release @protocol-acceptance eth_gasPrice', async function () {
  this.timeout(240 * 1000);
  const METHOD_NAME = 'eth_gasPrice';

  // @ts-ignore
  const { relay }: { relay: RelayClient } = global;

  let expectedGasPrice: string;

  before(async () => {
    expectedGasPrice = await relay.call(METHOD_NAME, []);
  });

  after(async () => {
    if (global?.socketServer) {
      expect(global.socketServer._connections).to.eq(0);
    }
  });

  for (const client of ALL_PROTOCOL_CLIENTS) {
    describe(client.label, () => {
      it('@release should call eth_gasPrice', async () => {
        const res = (await client.call(METHOD_NAME, [])) as string;
        expect(res).to.exist;
        if (ConfigService.get('LOCAL_NODE')) {
          expect(res).be.equal(expectedGasPrice);
        } else {
          expect(Number(res)).to.be.gt(0);
        }
      });
    });
  }
});
