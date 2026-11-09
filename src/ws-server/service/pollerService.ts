// SPDX-License-Identifier: Apache-2.0
import { ContractId } from '@hiero-ledger/sdk';
import { type Logger } from 'pino';
import { type Counter, type Gauge, type Registry } from 'prom-client';

import { ConfigService } from '../../config-service/services';
import { METRICS, MetricsFactory } from '../../metrics';
import { type Eth, JsonRpcError, predefined, type Relay } from '../../relay';
import { numberTo0x, prepend0x, trimPrecedingZeros } from '../../relay/formatters';
import { type MirrorNodeClient } from '../../relay/lib/clients';
import constants from '../../relay/lib/constants';
import { type Block, Log } from '../../relay/lib/model';
import { CommonService } from '../../relay/lib/services';
import { type TxPoolImpl } from '../../relay/lib/txpool';
import { type MirrorNodeContractLog, RequestDetails } from '../../relay/lib/types';
import { Utils } from '../../relay/utils';
import { WS_CONSTANTS } from '../utils/constants';

interface PollFilters {
  address?: string | string[];
  topics?: (string | (string | null)[] | null)[];
  includeTransactions?: boolean;
}

interface MatchableLog {
  log: Log;
  addresses: string[];
  topics: string[];
}

export interface Poll {
  tag: string;
  event: string;
  filters?: PollFilters;
  callback: (...args: unknown[]) => unknown;
  pendingTxHashes?: Set<string>;
}

interface Loop {
  timer?: NodeJS.Timeout;
  failures: number;
  lastBlock?: number;
  lastHead?: number;
}

const LOGGER_PREFIX = 'Poller:';

const normalizeTopic = (topic: string): string => (trimPrecedingZeros(topic) ?? topic).toLowerCase();

const toMatchableLog = (log: MirrorNodeContractLog): MatchableLog => ({
  log: Log.fromMirrorNodeContractLog(log),
  addresses: [log.address.toLowerCase(), prepend0x(ContractId.fromString(log.contract_id).toEvmAddress())],
  topics: log.topics.map(normalizeTopic),
});

const filterLogs = (logs: MatchableLog[], { address, topics }: PollFilters = {}): Log[] => {
  const addresses = new Set([address ?? []].flat().map((a) => a.toLowerCase()));
  const wanted = (topics ?? []).map((topic) => {
    const values = [topic].flat();
    return values.length && values.every((value): value is string => value !== null)
      ? new Set(values.map(normalizeTopic))
      : null;
  });
  return logs
    .filter(
      (log) =>
        (!addresses.size || log.addresses.some((a) => addresses.has(a))) &&
        wanted.every((set, i) => !set || set.has(log.topics[i])),
    )
    .map(({ log }) => log);
};

export class PollerService {
  private readonly relay: Relay;
  private readonly eth: Eth;
  private readonly mirrorNodeClient: MirrorNodeClient;
  private readonly logger: Logger;
  private polls: Poll[];
  private loop?: Loop;
  private readonly activePollsGauge: Gauge;
  private readonly activeNewHeadsPollsGauge: Gauge;
  private readonly lagGauge: Gauge;
  private readonly failedPollsCounter: Counter;

  constructor(relay: Relay, logger: Logger, register: Registry) {
    this.relay = relay;
    this.eth = relay.eth();
    this.mirrorNodeClient = relay.mirrorClient();
    this.logger = logger;
    this.polls = [];

    const metricsFactory = new MetricsFactory(register);
    this.activePollsGauge = metricsFactory.gauge(METRICS.ws.poller.activePolls);
    this.activeNewHeadsPollsGauge = metricsFactory.gauge(METRICS.ws.poller.activeNewHeadsPolls);
    this.lagGauge = metricsFactory.gauge(METRICS.ws.poller.lagBlocks);
    this.failedPollsCounter = metricsFactory.counter(METRICS.ws.poller.failedPolls);
  }

  private pollsFor(event: string): Poll[] {
    return this.polls.filter((poll) => poll.event === event);
  }

