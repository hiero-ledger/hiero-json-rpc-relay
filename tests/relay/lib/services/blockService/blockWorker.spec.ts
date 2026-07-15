// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import sinon from 'sinon';

import { numberTo0x } from '../../../../../src/relay/formatters';
import { computeBlockGasPrice } from '../../../../../src/relay/lib/services/ethService/blockService/blockWorker';
import { type CommonService } from '../../../../../src/relay/lib/services/ethService/ethCommonService/CommonService';
import { type IWorkerContext } from '../../../../../src/relay/lib/services/workersService/workerContext';
import { type MirrorNodeContractResult, RequestDetails } from '../../../../../src/relay/lib/types';

describe('computeBlockGasPrice', function () {
  const requestDetails = new RequestDetails({ requestId: 'blockWorkerTest', ipAddress: '0.0.0.0' });
  const blockTimestampTo = '1651560389.000000000';
  const fallbackWeibars = 1_140_000_000_000; // fee-schedule fallback rate, in weibars

  let getGasPriceStub: sinon.SinonStub;
  let ctx: IWorkerContext;

  beforeEach(function () {
    getGasPriceStub = sinon.stub().resolves(fallbackWeibars);
    ctx = { commonService: { getGasPriceInWeibars: getGasPriceStub } as unknown as CommonService } as IWorkerContext;
  });

  afterEach(function () {
    sinon.restore();
  });

  function makeResult(gas_price: string | null, gas_used: number): Partial<MirrorNodeContractResult> {
    return { gas_price, gas_used };
  }

  it('returns the fee-schedule price when contractResults is null (empty block)', async function () {
    const result = await computeBlockGasPrice(ctx, null, blockTimestampTo, requestDetails);

    expect(result).to.equal(numberTo0x(fallbackWeibars));
    expect(getGasPriceStub.calledOnceWith(requestDetails, `lte:${blockTimestampTo}`)).to.be.true;
  });

  it('returns the fee-schedule price when contractResults is empty', async function () {
    const result = await computeBlockGasPrice(ctx, [], blockTimestampTo, requestDetails);

    expect(result).to.equal(numberTo0x(fallbackWeibars));
    expect(getGasPriceStub.calledOnce).to.be.true;
  });

  it('returns the fee-schedule price when all results have null gas_price', async function () {
    const results = [makeResult(null, 1_000), makeResult(null, 2_000)];

    const result = await computeBlockGasPrice(
      ctx,
      results as MirrorNodeContractResult[],
      blockTimestampTo,
      requestDetails,
    );

    expect(result).to.equal(numberTo0x(fallbackWeibars));
    expect(getGasPriceStub.calledOnce).to.be.true;
  });

  it('returns the fee-schedule price when all results have zero gas_used', async function () {
    const results = [makeResult('0x72', 0), makeResult('0x94', 0)];

    const result = await computeBlockGasPrice(
      ctx,
      results as MirrorNodeContractResult[],
      blockTimestampTo,
      requestDetails,
    );

    expect(result).to.equal(numberTo0x(fallbackWeibars));
    expect(getGasPriceStub.calledOnce).to.be.true;
  });

  it('computes the weighted average for a single transaction', async function () {
    const results = [makeResult('0x72', 1_000)]; // 114 weibars, 1000 gas

    const result = await computeBlockGasPrice(
      ctx,
      results as MirrorNodeContractResult[],
      blockTimestampTo,
      requestDetails,
    );

    expect(result).to.equal(numberTo0x(114));
    expect(getGasPriceStub.called).to.be.false;
  });

  it('computes a gas-used-weighted average across multiple transactions', async function () {
    // Tx A: 114 weibars × 100 gas = 11,400
    // Tx B: 148 weibars × 900 gas = 133,200
    // total gas = 1,000 → average = 144,600 / 1,000 = 144.6 → rounds to 145
    const results = [makeResult('0x72', 100), makeResult('0x94', 900)];

    const result = await computeBlockGasPrice(
      ctx,
      results as MirrorNodeContractResult[],
      blockTimestampTo,
      requestDetails,
    );

    expect(result).to.equal(numberTo0x(145));
    expect(getGasPriceStub.called).to.be.false;
  });

  it('skips results with null gas_price and uses only valid ones', async function () {
    // Only the second result is valid: 114 weibars × 500 gas
    const results = [makeResult(null, 1_000), makeResult('0x72', 500)];

    const result = await computeBlockGasPrice(
      ctx,
      results as MirrorNodeContractResult[],
      blockTimestampTo,
      requestDetails,
    );

    expect(result).to.equal(numberTo0x(114));
    expect(getGasPriceStub.called).to.be.false;
  });

  it('rounds 0.5 up to the nearest weibar', async function () {
    // Two equal-weight transactions whose prices average to exactly X.5
    // 114 × 1 + 115 × 1 = 229 / 2 = 114.5 → rounds to 115
    const results = [makeResult('0x72', 1), makeResult('0x73', 1)];

    const result = await computeBlockGasPrice(
      ctx,
      results as MirrorNodeContractResult[],
      blockTimestampTo,
      requestDetails,
    );

    expect(result).to.equal(numberTo0x(115));
  });
});
