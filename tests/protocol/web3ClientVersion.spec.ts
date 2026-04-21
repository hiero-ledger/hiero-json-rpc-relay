// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { ConfigService } from '../../src/config-service/services';
import { ALL_PROTOCOL_CLIENTS } from './helpers/protocolClient';

describe('@release @protocol-acceptance web3_clientVersion', async function () {
  this.timeout(240 * 1000);
  const METHOD_NAME = 'web3_clientVersion';

  const expectedClientVersion = `relay/${ConfigService.get('npm_package_version')}`;

  after(async () => {
    if (global?.socketServer) {
      expect(global.socketServer._connections).to.eq(0);
    }
  });

  for (const client of ALL_PROTOCOL_CLIENTS) {
    describe(client.label, () => {
      it('@release should execute web3_clientVersion and handle valid requests correctly', async () => {
        const result = await client.call(METHOD_NAME, []);
        expect(result).to.exist;
        expect(result).to.be.a('string');
        expect(result).to.equal(expectedClientVersion);
      });
    });
  }
});
