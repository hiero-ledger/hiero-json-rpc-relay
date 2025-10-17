// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import pino from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import { Relay } from '../../src/lib/relay';
import { withOverriddenEnvsInMochaTest } from '../helpers';

const logger = pino({ level: 'silent' });
let relay: Relay;

describe('Admin', async function () {
  // we used to initialize the relay by using the constructor, but now we use the init method
  // which checks the operator balance, we want to stub this method, its not part of the test
  before(() => {
    sinon.stub(Relay.prototype, 'ensureOperatorHasBalance').resolves();
  });

  after(() => {
    sinon.restore();
  });

  it('should execute config', async () => {
    relay = await Relay.init(logger, new Registry());
    const res = await relay.admin().config();
    expect(res).to.haveOwnProperty('relay');
    expect(res).to.haveOwnProperty('upstreamDependencies');

    expect(res.relay).to.haveOwnProperty('version');
    expect(res.relay).to.haveOwnProperty('config');
    const keys = Object.keys(res.relay.config);
    expect(keys).to.have.length.greaterThan(0);

    for (const service of res.upstreamDependencies) {
      expect(service).to.haveOwnProperty('config');
      expect(service).to.haveOwnProperty('service');
      const keys = Object.keys(service.config);
      expect(keys).to.have.length.greaterThan(0);
    }
  });

  for (const [chainId, networkName] of Object.entries({
    '0x127': 'mainnet',
    '0x128': 'testnet',
    '0x129': 'previewnet',
  })) {
    withOverriddenEnvsInMochaTest(
      {
        CHAIN_ID: chainId,
      },
      () => {
        it(`should return a valid consensus version for ${networkName}`, async () => {
          const tempRelay = await Relay.init(logger, new Registry());
          const res = await tempRelay.admin().config();
          const regex = /^\d+\.\d+\.\d+.*$/;
          expect(res.upstreamDependencies[0].version.match(regex)).to.have.length.greaterThan(0);
        });
      },
    );
  }

  withOverriddenEnvsInMochaTest(
    {
      CHAIN_ID: '0x12a',
    },
    () => {
      it(`should return a valid consensus version for local network`, async () => {
        const tempRelay = await Relay.init(logger, new Registry());
        const res = await tempRelay.admin().config();
        expect(res.upstreamDependencies[0].version).to.equal('local');
      });
    },
  );
});
