// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { Logger } from 'pino';
import sinon from 'sinon';

import { numberTo0x } from '../../../../../src/relay/formatters';
import * as blockGasLimit from '../../../../../src/relay/lib/config/blockGasLimit';
import constants from '../../../../../src/relay/lib/constants';
import { FeeService } from '../../../../../src/relay/lib/services/ethService/feeService/FeeService';
import { IFeeHistory, MirrorNodeBlock, RequestDetails } from '../../../../../src/relay/lib/types';
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

  describe('feeHistory (happy path)', function () {
    let feeService: FeeService;
    let mirrorStub: { getBlock: sinon.SinonStub };
    let commonStub: {
      translateBlockTag: sinon.SinonStub;
      getGasPriceInWeibars: sinon.SinonStub;
    };

    withOverriddenEnvsInMochaTest({ TEST: true, ETH_FEE_HISTORY_FIXED: false }, () => {
      beforeEach(function () {
        mirrorStub = { getBlock: sinon.stub() };
        commonStub = {
          translateBlockTag: sinon.stub(),
          getGasPriceInWeibars: sinon.stub(),
        };

        const logger = { error: sinon.stub(), warn: sinon.stub() } as unknown as Logger;
        feeService = new FeeService(mirrorStub as any, commonStub as any, logger);

        const head = 100;
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);

        const block = minimalMirrorBlock(head, 1_000_000, '0.0.0');
        mirrorStub.getBlock.withArgs(head, requestDetails).resolves(block);
        commonStub.getGasPriceInWeibars.withArgs(requestDetails, `lte:${block.timestamp.to}`).resolves(77);
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
