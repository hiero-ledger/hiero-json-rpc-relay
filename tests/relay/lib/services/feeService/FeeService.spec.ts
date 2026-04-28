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
    let mirrorStub: { getBlock: sinon.SinonStub; getLatestContractResultForBlock: sinon.SinonStub };
    let commonStub: {
      translateBlockTag: sinon.SinonStub;
      getGasPriceInWeibars: sinon.SinonStub;
    };

    withOverriddenEnvsInMochaTest({ TEST: true, ETH_FEE_HISTORY_FIXED: false }, () => {
      beforeEach(function () {
        mirrorStub = { getBlock: sinon.stub(), getLatestContractResultForBlock: sinon.stub() };
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
        // block 100 is non-empty but last tx has type-2 gas_price -> falls back to network fee
        mirrorStub.getLatestContractResultForBlock.withArgs(block, requestDetails).resolves(null);
        commonStub.getGasPriceInWeibars.withArgs(requestDetails, `lte:${block.timestamp.to}`).resolves(77);
        // N+1 live price (no timestamp) – used when newestBlock == latest
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

  describe('getFeeHistoryDataFromBlock (private)', function () {
    let feeService: FeeService;
    let mirrorStub: {
      getBlock: sinon.SinonStub;
      getLatestContractResultForBlock: sinon.SinonStub;
    };
    let commonStub: { getGasPriceInWeibars: sinon.SinonStub };

    const NETWORK_FEE_WEIBARS = 57 * constants.TINYBAR_TO_WEIBAR_COEF;
    const NETWORK_FEE_HEX = numberTo0x(NETWORK_FEE_WEIBARS);

    const makeContractResult = (overrides: Partial<MirrorNodeContractResult> = {}): MirrorNodeContractResult =>
      ({
        gas_price: NETWORK_FEE_HEX,
        gas_used: 100_000,
        type: 1,
        max_fee_per_gas: '0x0',
        max_priority_fee_per_gas: '0x0',
        ...overrides,
      }) as MirrorNodeContractResult;

    function callPrivate(blockNumber: number) {
      return (feeService as any).getFeeHistoryDataFromBlock(blockNumber, requestDetails);
    }

    withOverriddenEnvsInMochaTest({ TEST: true, ETH_FEE_HISTORY_FIXED: false }, () => {
      beforeEach(function () {
        mirrorStub = {
          getBlock: sinon.stub(),
          getLatestContractResultForBlock: sinon.stub(),
        };
        commonStub = { getGasPriceInWeibars: sinon.stub() };
        const logger = { error: sinon.stub(), warn: sinon.stub() } as unknown as Logger;
        feeService = new FeeService(mirrorStub as any, commonStub as any, logger);
      });

      afterEach(function () {
        sinon.restore();
      });

      it('non-empty block with type-1 tx: returns gas_price of last transaction', async function () {
        const block = minimalMirrorBlock(10, 100_000);
        mirrorStub.getBlock.withArgs(10, requestDetails).resolves(block);
        mirrorStub.getLatestContractResultForBlock
          .withArgs(block, requestDetails)
          .resolves(makeContractResult({ gas_price: NETWORK_FEE_HEX }));

        const { fee } = await callPrivate(10);

        expect(fee).to.equal(NETWORK_FEE_HEX);
        sinon.assert.notCalled(commonStub.getGasPriceInWeibars);
      });

      it('non-empty block with type-2 tx (gas_price="0x"): falls back to network fee', async function () {
        const block = minimalMirrorBlock(10, 100_000);
        mirrorStub.getBlock.withArgs(10, requestDetails).resolves(block);
        mirrorStub.getLatestContractResultForBlock
          .withArgs(block, requestDetails)
          .resolves(makeContractResult({ gas_price: constants.EMPTY_HEX, type: 2 }));
        commonStub.getGasPriceInWeibars
          .withArgs(requestDetails, `lte:${block.timestamp.to}`)
          .resolves(NETWORK_FEE_WEIBARS);

        const { fee } = await callPrivate(10);

        expect(fee).to.equal(NETWORK_FEE_HEX);
        sinon.assert.calledOnce(commonStub.getGasPriceInWeibars);
      });

      it('empty block (gas_used=0): skips contract result lookup, uses network fee at timestamp', async function () {
        const block = minimalMirrorBlock(10, 0);
        mirrorStub.getBlock.withArgs(10, requestDetails).resolves(block);
        commonStub.getGasPriceInWeibars
          .withArgs(requestDetails, `lte:${block.timestamp.to}`)
          .resolves(NETWORK_FEE_WEIBARS);

        const { fee } = await callPrivate(10);

        expect(fee).to.equal(NETWORK_FEE_HEX);
        sinon.assert.notCalled(mirrorStub.getLatestContractResultForBlock);
      });

      it('empty block (gas_used=0): gasUsedRatio is 0', async function () {
        const block = minimalMirrorBlock(10, 0);
        mirrorStub.getBlock.withArgs(10, requestDetails).resolves(block);
        commonStub.getGasPriceInWeibars.resolves(NETWORK_FEE_WEIBARS);

        const { gasUsedRatio } = await callPrivate(10);

        expect(gasUsedRatio).to.equal(0);
      });

      it('non-empty block, getLatestContractResultForBlock returns null: falls back to network fee', async function () {
        const block = minimalMirrorBlock(10, 100_000);
        mirrorStub.getBlock.withArgs(10, requestDetails).resolves(block);
        mirrorStub.getLatestContractResultForBlock.withArgs(block, requestDetails).resolves(null);
        commonStub.getGasPriceInWeibars
          .withArgs(requestDetails, `lte:${block.timestamp.to}`)
          .resolves(NETWORK_FEE_WEIBARS);

        const { fee } = await callPrivate(10);

        expect(fee).to.equal(NETWORK_FEE_HEX);
      });

      it('getLatestContractResultForBlock throws: falls back to network fee for that block', async function () {
        const block = minimalMirrorBlock(10, 100_000);
        mirrorStub.getBlock.withArgs(10, requestDetails).resolves(block);
        mirrorStub.getLatestContractResultForBlock.rejects(new Error('mirror node down'));
        commonStub.getGasPriceInWeibars
          .withArgs(requestDetails, `lte:${block.timestamp.to}`)
          .resolves(NETWORK_FEE_WEIBARS);

        const { fee } = await callPrivate(10);

        expect(fee).to.equal(NETWORK_FEE_HEX);
      });

      it('block not found (getBlock returns null): returns ZERO_HEX fee and 0 gasUsedRatio', async function () {
        mirrorStub.getBlock.withArgs(10, requestDetails).resolves(null);

        const { fee, gasUsedRatio } = await callPrivate(10);

        expect(fee).to.equal(constants.ZERO_HEX);
        expect(gasUsedRatio).to.equal(0);
      });

      it('getBlock throws: returns ZERO_HEX fee and 0 gasUsedRatio', async function () {
        mirrorStub.getBlock.withArgs(10, requestDetails).rejects(new Error('network error'));

        const { fee, gasUsedRatio } = await callPrivate(10);

        expect(fee).to.equal(constants.ZERO_HEX);
        expect(gasUsedRatio).to.equal(0);
      });
    });
  });

  describe('getFeeHistory (private) – nextBaseFeePerGas selection', function () {
    let feeService: FeeService;
    let mirrorStub: {
      getBlock: sinon.SinonStub;
      getLatestContractResultForBlock: sinon.SinonStub;
    };
    let commonStub: {
      translateBlockTag: sinon.SinonStub;
      getGasPriceInWeibars: sinon.SinonStub;
    };

    const NETWORK_FEE_WEIBARS = 57 * constants.TINYBAR_TO_WEIBAR_COEF;
    const NETWORK_FEE_HEX = numberTo0x(NETWORK_FEE_WEIBARS);

    withOverriddenEnvsInMochaTest({ TEST: true, ETH_FEE_HISTORY_FIXED: false }, () => {
      beforeEach(function () {
        mirrorStub = {
          getBlock: sinon.stub(),
          getLatestContractResultForBlock: sinon.stub(),
        };
        commonStub = {
          translateBlockTag: sinon.stub(),
          getGasPriceInWeibars: sinon.stub(),
        };
        const logger = { error: sinon.stub(), warn: sinon.stub() } as unknown as Logger;
        feeService = new FeeService(mirrorStub as any, commonStub as any, logger);
      });

      afterEach(function () {
        sinon.restore();
      });

      it('when newestBlock is latest: nextFee calls getGasPriceInWeibars WITHOUT timestamp', async function () {
        const head = 10;
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);

        const block = minimalMirrorBlock(head, 100_000);
        mirrorStub.getBlock.withArgs(head, requestDetails).resolves(block);
        // last tx in block
        mirrorStub.getLatestContractResultForBlock.resolves({ gas_price: NETWORK_FEE_HEX, type: 1, gas_used: 100_000 });
        // current (no-timestamp) fee call for the N+1 entry
        commonStub.getGasPriceInWeibars.withArgs(requestDetails).resolves(NETWORK_FEE_WEIBARS);

        const result = await feeService.feeHistory(1, 'latest', null, requestDetails);

        const feeHistory = result as IFeeHistory;
        // baseFeePerGas[0] from tx gas_price, [1] from current fee
        expect(feeHistory.baseFeePerGas).to.have.length(2);
        expect(feeHistory.baseFeePerGas![0]).to.equal(NETWORK_FEE_HEX);
        expect(feeHistory.baseFeePerGas![1]).to.equal(NETWORK_FEE_HEX);
        // getGasPriceInWeibars called exactly once with no timestamp (for the N+1 next entry)
        sinon.assert.calledOnceWithMatch(commonStub.getGasPriceInWeibars, requestDetails);
        sinon.assert.neverCalledWithMatch(commonStub.getGasPriceInWeibars, requestDetails, sinon.match.string);
      });

      it('when newestBlock is historical: nextFee is fetched from the actual next block', async function () {
        const head = 20;
        const newest = 18;
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);
        commonStub.translateBlockTag.withArgs(numberTo0x(newest), requestDetails).resolves(newest);

        // blocks 18 (range) and 19 (next after newest)
        const block18 = minimalMirrorBlock(18, 100_000);
        const block19 = minimalMirrorBlock(19, 100_000);
        mirrorStub.getBlock.withArgs(18, requestDetails).resolves(block18);
        mirrorStub.getBlock.withArgs(19, requestDetails).resolves(block19);
        mirrorStub.getLatestContractResultForBlock.resolves({ gas_price: NETWORK_FEE_HEX, type: 1, gas_used: 100_000 });

        const result = await feeService.feeHistory(1, numberTo0x(newest), null, requestDetails);

        const feeHistory = result as IFeeHistory;
        // [0] = block18, [1] = next (block19 via getFeeHistoryDataFromBlock)
        expect(feeHistory.baseFeePerGas).to.have.length(2);
        // both blocks return the same tx gas_price
        expect(feeHistory.baseFeePerGas![0]).to.equal(NETWORK_FEE_HEX);
        expect(feeHistory.baseFeePerGas![1]).to.equal(NETWORK_FEE_HEX);
      });

      it('baseFeePerGas array has no pre-allocated undefined slots', async function () {
        const head = 10;
        commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);
        const block = minimalMirrorBlock(head, 100_000);
        mirrorStub.getBlock.withArgs(head, requestDetails).resolves(block);
        mirrorStub.getLatestContractResultForBlock.resolves({ gas_price: NETWORK_FEE_HEX, type: 1, gas_used: 100_000 });
        commonStub.getGasPriceInWeibars.resolves(NETWORK_FEE_WEIBARS);

        const result = await feeService.feeHistory(1, 'latest', null, requestDetails);
        const feeHistory = result as IFeeHistory;

        // Must be exactly [blockFee, nextFee]
        expect(feeHistory.baseFeePerGas).to.have.length(2);
        feeHistory.baseFeePerGas!.forEach((v) => {
          expect(v).to.be.a('string');
        });
      });
    });
  });
});
