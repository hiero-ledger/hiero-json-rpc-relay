// SPDX-License-Identifier: Apache-2.0

import Axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { Logger } from 'pino';

export default class MirrorClient {
  private readonly logger: Logger;
  private readonly client: AxiosInstance;

  constructor(mirrorNodeUrl: string, logger: Logger) {
    this.logger = logger;

    const mirrorNodeClient = Axios.create({
      baseURL: `${mirrorNodeUrl}/api/v1`,
      responseType: 'json' as const,
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'GET',
      timeout: 5 * 1000,
    });

    // allow retries given mirror node waits for consensus, record stream serialization, export and import before parsing and exposing
    axiosRetry(mirrorNodeClient, {
      retries: 5,
      retryDelay: (retryCount) => {
        return retryCount * 1000;
      },
      retryCondition: (error) => {
        // if retry condition is not specified, by default idempotent requests are retried
        return error?.response?.status === 400 || error?.response?.status === 404;
      },
      shouldResetTimeout: true,
    });

    this.client = mirrorNodeClient;
  }

  async get(path: string) {
    return (await this.client.get(path)).data;
  }
}