  /**
   * Runs one poll and only then schedules the next, so polls never overlap.
   */
  private async poll(loop: Loop): Promise<void> {
    const requestDetails = new RequestDetails({ requestId: Utils.generateRequestId(), ipAddress: '' });
    let delay = ConfigService.get('WS_POLLING_INTERVAL');

    try {
      await this.pollPendingTransactions(loop);
    } catch (error) {
      this.logger.error(error, `${LOGGER_PREFIX} Failed to poll pending transactions`);
    }

    try {
      if (await this.pollBlocks(loop, requestDetails)) {
        delay = 0;
      }
      loop.failures = 0;
    } catch (error) {
      this.failedPollsCounter.inc();
      loop.failures++;
      delay = Math.min(delay * 2 ** loop.failures, WS_CONSTANTS.POLLER_MAX_RETRY_DELAY_MS);
      this.logger.error(error, `${LOGGER_PREFIX} Poll failed, retrying in ${delay}ms`);
    }

    if (this.loop === loop) {
      loop.timer = setTimeout(() => void this.poll(loop), delay);
    }
  }

  private async pollPendingTransactions(loop: Loop): Promise<void> {
    const polls = this.pollsFor(constants.SUBSCRIBE_EVENTS.NEW_PENDING_TRANSACTIONS);
    if (!polls.length) {
      return;
    }

    const txs = await (this.relay.txpool() as TxPoolImpl).pendingTransactions();
    if (this.loop !== loop) {
      return;
    }

    for (const poll of polls) {
      // Transactions can stay pooled past the subscription cache's TTL, so only send the ones the last poll didn't see.
      const fresh = txs.filter((tx) => !poll.pendingTxHashes?.has(tx.hash));
      poll.pendingTxHashes = new Set(txs.map((tx) => tx.hash));
      (poll.filters?.includeTransactions ? fresh : fresh.map((tx) => tx.hash)).forEach((data) => poll.callback(data));
    }
  }

  /**
   * Sends newHeads and logs for the blocks since the last poll, returning true while missed blocks are left.
   */
  private async pollBlocks(loop: Loop, requestDetails: RequestDetails): Promise<boolean> {
    const latest = Number(await this.eth.blockNumber(requestDetails));
    // Stop if the loop was stopped or restarted while waiting, so a stale poll doesn't touch the lag or fetch blocks.
    if (this.loop !== loop) {
      return false;
    }
    if (loop.lastBlock === undefined || loop.lastHead === undefined) {
      loop.lastBlock = loop.lastHead = latest;
      return false;
    }
    this.lagGauge.set(latest - loop.lastBlock);

    const logsPolls = this.pollsFor(constants.SUBSCRIBE_EVENTS.LOGS);
    const newHeadsPolls = ConfigService.get('WS_NEW_HEADS_ENABLED')
      ? this.pollsFor(constants.SUBSCRIBE_EVENTS.NEW_HEADS)
      : [];

    const from = loop.lastBlock + 1;
    let to = logsPolls.length ? Math.min(latest, loop.lastBlock + WS_CONSTANTS.POLLER_MAX_BLOCKS_PER_POLL) : latest;

    let logs: MatchableLog[] = [];
    while (logsPolls.length && from <= to) {
      try {
        logs = await this.fetchLogs(from, to, requestDetails);
        break;
      } catch (error) {
        // Too many logs for one query, so retry with fewer blocks rather than failing on the same range forever.
        if (!(error instanceof JsonRpcError) || error.code !== predefined.PAGINATION_MAX(0).code || from === to) {
          throw error;
        }
        to = from + Math.floor((to - from) / 2);
      }
    }
    const heads =
      newHeadsPolls.length && latest > loop.lastHead
        ? await this.fetchHeads(latest, newHeadsPolls, requestDetails)
        : undefined;

    if (this.loop !== loop) {
      return false;
    }

    if (heads) {
      if ([...heads.values()].includes(null)) {
        this.logger.warn(`${LOGGER_PREFIX} No block returned for block ${latest}, skipping notification`);
      } else {
        newHeadsPolls.forEach((poll) =>
          poll.callback({ ...heads.get(poll.filters?.includeTransactions ?? false), jsonrpc: '2.0' }),
        );
        loop.lastHead = latest;
      }
    }

    if (from <= to) {
      for (const poll of logsPolls) {
        filterLogs(logs, poll.filters).forEach((log) => poll.callback(log));
      }
      loop.lastBlock = to;
    }

    this.lagGauge.set(latest - loop.lastBlock);
    return loop.lastBlock < latest;
  }

