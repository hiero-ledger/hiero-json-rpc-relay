// SPDX-License-Identifier: Apache-2.0

import { Eth } from '../index';
import { Logger } from 'pino';
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Gauge, Registry } from 'prom-client';
import { RequestDetails } from './types';
import { Utils } from '../utils';

export interface Poll {
  tag: string;
  callback: Function;
  lastPolled?: string;
}

const LOGGER_PREFIX = 'Poller:';

export class Poller {
  private readonly eth: Eth;
  private readonly logger: Logger;
  private polls: Poll[];
  private interval?: NodeJS.Timer;
  private latestBlock?: string;
  private readonly pollingInterval: number;
  private readonly newHeadsEnabled: boolean;
  private readonly activePollsGauge: Gauge;
  private readonly activeNewHeadsPollsGauge: Gauge;

  private NEW_HEADS_EVENT = 'newHeads';

  constructor(eth: Eth, logger: Logger, register: Registry) {
    this.eth = eth;
    this.logger = logger;
    this.polls = [];
    this.pollingInterval = ConfigService.get('WS_POLLING_INTERVAL');
    this.newHeadsEnabled = ConfigService.get('WS_NEW_HEADS_ENABLED');

    const activePollsGaugeName = 'rpc_websocket_active_polls';
    register.removeSingleMetric(activePollsGaugeName);
    this.activePollsGauge = new Gauge({
      name: activePollsGaugeName,
      help: 'Relay websocket active polls count',
      registers: [register],
    });

    const activeNewHeadsPollsGaugeName = 'rpc_websocket_active_newheads_polls';
    register.removeSingleMetric(activeNewHeadsPollsGaugeName);
    this.activeNewHeadsPollsGauge = new Gauge({
      name: activeNewHeadsPollsGaugeName,
      help: 'Relay websocket active newHeads polls count',
      registers: [register],
    });
  }

  public poll() {
    this.polls.forEach(async (poll) => {
      try {
        if (this.logger.isLevelEnabled('debug')) {
          this.logger.debug(`${LOGGER_PREFIX} Fetching data for tag: ${poll.tag}`);
        }

        const { event, filters } = JSON.parse(poll.tag);
        let data;

        if (event === 'logs') {
          data = await this.eth.getLogs(
            {
              blockHash: null,
              fromBlock: poll.lastPolled || this.latestBlock || 'latest',
              toBlock: 'latest',
              address: filters?.address || null,
              topics: filters?.topics || null,
            },
            new RequestDetails({ requestId: Utils.generateRequestId(), ipAddress: '' }),
          );

          poll.lastPolled = this.latestBlock;
        } else if (event === this.NEW_HEADS_EVENT && this.newHeadsEnabled) {
          data = await this.eth.getBlockByNumber(
            'latest',
            filters?.includeTransactions ?? false,
            new RequestDetails({ requestId: Utils.generateRequestId(), ipAddress: '' }),
          );
          data.jsonrpc = '2.0';
          poll.lastPolled = this.latestBlock;
        } else {
          this.logger.error(`${LOGGER_PREFIX} Polling for unsupported event: ${event}. Tag: ${poll.tag}`);
        }

        if (Array.isArray(data)) {
          if (data.length) {
            if (this.logger.isLevelEnabled('trace')) {
              this.logger.trace(`${LOGGER_PREFIX} Received ${data.length} results from tag: ${poll.tag}`);
            }
            data.forEach((d) => {
              poll.callback(d);
            });
          }
        } else {
          if (this.logger.isLevelEnabled('trace')) {
            this.logger.trace(`${LOGGER_PREFIX} Received 1 result from tag: ${poll.tag}`);
          }
          poll.callback(data);
        }
      } catch (error) {
        this.logger.error(error, `Poller error`);
      }
    });
  }

  start() {
    this.logger.info(`${LOGGER_PREFIX} Starting polling with interval=${this.pollingInterval}`);
    this.interval = setInterval(async () => {
      this.latestBlock = await this.eth.blockNumber(
        new RequestDetails({ requestId: Utils.generateRequestId(), ipAddress: '' }),
      );
      this.poll();
    }, this.pollingInterval);
  }

  stop() {
    this.logger.info(`${LOGGER_PREFIX} Stopping polling`);
    if (this.isPolling()) {
      clearInterval(this.interval as NodeJS.Timeout);
      delete this.interval;
    }
  }

  add(tag: string, callback: Function) {
    if (!this.hasPoll(tag)) {
      this.logger.info(`${LOGGER_PREFIX} Tag ${tag} added to polling list`);
      this.polls.push({
        tag,
        callback,
      });
      if (JSON.parse(tag).event === this.NEW_HEADS_EVENT) {
        this.activeNewHeadsPollsGauge.inc();
      } else {
        this.activePollsGauge.inc();
      }
    }

    if (!this.isPolling()) {
      this.start();
    }
  }

  remove(tag: string) {
    this.logger.info(`${LOGGER_PREFIX} Tag ${tag} removed from polling list`);
    const pollsAtStart = this.polls.length;
    this.polls = this.polls.filter((p) => p.tag !== tag);

    const pollsRemoved = pollsAtStart - this.polls.length;
    if (pollsRemoved > 0) {
      if (JSON.parse(tag).event === this.NEW_HEADS_EVENT) {
        this.activeNewHeadsPollsGauge.dec(pollsRemoved);
      } else {
        this.activePollsGauge.dec(pollsRemoved);
      }
    }

    if (!this.polls.length) {
      this.logger.info(`${LOGGER_PREFIX} No active polls.`);
      this.stop();
    }
  }

  hasPoll(tag): boolean {
    // Return boolean true if the polls array contains this tag
    return !!this.polls.filter((p) => p.tag === tag).length;
  }

  isPolling() {
    return !!this.interval;
  }
}
