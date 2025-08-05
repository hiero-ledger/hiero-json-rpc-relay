// SPDX-License-Identifier: Apache-2.0
import { expect } from 'chai';
import { Counter, Histogram, Registry } from 'prom-client';
import sinon from 'sinon';

import WsMetricRegistry from '../../src/metrics/wsMetricRegistry';
import { WS_CONSTANTS } from '../../src/utils/constants';

describe('WsMetricRegistry', function () {
  let mockRegistry: Registry;
  let removeSingleMetricStub: sinon.SinonStub;
  let wsMetricRegistry: WsMetricRegistry;

  beforeEach(() => {
    mockRegistry = new Registry();
    removeSingleMetricStub = sinon.stub(mockRegistry, 'removeSingleMetric');

    wsMetricRegistry = new WsMetricRegistry(mockRegistry);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('constructor', function () {
    const counterMetrics = [
      'methodsCounter',
      'methodsCounterByIp',
      'totalMessageCounter',
      'totalOpenedConnections',
      'totalClosedConnections',
    ] as const;

    counterMetrics.forEach((metric) => {
      it(`should initialize the ${metric} counter metric`, function () {
        sinon.assert.calledWith(removeSingleMetricStub, WS_CONSTANTS[metric].name);
      });
    });

    const histogramMetrics = ['connectionDuration', 'messageDuration'] as const;

    histogramMetrics.forEach((metric) => {
      it(`should initialize the ${metric} histogram metric`, function () {
        sinon.assert.calledWith(removeSingleMetricStub, WS_CONSTANTS[metric].name);
      });
    });

    const gaugeMetrics = ['cpuUsageGauge', 'memoryUsageGauge'] as const;

    gaugeMetrics.forEach((metric) => {
      it(`should initialize the ${metric} gauge metric`, function () {
        sinon.assert.calledWith(removeSingleMetricStub, WS_CONSTANTS[metric].name);
      });
    });
  });

  describe('getCounter', function () {
    it('should return methodsCounter', function () {
      const counter = wsMetricRegistry.getCounter('methodsCounter');
      expect(counter).to.be.instanceOf(Counter);
    });

    it('should return methodsCounterByIp', function () {
      const counter = wsMetricRegistry.getCounter('methodsCounterByIp');
      expect(counter).to.be.instanceOf(Counter);
    });

    it('should return totalMessageCounter', function () {
      const counter = wsMetricRegistry.getCounter('totalMessageCounter');
      expect(counter).to.be.instanceOf(Counter);
    });

    it('should return totalOpenedConnections', function () {
      const counter = wsMetricRegistry.getCounter('totalOpenedConnections');
      expect(counter).to.be.instanceOf(Counter);
    });

    it('should return totalClosedConnections', function () {
      const counter = wsMetricRegistry.getCounter('totalClosedConnections');
      expect(counter).to.be.instanceOf(Counter);
    });

    it('should allow incrementing counters', function () {
      const methodsCounter = wsMetricRegistry.getCounter('methodsCounter');

      expect(() => methodsCounter.inc()).to.not.throw();
      expect(() => methodsCounter.labels('eth_call').inc()).to.not.throw();
    });
  });

  describe('getHistogram', function () {
    it('should return connectionDuration histogram', function () {
      const histogram = wsMetricRegistry.getHistogram('connectionDuration');
      expect(histogram).to.be.instanceOf(Histogram);
    });

    it('should return messageDuration histogram', function () {
      const histogram = wsMetricRegistry.getHistogram('messageDuration');
      expect(histogram).to.be.instanceOf(Histogram);
    });

    it('should allow observing histogram values', function () {
      const connectionDuration = wsMetricRegistry.getHistogram('connectionDuration');
      const messageDuration = wsMetricRegistry.getHistogram('messageDuration');

      expect(() => connectionDuration.observe(1.5)).to.not.throw();
      expect(() => messageDuration.labels('eth_call').observe(100)).to.not.throw();
    });
  });

  describe('metric properties', function () {
    it('should have correct metric names from WS_CONSTANTS', function () {
      const methodsCounter = wsMetricRegistry.getCounter('methodsCounter');
      const connectionDuration = wsMetricRegistry.getHistogram('connectionDuration');

      expect((methodsCounter as any).name).to.equal(WS_CONSTANTS.methodsCounter.name);
      expect((connectionDuration as any).name).to.equal(WS_CONSTANTS.connectionDuration.name);
    });

    it('should have correct buckets for histograms', function () {
      const connectionDuration = wsMetricRegistry.getHistogram('connectionDuration');
      const messageDuration = wsMetricRegistry.getHistogram('messageDuration');

      // Check that buckets are properly configured
      expect((connectionDuration as any).buckets).to.deep.equal(WS_CONSTANTS.connectionDuration.buckets);
      expect((messageDuration as any).buckets).to.deep.equal(WS_CONSTANTS.messageDuration.buckets);
    });

    it('should have correct label names for metrics with labels', function () {
      const methodsCounter = wsMetricRegistry.getCounter('methodsCounter');
      const methodsCounterByIp = wsMetricRegistry.getCounter('methodsCounterByIp');

      expect((methodsCounter as any).labelNames).to.deep.equal(WS_CONSTANTS.methodsCounter.labelNames);
      expect((methodsCounterByIp as any).labelNames).to.deep.equal(WS_CONSTANTS.methodsCounterByIp.labelNames);
    });
  });

  describe('error handling', function () {
    it('should handle registry errors gracefully', function () {
      const faultyRegistry = new Registry();
      sinon.stub(faultyRegistry, 'removeSingleMetric').throws(new Error('Registry error'));

      expect(() => {
        new WsMetricRegistry(faultyRegistry);
      }).to.throw('Registry error');
    });
  });
});