  /**
   * Fetches every log in the block range with one unfiltered query, so the cost doesn't grow with the filters.
   */
  private async fetchLogs(from: number, to: number, requestDetails: RequestDetails): Promise<MatchableLog[]> {
    const fromBlock = await this.mirrorNodeClient.getBlock(from, requestDetails);
    const toBlock = from === to ? fromBlock : await this.mirrorNodeClient.getBlock(to, requestDetails);
    if (!fromBlock || !toBlock) {
      throw new Error(`Mirror node has no block ${fromBlock ? to : from} yet`);
    }

    const logs = await this.mirrorNodeClient.getContractResultsLogsWithRetry(
      requestDetails,
      CommonService.SEQUENTIAL_SLICE_COUNT,
      { timestamp: [`gte:${fromBlock.timestamp.from}`, `lte:${toBlock.timestamp.to}`] },
      this.mirrorNodeClient.getLimitOrderQueryParam(ConfigService.get('MIRROR_NODE_LIMIT_PARAM'), constants.ORDER.ASC),
    );
    this.logger.trace(`${LOGGER_PREFIX} Fetched %s logs for blocks %s-%s`, logs.length, from, to);

    return logs.map(toMatchableLog);
  }

  private async fetchHeads(
    blockNumber: number,
    polls: Poll[],
    requestDetails: RequestDetails,
  ): Promise<Map<boolean, Block | null>> {
    const heads = new Map<boolean, Block | null>();
    for (const includeTransactions of new Set(polls.map((poll) => poll.filters?.includeTransactions ?? false))) {
      heads.set(
        includeTransactions,
        await this.eth.getBlockByNumber(numberTo0x(blockNumber), includeTransactions, requestDetails),
      );
    }
    return heads;
  }

  /**
   * Starts the polling process.
   */
  public start(): void {
    this.logger.info(`${LOGGER_PREFIX} Starting polling with interval=${ConfigService.get('WS_POLLING_INTERVAL')}`);
    const loop: Loop = { failures: 0 };
    this.loop = loop;
    void this.poll(loop);
  }

  /**
   * Stops the polling process.
   */
  public stop(): void {
    this.logger.info(`${LOGGER_PREFIX} Stopping polling`);
    if (this.loop) {
      clearTimeout(this.loop.timer);
      delete this.loop;
      this.lagGauge.set(0);
    }
  }

  /**
   * Adds a new poll to the polling list.
   * @param tag - The tag to add.
   * @param callback - The callback function to call when the poll is triggered.
   */
  public add(tag: string, callback: (...args: unknown[]) => unknown): void {
    if (!this.hasPoll(tag)) {
      this.logger.info(`${LOGGER_PREFIX} Tag ${tag} added to polling list`);
      const { event, filters } = JSON.parse(tag);
      this.polls.push({
        tag,
        event,
        filters,
        callback,
      });
      if (event === constants.SUBSCRIBE_EVENTS.NEW_HEADS) {
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
  public remove(tag: string): void {
    this.logger.info(`${LOGGER_PREFIX} Tag ${tag} removed from polling list`);
    const pollsAtStart = this.polls.length;
    this.polls = this.polls.filter((p) => p.tag !== tag);

    const pollsRemoved = pollsAtStart - this.polls.length;
    if (pollsRemoved > 0) {
      if (JSON.parse(tag).event === constants.SUBSCRIBE_EVENTS.NEW_HEADS) {
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
  public isPolling(): boolean {
    return !!this.loop;
  }
}
