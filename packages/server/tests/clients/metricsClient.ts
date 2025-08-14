// SPDX-License-Identifier: Apache-2.0

import Axios, { AxiosInstance } from 'axios';
import { Logger } from 'pino';

export default class MetricsClient {
  private readonly logger: Logger;
  private readonly client: AxiosInstance;
  private readonly relayUrl: string;

  constructor(relayUrl: string, logger: Logger) {
    this.logger = logger;
    this.relayUrl = relayUrl;

    const metricsClient = Axios.create({
      baseURL: `${relayUrl}/metrics`,
      responseType: 'json' as const,
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'GET',
      timeout: 5 * 1000,
    });

    this.client = metricsClient;
  }

  /**
   * Retrieves the value of a specified metric.
   *
   * The response from the /metrics endpoint is a large string with multiple rows of key-value pairs,
   * separated by " ", where the key is the metric name.
   * Rows may begin with #, which represents a comment and should be ignored.
   * This method retrieves the whole response, splits it into rows, finds the first row that starts with the
   * provided metric name and returns the corresponding value.
   *
   * Example extract:
   *
   * pc_relay_hbar_rate_remaining 11000000000
   * rpc_relay_cache 0
   * rpc_websocket_subscription_times_bucket{le="0.05"} 0
   * rpc_websocket_subscription_times_bucket{le="1"} 0
   * rpc_websocket_subscription_times_bucket{le="10"} 0
   * rpc_websocket_subscription_times_bucket{le="60"} 0
   *
   * @param metric
   */
  async get(metric: string) {
    const allMetrics = (await this.client.get('')).data;
    const allMetricsArray = allMetrics.split('\n');
    const matchPattern = `${metric} `;
    const result = allMetricsArray.find((m) => m.startsWith(matchPattern));
    return result.replace(matchPattern, '');
  }
}
