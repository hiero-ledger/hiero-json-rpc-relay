// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { expect } from 'chai';
import pino from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';
import { v4 as uuid } from 'uuid';

import { numberTo0x, prepend0x, tinybarsToWeibars } from '../../../../../src/formatters';
import { MirrorNodeClient } from '../../../../../src/lib/clients/mirrorNodeClient';
import { CacheClientFactory } from '../../../../../src/lib/factories/cacheClientFactory';
import { CommonService } from '../../../../../src/lib/services';
import { MirrorNodeBlock, MirrorNodeContractResult, RequestDetails } from '../../../../../src/lib/types';
import { toHex } from '../../../../helpers';

const logger = pino({ level: 'silent' });
const registry = new Registry();

describe('CommonService', () => {
  describe('getPaymasterIfTxCanBeSubsidized', async () => {
    let configStub: sinon.SinonStub;

    beforeEach(() => {
      // reset maps before each test
      (CommonService as any).PAYMASTER_ACCOUNTS_WHITELISTS_MAP = new Map();
      (CommonService as any).PAYMASTER_ACCOUNTS_MAP = new Map();

      configStub = sinon.stub(ConfigService, 'get');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return paymaster account when toAddress is whitelisted in PAYMASTER_ACCOUNTS_WHITELISTS_MAP', () => {
      const toAddress = '0x0000000000000000000000000000000000000000';
      const normalized = prepend0x(toAddress.toLowerCase());

      (CommonService as any).PAYMASTER_ACCOUNTS_WHITELISTS_MAP.set(normalized, '0.0.9303');
      (CommonService as any).PAYMASTER_ACCOUNTS_MAP.set('0.0.9303', ['0.0.9303', null, null, 100]);

      const result = CommonService.getPaymasterIfTxCanBeSubsidized(toAddress);

      expect(result).to.deep.equal({
        accountId: '0.0.9303',
        gasAllowance: 100,
      });
    });

    it('should return null when whitelisted accountId exists but PAYMASTER_ACCOUNTS_MAP has no entry', () => {
      const toAddress = '0x0000000000000000000000000000000000000000';
      const normalized = prepend0x(toAddress.toLowerCase());

      (CommonService as any).PAYMASTER_ACCOUNTS_WHITELISTS_MAP.set(normalized, '0.0.9303');

      configStub.withArgs('PAYMASTER_ENABLED').returns(false);

      const result = CommonService.getPaymasterIfTxCanBeSubsidized(toAddress);

      expect(result).to.equal(null);
    });

    it('should return default paymaster when PAYMASTER_ENABLED and whitelist contains *', () => {
      (CommonService as any).PAYMASTER_WHITELIST = ['*'];
      configStub.withArgs('PAYMASTER_ENABLED').returns(true);
      configStub.withArgs('OPERATOR_ID_MAIN').returns('0.0.1000');
      configStub.withArgs('MAX_GAS_ALLOWANCE_HBAR').returns(120);

      const result = CommonService.getPaymasterIfTxCanBeSubsidized('0xdef');

      expect(result).to.deep.equal({
        accountId: '0.0.1000',
        gasAllowance: 120,
      });
    });

    it('should return default paymaster when address is in PAYMASTER_WHITELIST', () => {
      const toAddress = '0x0000000000000000000000000000000000000000';
      const normalized = prepend0x(toAddress.toLowerCase());

      (CommonService as any).PAYMASTER_WHITELIST = [normalized];
      configStub.withArgs('PAYMASTER_ENABLED').returns(true);
      configStub.withArgs('OPERATOR_ID_MAIN').returns('0.0.1000');
      configStub.withArgs('MAX_GAS_ALLOWANCE_HBAR').returns(500);

      const result = CommonService.getPaymasterIfTxCanBeSubsidized(toAddress);

      expect(result).to.deep.equal({
        accountId: '0.0.1000',
        gasAllowance: 500,
      });
    });

    it('should return null when PAYMASTER_ENABLED is false and no whitelist match', () => {
      configStub.withArgs('PAYMASTER_ENABLED').returns(false);

      const result = CommonService.getPaymasterIfTxCanBeSubsidized('0x0000000000000000000000000000000000000000');

      expect(result).to.equal(null);
    });

    it('should return null when toAddress is null and default whitelist does not apply', () => {
      configStub.withArgs('PAYMASTER_ENABLED').returns(true);
      configStub.withArgs('PAYMASTER_WHITELIST').returns([]);
      configStub.withArgs('OPERATOR_ID_MAIN').returns('0.0.1000');
      configStub.withArgs('MAX_GAS_ALLOWANCE_HBAR').returns(500);

      const result = CommonService.getPaymasterIfTxCanBeSubsidized(null);

      expect(result).to.equal(null);
    });
  });

  describe('computeBlockBaseFeePerGas', async () => {
    let commonService: CommonService;
    let getGasPriceStub: sinon.SinonStub;
    const requestDetails = new RequestDetails({ requestId: uuid(), ipAddress: '0.0.0.0' });

    // Simulated network gas fee: 94 tinybars = 940 gwei
    const NETWORK_FEE_WEI = tinybarsToWeibars(94)!; // 940_000_000_000n

    const toWei = (value: number) => BigInt(tinybarsToWeibars(value)!);

    const block: MirrorNodeBlock = {
      count: 2,
      gas_used: 1000,
      hapi_version: '0.27.0',
      hash: '0x0b611ed305e707daf11e0092ff8789dcd58385eb90bebe5a9d25dadce3d120da',
      logs_bloom: '0x',
      name: '2024-01-01T00_00_00.000000000Z.rcd',
      number: 33407844,
      previous_hash: '0x',
      size: 100,
      timestamp: { from: '1651560386.060890949', to: '1651560389.060890949' },
    };

    before(() => {
      const cacheService = CacheClientFactory.create(logger, registry);
      const mirrorNodeInstance = new MirrorNodeClient(
        ConfigService.get('MIRROR_NODE_URL'),
        logger.child({ name: 'mirror-node' }),
        registry,
        cacheService,
      );
      commonService = new CommonService(mirrorNodeInstance, logger, cacheService);
    });

    beforeEach(() => {
      getGasPriceStub = sinon.stub(commonService as any, 'getGasPriceInWeibars').resolves(Number(NETWORK_FEE_WEI));
    });

    afterEach(() => sinon.restore());

    describe('Empty or zero-gas blocks', () => {
      it('empty contractResults: returns network fee anchored to block timestamp', async () => {
        const result = await commonService.computeBlockBaseFeePerGas([], block, requestDetails);

        expect(result).to.equal(numberTo0x(NETWORK_FEE_WEI));
        sinon.assert.calledOnceWithMatch(getGasPriceStub, requestDetails, `lte:${block.timestamp.to}`);
      });

      it('block.gas_used === 0: returns network fee anchored to block timestamp', async () => {
        const result = await commonService.computeBlockBaseFeePerGas(
          [{ gas_price: toHex(100), gas_used: 0, type: 1 } as MirrorNodeContractResult],
          { ...block, gas_used: 0 },
          requestDetails,
        );

        expect(result).to.equal(numberTo0x(NETWORK_FEE_WEI));
        sinon.assert.calledOnceWithMatch(getGasPriceStub, requestDetails, `lte:${block.timestamp.to}`);
      });
    });

    describe('Pre EIP-1559 transactions', () => {
      it('mixed type 0 and type 1 txs: both contribute to weighted average, no network call', async () => {
        // type 0 (legacy) and type 1 (access list) both carry an explicit gas_price
        // tx0: type 0, 90 tinybars × 400 gas; tx1: type 1, 100 tinybars × 600 gas
        // weighted = (90×400 + 100×600) / 1000 = (36000 + 60000) / 1000 = 96 tinybars
        const contractResults = [
          { gas_price: toHex(90), gas_used: 400, type: 0 },
          { gas_price: toHex(100), gas_used: 600, type: 1 },
        ] as MirrorNodeContractResult[];
        // @ts-ignore
        const expected = (toWei(90) * 400n + toWei(100) * 600n) / 1000n;

        const result = await commonService.computeBlockBaseFeePerGas(contractResults, block, requestDetails);

        expect(result).to.equal(numberTo0x(expected));
        sinon.assert.notCalled(getGasPriceStub);
      });

      it('pure type 1 block: weighted average from gas_price, no network call', async () => {
        // tx1: 94 tinybars × 300 gas; tx2: 100 tinybars × 700 gas
        // weighted = (94×300 + 100×700) / 1000 = 98.2 → truncated to 98 tinybars
        const contractResults = [
          { gas_price: toHex(94), gas_used: 300, type: 1 },
          { gas_price: toHex(100), gas_used: 700, type: 1 },
        ] as MirrorNodeContractResult[];
        // @ts-ignore
        const expected = (toWei(94) * 300n + toWei(100) * 700n) / 1000n;

        const result = await commonService.computeBlockBaseFeePerGas(contractResults, block, requestDetails);

        expect(result).to.equal(numberTo0x(expected));
        sinon.assert.notCalled(getGasPriceStub);
      });

      it('pure type 1 block, uniform price: returns that exact gas price', async () => {
        const contractResults = [
          { gas_price: toHex(94), gas_used: 500, type: 1 },
          { gas_price: toHex(94), gas_used: 500, type: 1 },
        ] as MirrorNodeContractResult[];

        const result = await commonService.computeBlockBaseFeePerGas(contractResults, block, requestDetails);
        // @ts-ignore
        expect(result).to.equal(numberTo0x(toWei(94)));
        sinon.assert.notCalled(getGasPriceStub);
      });

      it('pure type 1 block: network fee is never fetched', async () => {
        const contractResults = [
          { gas_price: toHex(94), gas_used: 500, type: 1 },
          { gas_price: toHex(100), gas_used: 500, type: 1 },
        ] as MirrorNodeContractResult[];

        await commonService.computeBlockBaseFeePerGas(contractResults, block, requestDetails);

        sinon.assert.notCalled(getGasPriceStub);
      });
    });

    describe('Post EIP-1559 transactions', () => {
      // Both type 2 (EIP-1559) and type 4 (EIP-7702) use max_fee_per_gas + max_priority_fee_per_gas.
      // effectiveGasPrice = min(maxFeePerGas, networkFee + priorityFee)

      it('priorityFee=0: effectivePrice = networkFee regardless of type (2 or 4)', async () => {
        // max_fee > networkFee, priority_fee=0 => effective = min(maxFee, networkFee+0) = networkFee
        // type 2: max_fee=130; type 4: max_fee=120 — both collapse to networkFee(94)
        const contractResults = [
          { gas_price: '0x', gas_used: 500, type: 2, max_fee_per_gas: toHex(130), max_priority_fee_per_gas: toHex(0) },
          { gas_price: '0x', gas_used: 500, type: 4, max_fee_per_gas: toHex(120), max_priority_fee_per_gas: toHex(0) },
        ] as MirrorNodeContractResult[];

        const result = await commonService.computeBlockBaseFeePerGas(contractResults, block, requestDetails);

        expect(result).to.equal(numberTo0x(NETWORK_FEE_WEI));
        sinon.assert.calledOnceWithMatch(getGasPriceStub, requestDetails, `lte:${block.timestamp.to}`);
      });

      it('priorityFee=maxFeePerGas: effectivePrice = maxFeePerGas (cap always hit) for type 2 and type 4', async () => {
        // max_fee=95, priority_fee=95 => effective = min(95, 94+95) = min(95, 189) = 95
        // same formula applies for both type 2 and type 4
        const contractResults = [
          { gas_price: '0x', gas_used: 500, type: 2, max_fee_per_gas: toHex(95), max_priority_fee_per_gas: toHex(95) },
          { gas_price: '0x', gas_used: 500, type: 4, max_fee_per_gas: toHex(95), max_priority_fee_per_gas: toHex(95) },
        ] as MirrorNodeContractResult[];

        const result = await commonService.computeBlockBaseFeePerGas(contractResults, block, requestDetails);

        expect(result).to.equal(numberTo0x(toWei(95)));
        sinon.assert.calledOnce(getGasPriceStub);
      });

      it('priorityFee set, cap not hit: effectivePrice = networkFee + priorityFee for type 2 and type 4', async () => {
        // type 2: max_fee=130, priority=10 => effective = min(130, 94+10) = 104
        // type 4: max_fee=130, priority=10 => effective = min(130, 94+10) = 104
        // weighted = (toWei(104)*500 + toWei(104)*500) / 1000 = toWei(104)
        const contractResults = [
          { gas_price: '0x', gas_used: 500, type: 2, max_fee_per_gas: toHex(130), max_priority_fee_per_gas: toHex(10) },
          { gas_price: '0x', gas_used: 500, type: 4, max_fee_per_gas: toHex(130), max_priority_fee_per_gas: toHex(10) },
        ] as MirrorNodeContractResult[];

        const result = await commonService.computeBlockBaseFeePerGas(contractResults, block, requestDetails);

        expect(result).to.equal(numberTo0x(toWei(94 + 10))); // networkFee + priorityFee
        sinon.assert.calledOnce(getGasPriceStub);
      });

      it('priorityFee set, cap hit: effectivePrice = maxFeePerGas for type 2 and type 4', async () => {
        // type 2: max_fee=95, priority=10 => effective = min(95, 94+10) = min(95, 104) = 95
        // type 4: max_fee=95, priority=10 => effective = min(95, 94+10) = 95
        const contractResults = [
          { gas_price: '0x', gas_used: 500, type: 2, max_fee_per_gas: toHex(95), max_priority_fee_per_gas: toHex(10) },
          { gas_price: '0x', gas_used: 500, type: 4, max_fee_per_gas: toHex(95), max_priority_fee_per_gas: toHex(10) },
        ] as MirrorNodeContractResult[];

        const result = await commonService.computeBlockBaseFeePerGas(contractResults, block, requestDetails);

        expect(result).to.equal(numberTo0x(toWei(95)));
        sinon.assert.calledOnce(getGasPriceStub);
      });

      it('mixed type 2 + type 4 with different fees: weighted average over both', async () => {
        // type 2: max_fee=130, priority=10 => effective = min(130, 94+10) = 104, gas_used=500
        // type 4: max_fee=95,  priority=5  => effective = min(95,  94+5)  = 95  (cap hit), gas_used=500
        // weighted = (toWei(104)*500 + toWei(95)*500) / 1000 = toWei(99) (truncated from 99.5)
        const contractResults = [
          { gas_price: '0x', gas_used: 500, type: 2, max_fee_per_gas: toHex(130), max_priority_fee_per_gas: toHex(10) },
          { gas_price: '0x', gas_used: 500, type: 4, max_fee_per_gas: toHex(95), max_priority_fee_per_gas: toHex(5) },
        ] as MirrorNodeContractResult[];
        // @ts-ignore
        const expected = (toWei(104) * 500n + toWei(95) * 500n) / 1000n;

        const result = await commonService.computeBlockBaseFeePerGas(contractResults, block, requestDetails);

        expect(result).to.equal(numberTo0x(expected));
        sinon.assert.calledOnce(getGasPriceStub); // fetched once, shared by type 2 and type 4
      });
    });

    describe('Mixed Pre and Post EIP-1559 transactions', () => {
      it('mixed type 1 + type 2 (priorityFee=0): weighted average over full block gas', async () => {
        // type1: gas_price=94, gas_used=500 => 94 * 500 tinybars
        // type2: max_fee=130, priority_fee=0, networkFee=94 => effective=94, gas_used=500 => 94 * 500
        // baseFee = (94*500 + 94*500) / 1000 = 94 tinybars = networkFee
        const contractResults = [
          { gas_price: toHex(94), gas_used: 500, type: 1 },
          { gas_price: '0x', gas_used: 500, type: 2, max_fee_per_gas: toHex(130), max_priority_fee_per_gas: toHex(0) },
        ] as MirrorNodeContractResult[];

        const result = await commonService.computeBlockBaseFeePerGas(contractResults, block, requestDetails);

        expect(result).to.equal(numberTo0x(NETWORK_FEE_WEI));
        sinon.assert.calledOnce(getGasPriceStub);
      });

      it('mixed type 1 + type 2 with priorityFee: weighted average reflects actual effective prices', async () => {
        // type1: gas_price=94, gas_used=500 => effective=94
        // type2: max_fee=130, priority_fee=10, networkFee=94 => effective=min(130,104)=104, gas_used=500
        // baseFee = (toWei(94)*500 + toWei(104)*500) / 1000
        const contractResults = [
          { gas_price: toHex(94), gas_used: 500, type: 1 },
          { gas_price: '0x', gas_used: 500, type: 2, max_fee_per_gas: toHex(130), max_priority_fee_per_gas: toHex(10) },
        ] as MirrorNodeContractResult[];
        // @ts-ignore
        const expected = (toWei(94) * 500n + toWei(104) * 500n) / 1000n;

        const result = await commonService.computeBlockBaseFeePerGas(contractResults, block, requestDetails);

        expect(result).to.equal(numberTo0x(expected));
        sinon.assert.calledOnce(getGasPriceStub);
      });

      it('mixed type 1 + type 2 + type 4: network fee fetched exactly once', async () => {
        const contractResults = [
          { gas_price: toHex(94), gas_used: 200, type: 1 },
          { gas_price: '0x', gas_used: 300, type: 2, max_fee_per_gas: toHex(130), max_priority_fee_per_gas: toHex(0) },
          { gas_price: '0x', gas_used: 500, type: 4, max_fee_per_gas: toHex(95), max_priority_fee_per_gas: toHex(95) },
        ] as MirrorNodeContractResult[];

        await commonService.computeBlockBaseFeePerGas(contractResults, block, requestDetails);

        sinon.assert.calledOnce(getGasPriceStub);
      });
    });
  });
});
