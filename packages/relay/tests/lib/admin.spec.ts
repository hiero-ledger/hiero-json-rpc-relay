// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import pino from 'pino';
import { Registry } from 'prom-client';

import { Relay } from '../../src/lib/relay';
import { RequestDetails } from '../../src/lib/types';

const logger = pino({ level: 'silent' });
let relay;

const requestDetails = new RequestDetails({ requestId: 'eth_estimateGasTest', ipAddress: '0.0.0.0' });
describe('Hedera', async function () {
  it('should execute admin.config', async () => {
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
});
