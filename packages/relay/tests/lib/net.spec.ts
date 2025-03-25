// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { expect } from 'chai';
import pino from 'pino';
import { Registry } from 'prom-client';

import { Relay } from '../../src/lib/relay';
import { withOverriddenEnvsInMochaTest } from '../helpers';

const logger = pino({ level: 'silent' });
let relay: Relay;

describe('Net', async function () {
  it('should execute "net_listening"', function () {
    relay = new Relay(logger, new Registry());
    const result = relay.net().listening();
    expect(result).to.eq(false);
  });

  it('should execute "net_version"', function () {
    relay = new Relay(logger, new Registry());
    const expectedNetVersion = parseInt(ConfigService.get('CHAIN_ID'), 16).toString();

    const actualNetVersion = relay.net().version();
    expect(actualNetVersion).to.eq(expectedNetVersion);
  });

  withOverriddenEnvsInMochaTest({ CHAIN_ID: '123' }, () => {
    it('should set chainId from CHAIN_ID environment variable', () => {
      relay = new Relay(logger, new Registry());
      const actualNetVersion = relay.net().version();
      expect(actualNetVersion).to.equal('123');
    });
  });

  withOverriddenEnvsInMochaTest({ CHAIN_ID: '0x1a' }, () => {
    it('should set chainId from CHAIN_ID environment variable starting with 0x', () => {
      relay = new Relay(logger, new Registry());
      const actualNetVersion = relay.net().version();
      expect(actualNetVersion).to.equal('26'); // 0x1a in decimal is 26
    });
  });

  withOverriddenEnvsInMochaTest({ HEDERA_NETWORK: undefined }, () => {
    it('should throw error if required configuration is set to undefined', () => {
      expect(() => new Relay(logger, new Registry())).to.throw(
        'Configuration error: HEDERA_NETWORK is a mandatory configuration for relay operation.',
      );
    });
  });

  withOverriddenEnvsInMochaTest({ HEDERA_NETWORK: 'mainnet', CHAIN_ID: '0x2' }, () => {
    it('should prioritize CHAIN_ID over HEDERA_NETWORK', () => {
      relay = new Relay(logger, new Registry());
      const actualNetVersion = relay.net().version();
      expect(actualNetVersion).to.equal('2'); // 0x2 in decimal is 2
    });
  });
});
