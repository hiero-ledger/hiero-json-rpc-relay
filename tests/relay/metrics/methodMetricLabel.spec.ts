// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { createMethodMetricLabeler, UNKNOWN_METHOD_LABEL } from '../../../src/metrics';

describe('createMethodMetricLabeler', function () {
  it('records known methods verbatim and never counts them against the limit', function () {
    const label = createMethodMetricLabeler(['eth_chainId', 'eth_blockNumber'], 0);

    expect(label('eth_chainId')).to.equal('eth_chainId');
    expect(label('eth_blockNumber')).to.equal('eth_blockNumber');
  });

  it('records unknown methods verbatim up to the limit, then collapses the rest', function () {
    const label = createMethodMetricLabeler(['eth_chainId'], 2);

    expect(label('eth_unknownA')).to.equal('eth_unknownA');
    expect(label('eth_unknownB')).to.equal('eth_unknownB');
    // Limit reached: a new distinct unknown collapses.
    expect(label('eth_unknownC')).to.equal(UNKNOWN_METHOD_LABEL);
    // An already-tracked unknown is still returned verbatim.
    expect(label('eth_unknownA')).to.equal('eth_unknownA');
  });

  it('collapses oversized and malformed names without consuming a tracking slot', function () {
    const label = createMethodMetricLabeler([], 2);

    // Oversized (> 64 chars) and malformed (invalid chars) names never take a slot.
    expect(label('eth_' + 'a'.repeat(100))).to.equal(UNKNOWN_METHOD_LABEL);
    expect(label('eth_get("1")')).to.equal(UNKNOWN_METHOD_LABEL);
    expect(label(42)).to.equal(UNKNOWN_METHOD_LABEL);
    expect(label(undefined)).to.equal(UNKNOWN_METHOD_LABEL);

    // Both slots remain available for valid unknown names.
    expect(label('eth_ok1')).to.equal('eth_ok1');
    expect(label('eth_ok2')).to.equal('eth_ok2');
    expect(label('eth_ok3')).to.equal(UNKNOWN_METHOD_LABEL);
  });

  it('bounds the total distinct labels to the known set plus the limit', function () {
    const known = ['eth_chainId', 'eth_blockNumber'];
    const limit = 5;
    const label = createMethodMetricLabeler(known, limit);

    const emitted = new Set<string>();
    emitted.add(label('eth_chainId'));
    for (let i = 0; i < 1000; i++) {
      emitted.add(label(`eth_invented${i}`));
    }

    // Distinct label values can never exceed the known methods seen plus the unknown limit (the
    // overflow all collapses to the single `unknown` label).
    expect(emitted.size).to.be.at.most(known.length + limit);
    expect(emitted.has(UNKNOWN_METHOD_LABEL)).to.be.true;
  });
});
