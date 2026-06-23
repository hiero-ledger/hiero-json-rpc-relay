// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { type Logger } from 'pino';
import sinon from 'sinon';

import { numberTo0x } from '../../../../../src/relay/formatters';
import * as blockGasLimit from '../../../../../src/relay/lib/config/blockGasLimit';
import constants from '../../../../../src/relay/lib/constants';
import { FeeService } from '../../../../../src/relay/lib/services/ethService/feeService/FeeService';
import { type IFeeHistory, type MirrorNodeBlock, RequestDetails } from '../../../../../src/relay/lib/types';
import { withOverriddenEnvsInMochaTest } from '../../../helpers';

describe('FeeService', function () {
  const requestDetails = new RequestDetails({ requestId: 'feeServiceUnitTest', ipAddress: '0.0.0.0' });

  function minimalMirrorBlock(number: number, gasUsed: number, hapiVersion: string = '0.0.0'): MirrorNodeBlock {
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
      timestamp: { from: '1651560386.0', to: '1651560389.0' },
    };
  }

  describe('feeHistory (batched block fetch)', function () {
    const head = 100;
    const gasPrice = 77;

    let feeService: FeeService;
    let mirrorStub: { getBlocksByRange: sinon.SinonStub; getBlock: sinon.SinonStub };
    let commonStub: {
      translateBlockTag: sinon.SinonStub;
      getGasPriceInWeibars: sinon.SinonStub;
    };

    withOverriddenEnvsInMochaTest({ TEST: true, ETH_FEE_HISTORY_FIXED: false }, () => {
      beforeEach(function () {
        mirrorStub = { getBlocksByRange: sinon.stub(), getBlock: sinon.stub() };
        commonStub = {
          translateBlockTag: sinon.stub(),
          getGasPriceInWeibars: sinon.stub().resolves(gasPrice),
        };

        const logger = { error: sinon.stub(), warn: sinon.stub() } as unknown as Logger;
        feeService = new FeeService(mirrorStub as any, commonStub as any, logger);

        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);
      });

      afterEach(function () {
        sinon.restore();
      });

      it('fetches the whole range with a single getBlocksByRange call and never calls getBlock when newest is latest', async function () {
        mirrorStub.getBlocksByRange
          .withArgs(requestDetails, head, head)
          .resolves([minimalMirrorBlock(head, 1_000_000, '0.0.0')]);

        const result = await feeService.feeHistory(1, 'latest', null, requestDetails);

        expect(result).to.not.have.property('code');
        const feeHistory = result as IFeeHistory;
        const expectedLimit = blockGasLimit.obtainBlockGasLimit('0.0.0');
        expect(feeHistory.oldestBlock).to.equal(numberTo0x(head));
        expect(feeHistory.gasUsedRatio).to.deep.equal([1_000_000 / expectedLimit]);
        expect(feeHistory.baseFeePerGas).to.deep.equal([numberTo0x(gasPrice), numberTo0x(gasPrice)]);
        expect(mirrorStub.getBlocksByRange.calledOnceWithExactly(requestDetails, head, head)).to.be.true;
        expect(mirrorStub.getBlock.called).to.be.false;
      });

      it('batches multiple blocks and fetches only the next block via getBlock when newest < latest', async function () {
        const blockCount = 3;
        const newest = 99;
        const oldest = newest - blockCount + 1; // 97
        commonStub.translateBlockTag.withArgs(numberTo0x(newest), requestDetails).resolves(newest);

        const rangeBlocks = [oldest, oldest + 1, newest].map((n) => minimalMirrorBlock(n, 1_000_000, '0.0.0'));
        mirrorStub.getBlocksByRange.withArgs(requestDetails, oldest, newest).resolves(rangeBlocks);
        mirrorStub.getBlock.withArgs(head, requestDetails).resolves(minimalMirrorBlock(head, 1_000_000, '0.0.0'));

        const result = await feeService.feeHistory(blockCount, numberTo0x(newest), null, requestDetails);

        const feeHistory = result as IFeeHistory;
        expect(feeHistory.oldestBlock).to.equal(numberTo0x(oldest));
        expect(feeHistory.gasUsedRatio).to.have.lengthOf(blockCount);
        expect(feeHistory.baseFeePerGas).to.have.lengthOf(blockCount + 1);
        expect(mirrorStub.getBlocksByRange.calledOnceWithExactly(requestDetails, oldest, newest)).to.be.true;
        expect(mirrorStub.getBlock.calledOnceWithExactly(head, requestDetails)).to.be.true;
      });

      it('returns zero fee and zero gasUsedRatio for a block missing from the batch response', async function () {
        const blockCount = 2;
        const newest = head;
        const oldest = newest - blockCount + 1; // 99
        // range response omits the oldest block, so only the newest is indexed
        mirrorStub.getBlocksByRange
          .withArgs(requestDetails, oldest, newest)
          .resolves([minimalMirrorBlock(newest, 1_000_000, '0.0.0')]);
        // the omitted block is resolved on demand and reported missing by the mirror node
        mirrorStub.getBlock.withArgs(oldest, requestDetails).resolves(undefined);

        const result = await feeService.feeHistory(blockCount, 'latest', null, requestDetails);

        const feeHistory = result as IFeeHistory;
        expect(feeHistory.baseFeePerGas?.[0]).to.equal(constants.ZERO_HEX);
        expect(feeHistory.gasUsedRatio?.[0]).to.equal(0);
      });

      it('falls back to per-block getBlock when the batch range fetch fails', async function () {
        mirrorStub.getBlocksByRange.rejects(new Error('mirror unavailable'));
        mirrorStub.getBlock.withArgs(head, requestDetails).resolves(minimalMirrorBlock(head, 1_000_000, '0.0.0'));

        const result = await feeService.feeHistory(1, 'latest', null, requestDetails);

        const feeHistory = result as IFeeHistory;
        const expectedLimit = blockGasLimit.obtainBlockGasLimit('0.0.0');
        expect(feeHistory.oldestBlock).to.equal(numberTo0x(head));
        expect(feeHistory.gasUsedRatio).to.deep.equal([1_000_000 / expectedLimit]);
        expect(mirrorStub.getBlock.calledWith(head, requestDetails)).to.be.true;
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
      const blockNumber = 5;
      const blockGasLimitValue = blockGasLimit.obtainBlockGasLimit('0.0.0');
      const gasUsed = blockGasLimitValue + 1;
      expect(ratioFor(minimalMirrorBlock(blockNumber, gasUsed, '0.0.0'))).to.equal(1);
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
});
