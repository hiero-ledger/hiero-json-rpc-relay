// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import pino from 'pino';
import { Registry } from 'prom-client';

import { RelayImpl } from '../../src/lib/relay';
import { RequestDetails } from '../../src/lib/types';

const logger = pino({ level: 'silent' });
let Relay;

const requestDetails = new RequestDetails({ requestId: 'eth_estimateGasTest', ipAddress: '0.0.0.0' });
describe('Hedera', async function () {
  it('should execute admin.config', async () => {
    Relay = new RelayImpl(logger, new Registry());
    const res = await Relay.admin().config(requestDetails);
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
