// SPDX-License-Identifier: Apache-2.0
import { Logger } from 'pino';
import { Gauge, Registry } from 'prom-client';

import { ConfigService } from '../../config-service/services';
import { Eth, JsonRpcError, predefined, Relay } from '../../relay';
import { RequestDetails } from '../../relay/lib/types';
import { Utils } from '../../relay/utils';
import { AbstractLockableService, type ILockableResource } from './lockableService';

export interface Poll extends ILockableResource {
  tag: string;
  callback: (...args: unknown[]) => unknown;
  lastPolled?: string;
}

const LOGGER_PREFIX = 'Poller:';

export class PollerService extends AbstractLockableService {
  private readonly eth: Eth;
  protected readonly logger: Logger;
  private polls: Poll[];
  private interval?: NodeJS.Timer;
  private latestBlock?: string;
  private readonly pollingInterval: number;
  private readonly newHeadsEnabled: boolean;
  private readonly activePollsGauge: Gauge;
  private readonly activeNewHeadsPollsGauge: Gauge;

  private NEW_HEADS_EVENT = 'newHeads';

  constructor(relay: Relay, logger: Logger, register: Registry) {
    super();
    this.eth = relay.eth();
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

  /**
   * Polls the Ethereum blockchain for new events and calls the callback function for each event.
   */
  private poll() {
    this.polls.forEach(async (poll) => {
      if (!this.lock(poll) || (this.latestBlock && poll.lastPolled === this.latestBlock)) return;
      try {
        this.logger.debug('%s Fetching data for tag: %s', LOGGER_PREFIX, poll.tag);

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
          this.logger.error('%s Polling for unsupported event: %s. Tag: %s', LOGGER_PREFIX, event, poll.tag);
        }

        if (Array.isArray(data)) {
          if (data.length) {
            this.logger.trace(`%s Received %d results from tag: %s`, LOGGER_PREFIX, data.length, poll.tag);
            data.forEach((d) => {
              poll.callback(d);
            });
          }
        } else {
          this.logger.trace('%s Received 1 result from tag: %s', LOGGER_PREFIX, poll.tag);
          poll.callback(data);
        }
      } catch (error) {
        if (this.wasRequestMalformed(error)) {
          poll.callback(error);
        } else {
          this.logger.error(error, `Poller error`);
        }
      }
      this.release(poll);
    });
  }

  /**
   * Detect if the error was caused by malformed request that there is no need to ever repeat.
   *
   * @param error
   * @private
   */
  private wasRequestMalformed(error: unknown) {
    if (!(error instanceof JsonRpcError)) return false;
    return [
      -32012, // INVALID_CONTRACT_ADDRESS
      -32000 - // INVALID_ARGUMENTS
        32602, // INVALID_PARAMETER
      -32011, // MISSING_FROM_BLOCK_PARAM
    ].includes(error.code);
  }

  /**
   * Starts the polling process.
   */
  public start() {
    this.logger.info('%s Starting polling with interval=%d', LOGGER_PREFIX, this.pollingInterval);
    this.interval = setInterval(async () => {
      this.latestBlock = await this.eth.blockNumber(
        new RequestDetails({ requestId: Utils.generateRequestId(), ipAddress: '' }),
      );
      this.poll();
    }, this.pollingInterval);
  }

  /**
   * Stops the polling process.
   */
  public stop() {
    this.logger.info('%s Stopping polling', LOGGER_PREFIX);
    if (this.isPolling()) {
      clearInterval(this.interval as NodeJS.Timeout);
      delete this.interval;
    }
  }

  /**
   * Adds a new poll to the polling list.
   * @param tag - The tag to add.
   * @param callback - The callback function to call when the poll is triggered.
   */
  public add(tag: string, callback: (...args: unknown[]) => unknown) {
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

  /**
   * Removes a poll from the polling list.
   * @param tag - The tag to remove.
   */
  public remove(tag: string) {
    this.logger.info('%s Tag %s removed from polling list', LOGGER_PREFIX, tag);
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
      this.logger.info('%s No active polls.', LOGGER_PREFIX);
      this.stop();
    }
  }

  /**
   * Checks if a poll exists in the polling list.
   * @param tag - The tag to check.
   * @returns True if the poll exists, false otherwise.
   */
  public hasPoll(tag: string): boolean {
    // Return boolean true if the polls array contains this tag
    return !!this.polls.filter((p) => p.tag === tag).length;
  }

  /**
   * Checks if the polling process is active.
   * @returns True if the polling process is active, false otherwise.
   */
  public isPolling() {
    return !!this.interval;
  }
}
