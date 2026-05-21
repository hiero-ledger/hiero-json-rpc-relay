// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import pino from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import { ConfigService } from '../../../src/config-service/services';
import { Relay } from '../../../src/relay/lib/relay';
import { withOverriddenEnvsInMochaTest } from '../helpers';

const logger = pino({ level: 'silent' });

describe('Net', async function () {
  before(() => {
    sinon.stub(Relay.prototype, <keyof Relay>'ensureOperatorHasBalance').resolves();
    sinon.stub(Relay.prototype, <keyof Relay>'waitForMirrorNode').resolves();
  });

  after(() => {
    sinon.restore();
  });
  it('should execute "net_listening"', async function () {
    const relay = await Relay.init(logger, new Registry());
    const result = relay.net().listening();
    expect(result).to.eq(true);
  });

  it('should execute "net_version"', async function () {
    const relay = await Relay.init(logger, new Registry());
    const expectedNetVersion = parseInt(ConfigService.get('CHAIN_ID'), 16).toString();

    const actualNetVersion = relay.net().version();
    expect(actualNetVersion).to.eq(expectedNetVersion);
  });

  withOverriddenEnvsInMochaTest({ CHAIN_ID: '123' }, () => {
    it('should set chainId from CHAIN_ID environment variable', async () => {
      const relay = await Relay.init(logger, new Registry());
      const actualNetVersion = relay.net().version();
      expect(actualNetVersion).to.equal('123');
    });
  });

  withOverriddenEnvsInMochaTest({ CHAIN_ID: '0x1a' }, () => {
    it('should set chainId from CHAIN_ID environment variable starting with 0x', async () => {
      const relay = await Relay.init(logger, new Registry());
      const actualNetVersion = relay.net().version();
      expect(actualNetVersion).to.equal('26'); // 0x1a in decimal is 26
    });
  });

  withOverriddenEnvsInMochaTest({ HEDERA_NETWORK: undefined }, () => {
    it('should throw error if required configuration is set to undefined', async () => {
      await expect(Relay.init(logger, new Registry())).to.be.rejectedWith(
        'Configuration error: HEDERA_NETWORK is a mandatory configuration for relay operation.',
      );
    });
  });

  withOverriddenEnvsInMochaTest({ HEDERA_NETWORK: 'mainnet', CHAIN_ID: '0x2' }, () => {
    it('should prioritize CHAIN_ID over HEDERA_NETWORK', async () => {
      const relay = await Relay.init(logger, new Registry());
      const actualNetVersion = relay.net().version();
      expect(actualNetVersion).to.equal('2'); // 0x2 in decimal is 2
    });
  });
});
