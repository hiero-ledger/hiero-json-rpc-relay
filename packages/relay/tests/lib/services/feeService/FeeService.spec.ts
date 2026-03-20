// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { expect } from 'chai';
import { Logger } from 'pino';
import sinon from 'sinon';

import { numberTo0x } from '../../../../src/formatters';
import constants from '../../../../src/lib/constants';
import { FeeService } from '../../../../src/lib/services/ethService/feeService/FeeService';
import { RequestDetails } from '../../../../src/lib/types';
import { IFeeHistory } from '../../../../src/lib/types/IFeeHistory';
import { MirrorNodeBlock } from '../../../../src/lib/types/mirrorNode';

describe('FeeService', function () {
  const requestDetails = new RequestDetails({ requestId: 'feeServiceUnitTest', ipAddress: '0.0.0.0' });
  const originalBlockGasLimit = constants.BLOCK_GAS_LIMIT;

  function minimalMirrorBlock(number: number, gasUsed: number): MirrorNodeBlock {
    return {
      count: 0,
      gas_used: gasUsed,
      hapi_version: '0.0.0',
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

    beforeEach(function () {
      sinon.stub(ConfigService, 'get').callsFake((key: string) => {
        if (key === 'TEST') return true;
        if (key === 'ETH_FEE_HISTORY_FIXED') return false;
        return undefined;
      });

      mirrorStub = { getBlock: sinon.stub() };
      commonStub = {
        translateBlockTag: sinon.stub(),
        getGasPriceInWeibars: sinon.stub(),
      };

      const logger = { error: sinon.stub(), warn: sinon.stub() } as unknown as Logger;
      feeService = new FeeService(mirrorStub as any, commonStub as any, logger);

      const head = 100;
      commonStub.translateBlockTag.withArgs(constants.BLOCK_LATEST, requestDetails).resolves(head);

      const block = minimalMirrorBlock(head, 1_000_000);
      mirrorStub.getBlock.withArgs(head, requestDetails).resolves(block);
      commonStub.getGasPriceInWeibars.withArgs(requestDetails, `lte:${block.timestamp.to}`).resolves(77);
    });

    afterEach(function () {
      sinon.restore();
    });

    it('returns fee history with computed gasUsedRatio when newest block is latest', async function () {
      const result = await feeService.feeHistory(1, 'latest', null, requestDetails);

      expect(result).to.not.have.property('code');
      const feeHistory = result as IFeeHistory;
      expect(feeHistory.oldestBlock).to.equal(numberTo0x(100));
      expect(feeHistory.gasUsedRatio).to.deep.equal([1_000_000 / constants.BLOCK_GAS_LIMIT]);
      expect(feeHistory.baseFeePerGas).to.deep.equal([numberTo0x(77), numberTo0x(77)]);
      expect(mirrorStub.getBlock.callCount).to.equal(1);
      expect(mirrorStub.getBlock.firstCall.args).to.deep.equal([100, requestDetails]);
    });
  });

  describe('gasUsedRatioForBlock (private)', function () {
    let warnSpy: sinon.SinonSpy;
    let feeService: FeeService;

    function ratioFor(block: Pick<MirrorNodeBlock, 'number' | 'gas_used'>): number {
      return (feeService as any).gasUsedRatioForBlock(block);
    }

    beforeEach(function () {
      (constants as { BLOCK_GAS_LIMIT: number }).BLOCK_GAS_LIMIT = originalBlockGasLimit;
      warnSpy = sinon.spy();
      feeService = new FeeService({} as any, {} as any, { warn: warnSpy } as unknown as Logger);
    });

    afterEach(function () {
      (constants as { BLOCK_GAS_LIMIT: number }).BLOCK_GAS_LIMIT = originalBlockGasLimit;
    });

    it('returns gasUsed / blockGasLimit when within limit', function () {
      (constants as { BLOCK_GAS_LIMIT: number }).BLOCK_GAS_LIMIT = 10_000_000;
      expect(ratioFor({ number: 1, gas_used: 2_500_000 })).to.equal(0.25);
      expect(warnSpy.called).to.be.false;
    });

    it('returns 0 when gasUsed is 0', function () {
      (constants as { BLOCK_GAS_LIMIT: number }).BLOCK_GAS_LIMIT = 10_000_000;
      expect(ratioFor({ number: 2, gas_used: 0 })).to.equal(0);
      expect(warnSpy.called).to.be.false;
    });

    it('treats missing gas_used as 0', function () {
      (constants as { BLOCK_GAS_LIMIT: number }).BLOCK_GAS_LIMIT = 10_000_000;
      expect(ratioFor({ number: 3, gas_used: undefined as unknown as number })).to.equal(0);
      expect(warnSpy.called).to.be.false;
    });

    it('returns 1 when gasUsed equals blockGasLimit', function () {
      (constants as { BLOCK_GAS_LIMIT: number }).BLOCK_GAS_LIMIT = 5_000_000;
      expect(ratioFor({ number: 4, gas_used: 5_000_000 })).to.equal(1);
      expect(warnSpy.called).to.be.false;
    });

    it('returns 1 and warns when gasUsed exceeds blockGasLimit', function () {
      (constants as { BLOCK_GAS_LIMIT: number }).BLOCK_GAS_LIMIT = 100;
      expect(ratioFor({ number: 5, gas_used: 101 })).to.equal(1);
      expect(warnSpy.calledOnce).to.be.true;
      expect(warnSpy.firstCall.args[1]).to.include('clamping gasUsedRatio to 1');
    });

    it('returns 0 and warns when blockGasLimit is 0', function () {
      (constants as { BLOCK_GAS_LIMIT: number }).BLOCK_GAS_LIMIT = 0;
      expect(ratioFor({ number: 6, gas_used: 50 })).to.equal(0);
      expect(warnSpy.calledOnce).to.be.true;
      expect(warnSpy.firstCall.args[1]).to.include('non-positive');
    });

    it('returns 0 and warns when blockGasLimit is negative', function () {
      (constants as { BLOCK_GAS_LIMIT: number }).BLOCK_GAS_LIMIT = -1;
      expect(ratioFor({ number: 7, gas_used: 1 })).to.equal(0);
      expect(warnSpy.calledOnce).to.be.true;
      expect(warnSpy.firstCall.args[1]).to.include('non-positive');
    });

    it('returns an irreducible fractional ratio', function () {
      (constants as { BLOCK_GAS_LIMIT: number }).BLOCK_GAS_LIMIT = 7;
      expect(ratioFor({ number: 1, gas_used: 3 })).to.be.closeTo(3 / 7, 1e-12);
    });
  });
});
