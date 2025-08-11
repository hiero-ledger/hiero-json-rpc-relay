// SPDX-License-Identifier: Apache-2.0

import { Counter, Histogram, Registry } from 'prom-client';

import { WS_CONSTANTS } from '../utils/constants';

type WsMetricCounterTitles =
  | 'methodsCounter'
  | 'methodsCounterByIp'
  | 'totalMessageCounter'
  | 'totalOpenedConnections'
  | 'totalClosedConnections';

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
    this.methodsCounter = this.generateCounterMetric(register, 'methodsCounter');
    this.messageDuration = this.generateHistogramMetric(register, 'messageDuration');
    this.methodsCounterByIp = this.generateCounterMetric(register, 'methodsCounterByIp');
    this.totalMessageCounter = this.generateCounterMetric(register, 'totalMessageCounter');
    this.connectionDuration = this.generateHistogramMetric(register, 'connectionDuration');
    this.totalOpenedConnections = this.generateCounterMetric(register, 'totalOpenedConnections');
    this.totalClosedConnections = this.generateCounterMetric(register, 'totalClosedConnections');
  }

  /**
   * Generates a counter metric based on the provided title and registers it with the given registry.
   * @param {Registry} register - The registry where the metric will be registered.
   * @param {WsMetricCounterTitles} metricTitle - The title of the metric to generate.
   * @returns {Counter} The generated counter metric.
   */
  private generateCounterMetric = (register: Registry, metricTitle: WsMetricCounterTitles): Counter => {
    register.removeSingleMetric(WS_CONSTANTS[metricTitle].name);
    return new Counter({
      name: WS_CONSTANTS[metricTitle].name,
      help: WS_CONSTANTS[metricTitle].help,
      labelNames: WS_CONSTANTS[metricTitle]['labelNames'] || [],
      registers: [register],
    });
  };

  /**
   * Generates a histogram metric based on the provided title and registers it with the given registry.
   * @param {Registry} register - The registry where the metric will be registered.
   * @param {WsMetricHistogramTitles} metricTitle - The title of the metric to generate.
   * @returns {Histogram} The generated histogram metric.
   */
  private generateHistogramMetric = (register: Registry, metricTitle: WsMetricHistogramTitles): Histogram => {
    register.removeSingleMetric(WS_CONSTANTS[metricTitle].name);
    return new Histogram({
      name: WS_CONSTANTS[metricTitle].name,
      help: WS_CONSTANTS[metricTitle].help,
      labelNames: WS_CONSTANTS[metricTitle]['labelNames'] || [],
      buckets: WS_CONSTANTS[metricTitle]['buckets'] || [],
      registers: [register],
    });
  };

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
