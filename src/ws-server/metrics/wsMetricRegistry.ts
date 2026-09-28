// SPDX-License-Identifier: Apache-2.0

import { type Counter, type Histogram, type Registry } from 'prom-client';

import { METRICS, MetricsFactory } from '../../metrics';

type WsMetricCounterTitles =
  'methodsCounter' | 'methodsCounterByIp' | 'totalMessageCounter' | 'totalOpenedConnections' | 'totalClosedConnections';

type WsMetricHistogramTitles = 'connectionDuration' | 'messageDuration';

export default class WsMetricRegistry {
  private methodsCounter: Counter; // tracks WebSocket method calls.
  private methodsCounterByIp: Counter; // tracks WebSocket method calls by IP address.
  private totalMessageCounter: Counter; // tracks the total messages sent to the websocket.
  private totalClosedConnections: Counter; // tracks the total websocket closed connections
  private totalOpenedConnections: Counter; // tracks the total websocket established connections
  private connectionDuration: Histogram; // tracks the duration of websocket connections in seconds
  private messageDuration: Histogram; // tracks the duration of websocket connections in seconds

  /**
   * Creates an instance of WsMetricRegistry.
   * @param {Registry} register - The Prometheus registry to use.
   */
  constructor(register: Registry) {
    const metricsFactory = new MetricsFactory(register);

    this.methodsCounter = metricsFactory.counter(METRICS.ws.methodsCounter);
    this.messageDuration = metricsFactory.histogram(METRICS.ws.messageDuration);
    this.methodsCounterByIp = metricsFactory.counter(METRICS.ws.methodsCounterByIp);
    this.totalMessageCounter = metricsFactory.counter(METRICS.ws.totalMessageCounter);
    this.connectionDuration = metricsFactory.histogram(METRICS.ws.connectionDuration);
    this.totalOpenedConnections = metricsFactory.counter(METRICS.ws.totalOpenedConnections);
    this.totalClosedConnections = metricsFactory.counter(METRICS.ws.totalClosedConnections);
  }

  /**
   * Get metric counter based on metric title
   * @returns {Counter}
   */
  public getCounter(metricTitle: WsMetricCounterTitles): Counter {
    return this[metricTitle];
  }

  /**
   * Get metric histogram based on metric title
   * @returns {Histogram}
   */
  public getHistogram(metricTitle: WsMetricHistogramTitles): Histogram {
    return this[metricTitle];
  }
}
