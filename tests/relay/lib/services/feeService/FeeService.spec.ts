// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { Logger } from 'pino';
import sinon from 'sinon';

import { numberTo0x } from '../../../../../src/relay/formatters';
import * as blockGasLimit from '../../../../../src/relay/lib/config/blockGasLimit';
import constants from '../../../../../src/relay/lib/constants';
import { FeeService } from '../../../../../src/relay/lib/services/ethService/feeService/FeeService';
import {
  IFeeHistory,
  MirrorNodeBlock,
  MirrorNodeContractResult,
  RequestDetails,
} from '../../../../../src/relay/lib/types';
import { withOverriddenEnvsInMochaTest } from '../../../helpers';

describe('FeeService', function () {
  const requestDetails = new RequestDetails({ requestId: 'feeServiceUnitTest', ipAddress: '0.0.0.0' });

  function minimalMirrorBlock(
    number: number,
    gasUsed: number,
    hapiVersion: string = '0.0.0',
    timestamp: { from: string; to: string } = { from: '1651560386.0', to: '1651560389.0' },
  ): MirrorNodeBlock {
    return {
      count: 0,
      gas_used: gasUsed,
      hapi_version: hapiVersion,
      hash: '0x',
      logs_bloom: '0x',
      name: '',
      number,
      previous_hash: '0x',
      size: 0,
      timestamp,
    };
  }

  // Unique timestamp per block number so sinon withArgs can differentiate CR stubs.
  function makeBlock(n: number, gasUsed: number, hapiVersion = '0.0.0'): MirrorNodeBlock {
    return minimalMirrorBlock(n, gasUsed, hapiVersion, { from: `${n * 100}.0`, to: `${n * 100 + 99}.0` });
  }

  describe('feeHistory (happy path)', function () {
    let feeService: FeeService;
    let mirrorStub: { getBlock: sinon.SinonStub; getContractResults: sinon.SinonStub };
    let commonStub: {
      translateBlockTag: sinon.SinonStub;
      getGasPriceInWeibars: sinon.SinonStub;
      computeGasWeightedAvgFeePerGas: sinon.SinonStub;
    };

    withOverriddenEnvsInMochaTest({ TEST: true, ETH_FEE_HISTORY_FIXED: false }, () => {
      beforeEach(function () {
        mirrorStub = { getBlock: sinon.stub(), getContractResults: sinon.stub() };
        commonStub = {
          translateBlockTag: sinon.stub(),
          getGasPriceInWeibars: sinon.stub(),
          computeGasWeightedAvgFeePerGas: sinon.stub(),
        };

        const logger = { error: sinon.stub(), warn: sinon.stub() } as unknown as Logger;
        feeService = new FeeService(mirrorStub as any, commonStub as any, logger);

        const head = 100;
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);

        const block = minimalMirrorBlock(head, 1_000_000, '0.0.0');
        mirrorStub.getBlock.withArgs(head, requestDetails).resolves(block);
        mirrorStub.getContractResults.resolves([]);
        commonStub.computeGasWeightedAvgFeePerGas.resolves(numberTo0x(77));
        commonStub.getGasPriceInWeibars.withArgs(requestDetails).resolves(77);
      });

      afterEach(function () {
        sinon.restore();
      });

      it('returns fee history with gasUsedRatio from obtainBlockGasLimit(hapi_version) when newest block is latest', async () => {
        const result = await feeService.feeHistory(1, 'latest', null, requestDetails);

        expect(result).to.not.have.property('code');
        const feeHistory = result as IFeeHistory;
        const expectedLimit = blockGasLimit.obtainBlockGasLimit('0.0.0');
        expect(feeHistory.oldestBlock).to.equal(numberTo0x(100));
        expect(feeHistory.gasUsedRatio).to.deep.equal([1_000_000 / expectedLimit]);
        expect(feeHistory.baseFeePerGas).to.deep.equal([numberTo0x(77), numberTo0x(77)]);
        expect(mirrorStub.getBlock.callCount).to.equal(1);
        expect(mirrorStub.getBlock.firstCall.args).to.deep.equal([100, requestDetails]);
      });
    });
  });

  describe('getGasUsedRatioForBlock (private)', function () {
    let warnSpy: sinon.SinonSpy;
    let feeService: FeeService;
    let obtainStub: sinon.SinonStub;

    function ratioFor(block: MirrorNodeBlock): number {
      return (feeService as any).getGasUsedRatioForBlock(block);
    }

    beforeEach(function () {
      warnSpy = sinon.spy();
      feeService = new FeeService({} as any, {} as any, { warn: warnSpy } as unknown as Logger);
      obtainStub = sinon.stub(blockGasLimit, 'obtainBlockGasLimit').callThrough();
    });

    afterEach(function () {
      sinon.restore();
    });

    it('returns gasUsed / obtainBlockGasLimit(hapi_version) when within limit (0.0.0 tier)', function () {
      expect(ratioFor(minimalMirrorBlock(1, 7_500_000, '0.0.0'))).to.equal(0.25);
      expect(warnSpy.called).to.be.false;
    });

    it('uses higher limit for 0.69.0 HAPI version', function () {
      const limit = blockGasLimit.obtainBlockGasLimit('0.69.0');
      expect(limit).to.equal(150_000_000);
      expect(ratioFor(minimalMirrorBlock(1, 75_000_000, '0.69.0'))).to.equal(0.5);
      expect(warnSpy.called).to.be.false;
    });

    it('returns 0 when gasUsed is 0', function () {
      expect(ratioFor(minimalMirrorBlock(2, 0, '0.0.0'))).to.equal(0);
      expect(warnSpy.called).to.be.false;
    });

    it('treats missing gas_used as 0', function () {
      const block = minimalMirrorBlock(3, 0, '0.0.0');
      (block as { gas_used: number | undefined }).gas_used = undefined;
      expect(ratioFor(block)).to.equal(0);
      expect(warnSpy.called).to.be.false;
    });

    it('returns 1 when gasUsed equals block gas limit for that HAPI version', function () {
      const limit = blockGasLimit.obtainBlockGasLimit('0.0.0');
      expect(ratioFor(minimalMirrorBlock(4, limit, '0.0.0'))).to.equal(1);
      expect(warnSpy.called).to.be.false;
    });

    it('returns 1 and warns when gasUsed exceeds obtainBlockGasLimit', function () {
      const gasUsed = blockGasLimit.obtainBlockGasLimit('0.0.0') + 1;
      expect(ratioFor(minimalMirrorBlock(5, gasUsed, '0.0.0'))).to.equal(1);
      expect(warnSpy.calledOnce).to.be.true;
    });

    it('returns a fractional ratio when stub supplies a small limit', function () {
      obtainStub.returns(7);
      expect(ratioFor(minimalMirrorBlock(8, 3, '0.0.0'))).to.be.closeTo(3 / 7, 1e-12);
      expect(warnSpy.called).to.be.false;
    });

    it('uses DEFAULT_BLOCK_GAS_LIMIT when hapi_version is invalid (obtainBlockGasLimit fallback)', function () {
      const gasUsed = constants.DEFAULT_BLOCK_GAS_LIMIT / 4;
      expect(ratioFor(minimalMirrorBlock(9, gasUsed, 'not-a-version'))).to.equal(0.25);
      expect(warnSpy.called).to.be.false;
    });
  });

  describe('feeHistory: per-block fee resolution', () => {
    let feeService: FeeService;
    let mirrorStub: { getBlock: sinon.SinonStub; getContractResults: sinon.SinonStub };
    let commonStub: {
      translateBlockTag: sinon.SinonStub;
      getGasPriceInWeibars: sinon.SinonStub;
      computeGasWeightedAvgFeePerGas: sinon.SinonStub;
    };
    let warnSpy: sinon.SinonSpy;

    const NETWORK_FEE_WEIBARS = 57 * constants.TINYBAR_TO_WEIBAR_COEF;
    const NETWORK_FEE_HEX = numberTo0x(NETWORK_FEE_WEIBARS);
    const HEAD = 10;

    withOverriddenEnvsInMochaTest({ TEST: true, ETH_FEE_HISTORY_FIXED: false }, () => {
      beforeEach(function () {
        warnSpy = sinon.spy();
        mirrorStub = { getBlock: sinon.stub(), getContractResults: sinon.stub() };
        commonStub = {
          translateBlockTag: sinon.stub(),
          getGasPriceInWeibars: sinon.stub(),
          computeGasWeightedAvgFeePerGas: sinon.stub(),
        };
        const logger = { error: sinon.stub(), warn: warnSpy } as unknown as Logger;
        feeService = new FeeService(mirrorStub as any, commonStub as any, logger);

        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(HEAD);
        commonStub.getGasPriceInWeibars.withArgs(requestDetails).resolves(NETWORK_FEE_WEIBARS);
      });

      afterEach(function () {
        sinon.restore();
      });

      it('block fetch fails: baseFeePerGas[0] = ZERO_HEX and gasUsedRatio[0] = 0, logs warning', async () => {
        mirrorStub.getBlock.rejects(new Error('mirror node down'));

        const result = await feeService.feeHistory(1, 'latest', null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.baseFeePerGas![0]).to.equal(constants.ZERO_HEX);
        expect(feeHistory.gasUsedRatio![0]).to.equal(0);
        sinon.assert.calledOnce(warnSpy);
        sinon.assert.notCalled(mirrorStub.getContractResults);
      });

      it('block not found (null): baseFeePerGas[0] = ZERO_HEX and gasUsedRatio[0] = 0', async () => {
        mirrorStub.getBlock.resolves(null);

        const result = await feeService.feeHistory(1, 'latest', null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.baseFeePerGas![0]).to.equal(constants.ZERO_HEX);
        expect(feeHistory.gasUsedRatio![0]).to.equal(0);
        sinon.assert.notCalled(mirrorStub.getContractResults);
      });

      it('empty block (gas_used=0): skips contract results fetch, fee from computeGasWeightedAvgFeePerGas with empty results', async () => {
        const block = makeBlock(HEAD, 0);
        mirrorStub.getBlock.resolves(block);
        commonStub.computeGasWeightedAvgFeePerGas.withArgs([], block, requestDetails).resolves(NETWORK_FEE_HEX);

        const result = await feeService.feeHistory(1, 'latest', null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.baseFeePerGas![0]).to.equal(NETWORK_FEE_HEX);
        sinon.assert.notCalled(mirrorStub.getContractResults);
        sinon.assert.calledWithExactly(commonStub.computeGasWeightedAvgFeePerGas, [], block, requestDetails);
      });

      it('non-empty block: fetches contract results by block timestamp range', async () => {
        const block = makeBlock(HEAD, 100_000);
        const crs = [{ gas_price: NETWORK_FEE_HEX, gas_used: 100_000, type: 1 }] as MirrorNodeContractResult[];
        mirrorStub.getBlock.resolves(block);
        mirrorStub.getContractResults
          .withArgs(requestDetails, { timestamp: [`gte:${block.timestamp.from}`, `lte:${block.timestamp.to}`] })
          .resolves(crs);
        commonStub.computeGasWeightedAvgFeePerGas.withArgs(crs, block, requestDetails).resolves(NETWORK_FEE_HEX);

        const result = await feeService.feeHistory(1, 'latest', null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.baseFeePerGas![0]).to.equal(NETWORK_FEE_HEX);
        sinon.assert.calledOnce(mirrorStub.getContractResults);
      });

      it('contract results fetch fails: falls back to computeGasWeightedAvgFeePerGas with empty results', async () => {
        const block = makeBlock(HEAD, 100_000);
        mirrorStub.getBlock.resolves(block);
        mirrorStub.getContractResults.rejects(new Error('timeout'));
        commonStub.computeGasWeightedAvgFeePerGas.withArgs([], block, requestDetails).resolves(NETWORK_FEE_HEX);

        const result = await feeService.feeHistory(1, 'latest', null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.baseFeePerGas![0]).to.equal(NETWORK_FEE_HEX);
        sinon.assert.calledWithExactly(commonStub.computeGasWeightedAvgFeePerGas, [], block, requestDetails);
      });

      it('gasUsedRatio reflects block.gas_used / blockGasLimit', async () => {
        const limit = blockGasLimit.obtainBlockGasLimit('0.0.0');
        const block = makeBlock(HEAD, limit / 2);
        mirrorStub.getBlock.resolves(block);
        mirrorStub.getContractResults.resolves([]);
        commonStub.computeGasWeightedAvgFeePerGas.resolves(NETWORK_FEE_HEX);

        const result = await feeService.feeHistory(1, 'latest', null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.gasUsedRatio![0]).to.equal(0.5);
      });

      it('computeGasWeightedAvgFeePerGas throws: baseFeePerGas[0] = ZERO_HEX and logs warning', async () => {
        const block = makeBlock(HEAD, 100_000);
        mirrorStub.getBlock.resolves(block);
        mirrorStub.getContractResults.resolves([]);
        commonStub.computeGasWeightedAvgFeePerGas.rejects(new Error('compute failed'));
        commonStub.getGasPriceInWeibars.withArgs(requestDetails).resolves(NETWORK_FEE_WEIBARS);

        const result = await feeService.feeHistory(1, 'latest', null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.baseFeePerGas![0]).to.equal(constants.ZERO_HEX);
        sinon.assert.calledOnce(warnSpy);
      });
    });
  });

  describe('feeHistory', function () {
    let feeService: FeeService;
    let mirrorStub: { getBlock: sinon.SinonStub; getContractResults: sinon.SinonStub };
    let commonStub: {
      translateBlockTag: sinon.SinonStub;
      getGasPriceInWeibars: sinon.SinonStub;
      computeGasWeightedAvgFeePerGas: sinon.SinonStub;
    };

    const NETWORK_FEE_WEIBARS = 57 * constants.TINYBAR_TO_WEIBAR_COEF;
    const NETWORK_FEE_HEX = numberTo0x(NETWORK_FEE_WEIBARS);

    withOverriddenEnvsInMochaTest({ TEST: true, ETH_FEE_HISTORY_FIXED: false }, () => {
      beforeEach(function () {
        mirrorStub = { getBlock: sinon.stub(), getContractResults: sinon.stub() };
        commonStub = {
          translateBlockTag: sinon.stub(),
          getGasPriceInWeibars: sinon.stub(),
          computeGasWeightedAvgFeePerGas: sinon.stub(),
        };
        const logger = { error: sinon.stub(), warn: sinon.stub() } as unknown as Logger;
        feeService = new FeeService(mirrorStub as any, commonStub as any, logger);
        mirrorStub.getContractResults.resolves([]);
      });

      afterEach(function () {
        sinon.restore();
      });

      it('single block: baseFeePerGas[0] is block fee and baseFeePerGas[1] is live price', async () => {
        const head = 10;
        const block = makeBlock(head, 0);
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);
        mirrorStub.getBlock.withArgs(head, requestDetails).resolves(block);
        commonStub.computeGasWeightedAvgFeePerGas.withArgs([], block, requestDetails).resolves(NETWORK_FEE_HEX);
        commonStub.getGasPriceInWeibars.withArgs(requestDetails).resolves(NETWORK_FEE_WEIBARS);

        const result = await feeService.feeHistory(1, 'latest', null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.baseFeePerGas![0]).to.equal(NETWORK_FEE_HEX);
        expect(feeHistory.gasUsedRatio![0]).to.equal(0);
        expect(feeHistory.baseFeePerGas).to.have.length(2);
      });

      it('multi-block: baseFeePerGas and gasUsedRatio are ordered oldest to newest', async () => {
        const head = 12;
        const limit = blockGasLimit.obtainBlockGasLimit('0.0.0');
        const block11 = makeBlock(11, limit / 4);
        const block12 = makeBlock(12, limit / 2);
        const fee11 = numberTo0x(NETWORK_FEE_WEIBARS);
        const fee12 = numberTo0x(NETWORK_FEE_WEIBARS * 2);
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);
        mirrorStub.getBlock.withArgs(11, requestDetails).resolves(block11);
        mirrorStub.getBlock.withArgs(12, requestDetails).resolves(block12);
        commonStub.computeGasWeightedAvgFeePerGas.withArgs([], block11, requestDetails).resolves(fee11);
        commonStub.computeGasWeightedAvgFeePerGas.withArgs([], block12, requestDetails).resolves(fee12);
        commonStub.getGasPriceInWeibars.withArgs(requestDetails).resolves(NETWORK_FEE_WEIBARS);

        const result = await feeService.feeHistory(2, 'latest', null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.baseFeePerGas).to.have.length(3);
        expect(feeHistory.baseFeePerGas![0]).to.equal(fee11);
        expect(feeHistory.baseFeePerGas![1]).to.equal(fee12);
        expect(feeHistory.gasUsedRatio![0]).to.equal(0.25);
        expect(feeHistory.gasUsedRatio![1]).to.equal(0.5);
      });

      it('newestBlock == latest: baseFeePerGas[blockCount] is live getGasPriceInWeibars', async () => {
        const head = 10;
        const block = makeBlock(head, 0);
        const livePrice = NETWORK_FEE_WEIBARS * 2;
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);
        mirrorStub.getBlock.withArgs(head, requestDetails).resolves(block);
        commonStub.computeGasWeightedAvgFeePerGas.resolves(NETWORK_FEE_HEX);
        commonStub.getGasPriceInWeibars.withArgs(requestDetails).resolves(livePrice);

        const result = await feeService.feeHistory(1, 'latest', null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.baseFeePerGas![1]).to.equal(numberTo0x(livePrice));
        sinon.assert.calledOnceWithExactly(commonStub.getGasPriceInWeibars, requestDetails);
      });

      it('newestBlock is historical: baseFeePerGas[blockCount] is the fee of block newestBlock+1', async () => {
        const head = 20;
        const newest = 18;
        const block18 = makeBlock(newest, 0);
        const block19 = makeBlock(newest + 1, 0);
        const nextFeeHex = numberTo0x(NETWORK_FEE_WEIBARS * 2);
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);
        commonStub.translateBlockTag.withArgs(numberTo0x(newest), requestDetails).resolves(newest);
        mirrorStub.getBlock.withArgs(newest, requestDetails).resolves(block18);
        mirrorStub.getBlock.withArgs(newest + 1, requestDetails).resolves(block19);
        commonStub.computeGasWeightedAvgFeePerGas.withArgs([], block18, requestDetails).resolves(NETWORK_FEE_HEX);
        commonStub.computeGasWeightedAvgFeePerGas.withArgs([], block19, requestDetails).resolves(nextFeeHex);

        const result = await feeService.feeHistory(1, numberTo0x(newest), null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.baseFeePerGas![0]).to.equal(NETWORK_FEE_HEX);
        expect(feeHistory.baseFeePerGas![1]).to.equal(nextFeeHex);
        sinon.assert.notCalled(commonStub.getGasPriceInWeibars);
      });

      it('next block unavailable (null): baseFeePerGas[blockCount] = ZERO_HEX', async () => {
        const head = 20;
        const newest = 18;
        const block18 = makeBlock(newest, 0);
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);
        commonStub.translateBlockTag.withArgs(numberTo0x(newest), requestDetails).resolves(newest);
        mirrorStub.getBlock.withArgs(newest, requestDetails).resolves(block18);
        mirrorStub.getBlock.withArgs(newest + 1, requestDetails).resolves(null);
        commonStub.computeGasWeightedAvgFeePerGas.withArgs([], block18, requestDetails).resolves(NETWORK_FEE_HEX);

        const result = await feeService.feeHistory(1, numberTo0x(newest), null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.baseFeePerGas![1]).to.equal(constants.ZERO_HEX);
        sinon.assert.notCalled(commonStub.getGasPriceInWeibars);
      });

      it('baseFeePerGas has exactly blockCount+1 entries with no undefined slots', async () => {
        const head = 10;
        const block = makeBlock(head, 0);
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);
        mirrorStub.getBlock.withArgs(head, requestDetails).resolves(block);
        commonStub.computeGasWeightedAvgFeePerGas.resolves(NETWORK_FEE_HEX);
        commonStub.getGasPriceInWeibars.resolves(NETWORK_FEE_WEIBARS);

        const result = await feeService.feeHistory(1, 'latest', null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.baseFeePerGas).to.have.length(2);
        feeHistory.baseFeePerGas!.forEach((v) => expect(v).to.be.a('string'));
      });

      it('reward percentiles in non-fixed mode: reward array has correct shape', async () => {
        const head = 10;
        const block = makeBlock(head, 0);
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);
        mirrorStub.getBlock.withArgs(head, requestDetails).resolves(block);
        commonStub.computeGasWeightedAvgFeePerGas.resolves(NETWORK_FEE_HEX);
        commonStub.getGasPriceInWeibars.resolves(NETWORK_FEE_WEIBARS);

        const result = await feeService.feeHistory(1, 'latest', [25, 50, 75], requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.reward).to.have.length(1);
        expect(feeHistory.reward![0]).to.deep.equal([constants.ZERO_HEX, constants.ZERO_HEX, constants.ZERO_HEX]);
      });
    });
  });

  describe('feeHistory: input validation and edge cases', function () {
    let feeService: FeeService;
    let mirrorStub: { getBlock: sinon.SinonStub; getContractResults: sinon.SinonStub };
    let commonStub: {
      translateBlockTag: sinon.SinonStub;
      getGasPriceInWeibars: sinon.SinonStub;
      computeGasWeightedAvgFeePerGas: sinon.SinonStub;
    };
    let errorSpy: sinon.SinonSpy;

    withOverriddenEnvsInMochaTest({ TEST: true, ETH_FEE_HISTORY_FIXED: false }, () => {
      beforeEach(function () {
        errorSpy = sinon.spy();
        mirrorStub = { getBlock: sinon.stub(), getContractResults: sinon.stub() };
        commonStub = {
          translateBlockTag: sinon.stub(),
          getGasPriceInWeibars: sinon.stub(),
          computeGasWeightedAvgFeePerGas: sinon.stub(),
        };
        const logger = { error: errorSpy, warn: sinon.stub() } as unknown as Logger;
        feeService = new FeeService(mirrorStub as any, commonStub as any, logger);
      });

      afterEach(function () {
        sinon.restore();
      });

      it('rewardPercentiles.length > max: throws INVALID_PARAMETER', async () => {
        const tooMany = Array(constants.FEE_HISTORY_REWARD_PERCENTILES_MAX_SIZE + 1).fill(1);
        try {
          await feeService.feeHistory(1, 'latest', tooMany, requestDetails);
          expect.fail('expected to throw');
        } catch (e: any) {
          expect(e).to.have.property('code');
        }
      });

      it('newestBlock=pending: uses latestBlockNumber, does not call translateBlockTag with pending', async () => {
        const head = 5;
        const block = makeBlock(head, 0);
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);
        mirrorStub.getBlock.resolves(block);
        mirrorStub.getContractResults.resolves([]);
        commonStub.computeGasWeightedAvgFeePerGas.resolves(numberTo0x(77));
        commonStub.getGasPriceInWeibars.resolves(77);

        await feeService.feeHistory(1, constants.BLOCK_PENDING, null, requestDetails);

        sinon.assert.calledOnceWithExactly(commonStub.translateBlockTag, constants.BLOCK_LATEST, requestDetails);
      });

      it('newestBlockNumber > latestBlockNumber: returns REQUEST_BEYOND_HEAD_BLOCK error', async () => {
        const head = 5;
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);
        commonStub.translateBlockTag.withArgs(numberTo0x(10), requestDetails).resolves(10);

        const result = await feeService.feeHistory(1, numberTo0x(10), null, requestDetails);

        expect(result).to.have.property('code');
      });

      it('blockCount > maxResults: clamped to 10 (DEFAULT_FEE_HISTORY_MAX_RESULTS with TEST=true)', async () => {
        const head = 20;
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);
        mirrorStub.getBlock.callsFake((n: number) => Promise.resolve(makeBlock(n, 0)));
        mirrorStub.getContractResults.resolves([]);
        commonStub.computeGasWeightedAvgFeePerGas.resolves(numberTo0x(77));
        commonStub.getGasPriceInWeibars.resolves(77);

        const result = await feeService.feeHistory(15, 'latest', null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.gasUsedRatio).to.have.length(10);
        expect(feeHistory.baseFeePerGas).to.have.length(11);
      });

      it('blockCount=0: returns zero-block response (gasUsedRatio=null, baseFeePerGas=undefined)', async () => {
        const head = 10;
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);

        const result = await feeService.feeHistory(0, 'latest', null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.gasUsedRatio).to.be.null;
        expect(feeHistory.baseFeePerGas).to.be.undefined;
        expect(feeHistory.oldestBlock).to.equal(constants.ZERO_HEX);
      });

      it('translateBlockTag throws: returns empty fee history and calls logger.error', async () => {
        commonStub.translateBlockTag
          .withArgs(constants.BLOCK_LATEST, requestDetails)
          .rejects(new Error('network error'));

        const result = await feeService.feeHistory(1, 'latest', null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.baseFeePerGas).to.deep.equal([]);
        expect(feeHistory.gasUsedRatio).to.deep.equal([]);
        expect(feeHistory.reward).to.deep.equal([]);
        expect(feeHistory.oldestBlock).to.equal(constants.ZERO_HEX);
        sinon.assert.calledOnce(errorSpy);
      });
    });
  });

  describe('feeHistory (ETH_FEE_HISTORY_FIXED=true)', function () {
    let feeService: FeeService;
    let commonStub: {
      translateBlockTag: sinon.SinonStub;
      gasPrice: sinon.SinonStub;
    };

    const FIXED_FEE_HEX = numberTo0x(100);

    withOverriddenEnvsInMochaTest({ TEST: true, ETH_FEE_HISTORY_FIXED: true }, () => {
      beforeEach(function () {
        commonStub = {
          translateBlockTag: sinon.stub(),
          gasPrice: sinon.stub(),
        };
        const logger = { error: sinon.stub(), warn: sinon.stub() } as unknown as Logger;
        feeService = new FeeService({} as any, commonStub as any, logger);
        commonStub.gasPrice.withArgs(requestDetails).resolves(FIXED_FEE_HEX);
      });

      afterEach(function () {
        sinon.restore();
      });

      it('returns repeated fee with DEFAULT_GAS_USED_RATIO and blockCount+1 baseFeePerGas entries', async () => {
        const head = 10;
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);

        const result = await feeService.feeHistory(3, 'latest', null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.baseFeePerGas).to.have.length(4);
        feeHistory.baseFeePerGas!.forEach((v) => expect(v).to.equal(FIXED_FEE_HEX));
        expect(feeHistory.gasUsedRatio).to.deep.equal([
          constants.DEFAULT_GAS_USED_RATIO,
          constants.DEFAULT_GAS_USED_RATIO,
          constants.DEFAULT_GAS_USED_RATIO,
        ]);
        expect(feeHistory.oldestBlock).to.equal(numberTo0x(8));
        expect(feeHistory.reward).to.be.undefined;
      });

      it('oldestBlock <= 0: clamps blockCount to 1 and oldestBlock to 1', async () => {
        const head = 3;
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);

        const result = await feeService.feeHistory(5, 'latest', null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.baseFeePerGas).to.have.length(2);
        expect(feeHistory.gasUsedRatio).to.have.length(1);
        expect(feeHistory.oldestBlock).to.equal(numberTo0x(1));
      });

      it('with reward percentiles: reward array has [blockCount][percentiles.length] shape', async () => {
        const head = 10;
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);

        const result = await feeService.feeHistory(2, 'latest', [25, 75], requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.reward).to.have.length(2);
        expect(feeHistory.reward![0]).to.deep.equal([constants.ZERO_HEX, constants.ZERO_HEX]);
        expect(feeHistory.reward![1]).to.deep.equal([constants.ZERO_HEX, constants.ZERO_HEX]);
      });
    });
  });

  describe('maxPriorityFeePerGas', function () {
    it('returns ZERO_HEX', async () => {
      const feeService = new FeeService({} as any, {} as any, { error: sinon.stub(), warn: sinon.stub() } as any);
      expect(await feeService.maxPriorityFeePerGas()).to.equal(constants.ZERO_HEX);
    });
  });
});
