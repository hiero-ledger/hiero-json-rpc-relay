// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import pino from 'pino';
import { Registry } from 'prom-client';

import { Relay } from '../../../src';
import { RequestDetails } from '../../../src/lib/types';

use(chaiAsPromised);

describe('@ethCommon', async function () {
  let relay: Relay;
  this.timeout(10000);

  const requestDetails = new RequestDetails({ requestId: 'eth_commonTest', ipAddress: '0.0.0.0' });

  this.beforeAll(() => {
    relay = new Relay(pino({ level: 'silent' }), new Registry());
  });

  describe('@ethCommon', async function () {
    it('should execute "eth_chainId"', async function () {
      const chainId = relay.eth().chainId(requestDetails);
      expect(chainId).to.be.equal(ConfigService.get('CHAIN_ID'));
    });

    it('should execute "eth_accounts"', async function () {
      const accounts = relay.eth().accounts(requestDetails);

      expect(accounts).to.be.an('Array');
      expect(accounts.length).to.be.equal(0);
    });

    it('should execute "eth_getUncleByBlockHashAndIndex"', async function () {
      const result = await relay.eth().getUncleByBlockHashAndIndex(requestDetails);
      expect(result).to.be.null;
    });

    it('should execute "eth_getUncleByBlockNumberAndIndex"', async function () {
      const result = await relay.eth().getUncleByBlockNumberAndIndex(requestDetails);
      expect(result).to.be.null;
    });

    it('should execute "eth_getUncleCountByBlockHash"', async function () {
      const result = await relay.eth().getUncleCountByBlockHash(requestDetails);
      expect(result).to.eq('0x0');
    });

    it('should execute "eth_getUncleCountByBlockNumber"', async function () {
      const result = await relay.eth().getUncleCountByBlockNumber(requestDetails);
      expect(result).to.eq('0x0');
    });

    it('should execute "eth_hashrate"', async function () {
      const result = await relay.eth().hashrate(requestDetails);
      expect(result).to.eq('0x0');
    });

    it('should execute "eth_mining"', async function () {
      const result = await relay.eth().mining(requestDetails);
      expect(result).to.eq(false);
    });

    it('should execute "eth_submitWork"', async function () {
      const result = await relay.eth().submitWork(requestDetails);
      expect(result).to.eq(false);
    });

    it('should execute "eth_syncing"', async function () {
      const result = await relay.eth().syncing(requestDetails);
      expect(result).to.eq(false);
    });

    it('should execute "eth_getWork"', async function () {
      const result = relay.eth().getWork(requestDetails);
      expect(result).to.have.property('code');
      expect(result.code).to.be.equal(-32601);
      expect(result).to.have.property('message');
      expect(result.message).to.be.equal('Unsupported JSON-RPC method');
    });

    it('should execute "eth_getProof"', async function () {
      const result = relay.eth().getProof(requestDetails);
      expect(result).to.have.property('code');
      expect(result.code).to.be.equal(-32601);
      expect(result).to.have.property('message');
      expect(result.message).to.be.equal('Unsupported JSON-RPC method');
    });

    it(`should execute "eth_createAccessList`, async function () {
      const result = relay.eth().createAccessList(requestDetails);
      expect(result).to.have.property('code');
      expect(result.code).to.be.equal(-32601);
      expect(result).to.have.property('message');
      expect(result.message).to.be.equal('Unsupported JSON-RPC method');
    });

    it('should execute "eth_blobBaseFee"', async function () {
      const result = relay.eth().blobBaseFee(requestDetails);
      expect(result).to.have.property('code');
      expect(result.code).to.be.equal(-32601);
      expect(result).to.have.property('message');
      expect(result.message).to.be.equal('Unsupported JSON-RPC method');
    });

    it('should execute "eth_maxPriorityFeePerGas"', async function () {
      const result = await relay.eth().maxPriorityFeePerGas(requestDetails);
      expect(result).to.eq('0x0');
    });
  });
});
