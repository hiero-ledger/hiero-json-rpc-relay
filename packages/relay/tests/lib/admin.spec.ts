// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import pino from 'pino';
import { Registry } from 'prom-client';

import { Relay } from '../../src/lib/relay';
import { RequestDetails } from '../../src/lib/types';
import { withOverriddenEnvsInMochaTest } from '../helpers';

const logger = pino({ level: 'silent' });
let relay;

const requestDetails = new RequestDetails({ requestId: 'admin', ipAddress: '0.0.0.0' });
describe('Admin', async function () {
  it('should execute config', async () => {
    relay = new Relay(logger, new Registry());
    const res = await relay.admin().config(requestDetails);
    expect(res).to.haveOwnProperty('relay');
    expect(res).to.haveOwnProperty('upstreamDependencies');

    expect(res.relay).to.haveOwnProperty('version');
    expect(res.relay).to.haveOwnProperty('config');
    expect(res.relay.config).to.not.be.empty;

    for (const service of res.upstreamDependencies) {
      expect(service).to.haveOwnProperty('config');
      expect(service).to.haveOwnProperty('service');
      expect(service.config).to.not.be.empty;
    }
  });

  for (const [chainId, networkName] of Object.entries({
    '0x127': 'mainnet',
    '0x128': 'testnet',
    '0x129': 'previewnet'
  })) {
    withOverriddenEnvsInMochaTest({
        CHAIN_ID: chainId
      }, () => {
        it(`should return a valid consensus version for ${networkName}`, async () => {
          const tempRelay = new Relay(logger, new Registry());
          const res = await tempRelay.admin().config(requestDetails);
          const regex = /^\d+\.\d+\.\d+.*$/;
          expect(res.upstreamDependencies[0].version.match(regex)).to.not.be.empty;
        });
      }
    );
  }

  withOverriddenEnvsInMochaTest({
      CHAIN_ID: '0x12a'
    }, () => {
      it(`should return a valid consensus version for local network`, async () => {
        const tempRelay = new Relay(logger, new Registry());
        const res = await tempRelay.admin().config(requestDetails);
        expect(res.upstreamDependencies[0].version).to.equal('local');
      });
    }
  );
});
