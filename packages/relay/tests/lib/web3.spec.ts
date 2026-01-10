// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { expect } from 'chai';
import pino from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import { Relay } from '../../src';
import { Web3Impl } from '../../src/lib/web3';
import { withOverriddenEnvsInMochaTest } from '../helpers';

const web3Impl = new Web3Impl();
const logger = pino({ level: 'silent' });

describe('Web3', function () {
  before(async () => {
    sinon.stub(Relay.prototype, 'ensureOperatorHasBalance').resolves();
    await Relay.init(logger, new Registry());
  });

  after(() => {
    sinon.restore();
  });

  withOverriddenEnvsInMochaTest({ npm_package_version: '1.0.0' }, () => {
    it('should return "relay/1.0.0"', async function () {
      const clientVersion = web3Impl.clientVersion();
      expect(clientVersion).to.be.equal('relay/' + ConfigService.get('npm_package_version'));
    });
  });

  withOverriddenEnvsInMochaTest({ npm_package_version: undefined }, () => {
    it('should throw an error if npm_package_version is undefined', () => {
      expect(() => web3Impl.clientVersion()).to.throw(
        'Configuration error: npm_package_version is a mandatory configuration for relay operation.',
      );
    });
  });

  it('should return sha3 of the input', () => {
    expect(web3Impl.sha3('0x5644')).to.equal('0xf956fddff3899ff3cf7ac1773fdbf443ffbfb625c1a673abdba8947251f81bae');
  });
});
