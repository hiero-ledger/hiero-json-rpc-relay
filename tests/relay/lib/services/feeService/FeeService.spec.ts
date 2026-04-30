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

      it('returns fee history with gasUsedRatio from obtainBlockGasLimit(hapi_version) when newest block is latest', async function () {
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

  describe('fetchBlockFeeAndBlockGasUsed (private)', function () {
    let feeService: FeeService;
    let mirrorStub: { getBlock: sinon.SinonStub; getContractResults: sinon.SinonStub };
    let commonStub: { computeGasWeightedAvgFeePerGas: sinon.SinonStub; getGasPriceInWeibars: sinon.SinonStub };
    let warnSpy: sinon.SinonSpy;

    const NETWORK_FEE_WEIBARS = 57 * constants.TINYBAR_TO_WEIBAR_COEF;
    const NETWORK_FEE_HEX = numberTo0x(NETWORK_FEE_WEIBARS);

    function callPrivate(blockNumber: number): Promise<{ fee: string; gasUsedRatio: number }> {
      return (feeService as any).fetchBlockFeeAndBlockGasUsed(blockNumber, requestDetails);
    }

    beforeEach(function () {
      warnSpy = sinon.spy();
      mirrorStub = { getBlock: sinon.stub(), getContractResults: sinon.stub() };
      commonStub = {
        computeGasWeightedAvgFeePerGas: sinon.stub(),
        getGasPriceInWeibars: sinon.stub(),
      };
      const logger = { error: sinon.stub(), warn: warnSpy } as unknown as Logger;
      feeService = new FeeService(mirrorStub as any, commonStub as any, logger);
    });

    afterEach(function () {
      sinon.restore();
    });

    it('getBlock throws: returns ZERO_HEX fee and 0 gasUsedRatio, logs warning', async function () {
      mirrorStub.getBlock.rejects(new Error('mirror node down'));

      const result = await callPrivate(10);

      expect(result.fee).to.equal(constants.ZERO_HEX);
      expect(result.gasUsedRatio).to.equal(0);
      sinon.assert.calledOnce(warnSpy);
      sinon.assert.notCalled(mirrorStub.getContractResults);
      sinon.assert.notCalled(commonStub.computeGasWeightedAvgFeePerGas);
    });

    it('getBlock returns null: returns ZERO_HEX fee and 0 gasUsedRatio', async function () {
      mirrorStub.getBlock.resolves(null);

      const result = await callPrivate(10);

      expect(result.fee).to.equal(constants.ZERO_HEX);
      expect(result.gasUsedRatio).to.equal(0);
      sinon.assert.notCalled(mirrorStub.getContractResults);
    });

    it('empty block (gas_used=0): skips getContractResults and feeds [] to computeGasWeightedAvgFeePerGas', async function () {
      const block = makeBlock(10, 0);
      mirrorStub.getBlock.resolves(block);
      commonStub.computeGasWeightedAvgFeePerGas.withArgs([], block, requestDetails).resolves(NETWORK_FEE_HEX);

      const result = await callPrivate(10);

      expect(result.fee).to.equal(NETWORK_FEE_HEX);
      sinon.assert.notCalled(mirrorStub.getContractResults);
      sinon.assert.calledWithExactly(commonStub.computeGasWeightedAvgFeePerGas, [], block, requestDetails);
    });

    it('non-empty block: fetches contractResults by timestamp range and passes to computeGasWeightedAvgFeePerGas', async function () {
      const block = makeBlock(10, 100_000);
      const crs = [{ gas_price: NETWORK_FEE_HEX, gas_used: 100_000, type: 1 }] as MirrorNodeContractResult[];
      mirrorStub.getBlock.resolves(block);
      mirrorStub.getContractResults
        .withArgs(requestDetails, { timestamp: [`gte:${block.timestamp.from}`, `lte:${block.timestamp.to}`] })
        .resolves(crs);
      commonStub.computeGasWeightedAvgFeePerGas.withArgs(crs, block, requestDetails).resolves(NETWORK_FEE_HEX);

      const result = await callPrivate(10);

      expect(result.fee).to.equal(NETWORK_FEE_HEX);
      sinon.assert.calledOnce(mirrorStub.getContractResults);
      sinon.assert.calledWithExactly(commonStub.computeGasWeightedAvgFeePerGas, crs, block, requestDetails);
    });

    it('getContractResults throws: feeds [] to computeGasWeightedAvgFeePerGas', async function () {
      const block = makeBlock(10, 100_000);
      mirrorStub.getBlock.resolves(block);
      mirrorStub.getContractResults.rejects(new Error('timeout'));
      commonStub.computeGasWeightedAvgFeePerGas.withArgs([], block, requestDetails).resolves(NETWORK_FEE_HEX);

      const result = await callPrivate(10);

      expect(result.fee).to.equal(NETWORK_FEE_HEX);
      sinon.assert.calledWithExactly(commonStub.computeGasWeightedAvgFeePerGas, [], block, requestDetails);
    });

    it('returns gasUsedRatio from getGasUsedRatioForBlock', async function () {
      const limit = blockGasLimit.obtainBlockGasLimit('0.0.0');
      const block = makeBlock(10, limit / 2);
      mirrorStub.getBlock.resolves(block);
      mirrorStub.getContractResults.resolves([]);
      commonStub.computeGasWeightedAvgFeePerGas.resolves(NETWORK_FEE_HEX);

      const result = await callPrivate(10);

      expect(result.gasUsedRatio).to.equal(0.5);
    });
  });

  describe('getFeeHistory (private)', function () {
    let feeService: FeeService;
    let fetchBlockFeeStub: sinon.SinonStub;
    let commonStub: { translateBlockTag: sinon.SinonStub; getGasPriceInWeibars: sinon.SinonStub };

    const NETWORK_FEE_WEIBARS = 57 * constants.TINYBAR_TO_WEIBAR_COEF;
    const NETWORK_FEE_HEX = numberTo0x(NETWORK_FEE_WEIBARS);

    withOverriddenEnvsInMochaTest({ TEST: true, ETH_FEE_HISTORY_FIXED: false }, () => {
      beforeEach(function () {
        commonStub = {
          translateBlockTag: sinon.stub(),
          getGasPriceInWeibars: sinon.stub(),
        };
        const logger = { error: sinon.stub(), warn: sinon.stub() } as unknown as Logger;
        feeService = new FeeService({} as any, commonStub as any, logger);
        fetchBlockFeeStub = sinon.stub(feeService as any, 'fetchBlockFeeAndBlockGasUsed');
      });

      afterEach(function () {
        sinon.restore();
      });

      it('single block: assembles baseFeePerGas and gasUsedRatio from fetchBlockFeeAndBlockGasUsed', async function () {
        const head = 10;
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);
        fetchBlockFeeStub.withArgs(head, requestDetails).resolves({ fee: NETWORK_FEE_HEX, gasUsedRatio: 0.5 });
        commonStub.getGasPriceInWeibars.resolves(NETWORK_FEE_WEIBARS);

        const result = await feeService.feeHistory(1, 'latest', null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.baseFeePerGas![0]).to.equal(NETWORK_FEE_HEX);
        expect(feeHistory.gasUsedRatio![0]).to.equal(0.5);
        sinon.assert.calledOnce(fetchBlockFeeStub);
      });

      it('multi-block range: fee and gasUsedRatio per block are correctly ordered', async function () {
        const head = 12;
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);
        const fee11 = numberTo0x(NETWORK_FEE_WEIBARS);
        const fee12 = numberTo0x(NETWORK_FEE_WEIBARS * 2);
        fetchBlockFeeStub.withArgs(11, requestDetails).resolves({ fee: fee11, gasUsedRatio: 0.3 });
        fetchBlockFeeStub.withArgs(12, requestDetails).resolves({ fee: fee12, gasUsedRatio: 0.7 });
        commonStub.getGasPriceInWeibars.resolves(NETWORK_FEE_WEIBARS);

        const result = await feeService.feeHistory(2, 'latest', null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.baseFeePerGas).to.have.length(3); // blockCount + 1
        expect(feeHistory.baseFeePerGas![0]).to.equal(fee11);
        expect(feeHistory.baseFeePerGas![1]).to.equal(fee12);
        expect(feeHistory.gasUsedRatio![0]).to.equal(0.3);
        expect(feeHistory.gasUsedRatio![1]).to.equal(0.7);
        sinon.assert.calledTwice(fetchBlockFeeStub);
      });

      it('newestBlock == latest: nextFee uses live getGasPriceInWeibars without timestamp', async function () {
        const head = 10;
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);
        fetchBlockFeeStub.withArgs(head, requestDetails).resolves({ fee: NETWORK_FEE_HEX, gasUsedRatio: 0.5 });
        const livePrice = NETWORK_FEE_WEIBARS * 2;
        commonStub.getGasPriceInWeibars.withArgs(requestDetails).resolves(livePrice);

        const result = await feeService.feeHistory(1, 'latest', null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.baseFeePerGas![1]).to.equal(numberTo0x(livePrice));
        sinon.assert.calledOnceWithExactly(commonStub.getGasPriceInWeibars, requestDetails);
      });

      it('newestBlock is historical: nextFee comes from fetchBlockFeeAndBlockGasUsed for the actual next block', async function () {
        const head = 20;
        const newest = 18;
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);
        commonStub.translateBlockTag.withArgs(numberTo0x(newest), requestDetails).resolves(newest);
        const nextFeeHex = numberTo0x(NETWORK_FEE_WEIBARS * 2);
        fetchBlockFeeStub.withArgs(newest, requestDetails).resolves({ fee: NETWORK_FEE_HEX, gasUsedRatio: 0.5 });
        fetchBlockFeeStub.withArgs(newest + 1, requestDetails).resolves({ fee: nextFeeHex, gasUsedRatio: 0.4 });

        const result = await feeService.feeHistory(1, numberTo0x(newest), null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.baseFeePerGas![0]).to.equal(NETWORK_FEE_HEX);
        expect(feeHistory.baseFeePerGas![1]).to.equal(nextFeeHex);
        sinon.assert.notCalled(commonStub.getGasPriceInWeibars);
      });

      it('next-block fetchBlockFeeAndBlockGasUsed throws: falls back to live getGasPriceInWeibars', async function () {
        const head = 20;
        const newest = 18;
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);
        commonStub.translateBlockTag.withArgs(numberTo0x(newest), requestDetails).resolves(newest);
        fetchBlockFeeStub.withArgs(newest, requestDetails).resolves({ fee: NETWORK_FEE_HEX, gasUsedRatio: 0.5 });
        fetchBlockFeeStub.withArgs(newest + 1, requestDetails).rejects(new Error('block not found'));
        commonStub.getGasPriceInWeibars.withArgs(requestDetails).resolves(NETWORK_FEE_WEIBARS);

        const result = await feeService.feeHistory(1, numberTo0x(newest), null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.baseFeePerGas![1]).to.equal(NETWORK_FEE_HEX);
        sinon.assert.calledOnceWithExactly(commonStub.getGasPriceInWeibars, requestDetails);
      });

      it('baseFeePerGas has exactly blockCount+1 entries with no undefined slots', async function () {
        const head = 10;
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);
        fetchBlockFeeStub.resolves({ fee: NETWORK_FEE_HEX, gasUsedRatio: 0.5 });
        commonStub.getGasPriceInWeibars.resolves(NETWORK_FEE_WEIBARS);

        const result = await feeService.feeHistory(1, 'latest', null, requestDetails);
        const feeHistory = result as IFeeHistory;

        expect(feeHistory.baseFeePerGas).to.have.length(2);
        feeHistory.baseFeePerGas!.forEach((v) => expect(v).to.be.a('string'));
      });
    });
  });
});
