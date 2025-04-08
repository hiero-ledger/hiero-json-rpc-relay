// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { generateRandomHex } from '@hashgraph/json-rpc-relay/dist/formatters';
import { Relay } from '@hashgraph/json-rpc-relay/dist/lib/relay';
import crypto from 'crypto';
import LRU from 'lru-cache';
import LRUCache from 'lru-cache';
import { Logger } from 'pino';
import { Counter, Histogram, Registry } from 'prom-client';

import { PollerService } from './pollerService';

export interface Subscriber {
  connection: any;
  subscriptionId: string;
  endTimer: () => void;
}

const CACHE_TTL = ConfigService.get('WS_CACHE_TTL');

export class SubscriptionService {
  private pollerService: PollerService;
  private logger: Logger;
  private subscriptions: { [key: string]: Subscriber[] };
  private cache: LRUCache<string, boolean>;
  private activeSubscriptionHistogram: Histogram;
  private resultsSentToSubscribersCounter: Counter;

  constructor(relay: Relay, logger: Logger, register: Registry) {
    this.pollerService = new PollerService(relay, logger.child({ name: 'poller' }), register);
    this.logger = logger;
    this.subscriptions = {};

    this.cache = new LRU({ max: ConfigService.get('CACHE_MAX'), ttl: CACHE_TTL });

    const activeSubscriptionHistogramName = 'rpc_websocket_subscription_times';
    register.removeSingleMetric(activeSubscriptionHistogramName);
    this.activeSubscriptionHistogram = new Histogram({
      name: activeSubscriptionHistogramName,
      help: 'Relay websocket active subscription timer',
      registers: [register],
      buckets: [
        0.05, // fraction of a second
        1, // one second
        10, // 10 seconds
        60, // 1 minute
        120, // 2 minute
        300, // 5 minutes
        1200, // 20 minutes
        3600, // 1 hour
        86400, // 24 hours
      ],
    });

    const resultsSentToSubscribersCounterName = 'rpc_websocket_poll_received_results';
    register.removeSingleMetric(resultsSentToSubscribersCounterName);
    this.resultsSentToSubscribersCounter = new Counter({
      name: 'rpc_websocket_poll_received_results',
      help: 'Relay websocket counter for the unique results sent to subscribers',
      registers: [register],
      labelNames: ['subId', 'tag'],
    });
  }

  private createHash(data: string) {
    return crypto.createHash('sha256').update(data.toString()).digest('hex');
  }

  // Generates a random 16 byte hex string
  public generateId() {
    return generateRandomHex();
  }

  public subscribe(connection, event: string, filters?: {}) {
    let tag: any = { event };
    if (filters && Object.keys(filters).length) {
      tag.filters = filters;
    }

    tag = JSON.stringify(tag);

    if (!this.subscriptions[tag]) {
      this.subscriptions[tag] = [];
    }

    if (ConfigService.get('WS_SAME_SUB_FOR_SAME_EVENT')) {
      // Check if the connection is already subscribed to this event
      const existingSub = this.subscriptions[tag].find((sub) => sub.connection.id === connection.id);
      if (existingSub) {
        if (this.logger.isLevelEnabled('debug')) {
          this.logger.debug(`Connection ${connection.id}: Attempting to subscribe to ${tag}; already subscribed`);
        }
        return existingSub.subscriptionId;
      }
    }

    const subId = this.generateId();

    this.logger.info(`Connection ${connection.id}: created subscription ${subId}, listening for ${tag}`);

    this.subscriptions[tag].push({
      subscriptionId: subId,
      connection,
      endTimer: this.activeSubscriptionHistogram.startTimer(), // observes the time in seconds
    });

    this.pollerService.add(tag, this.notifySubscribers.bind(this, tag));

    return subId;
  }

  public unsubscribe(connection, subId?: string) {
    const { id } = connection;

    if (subId) {
      this.logger.info(`Connection ${id}: Unsubscribing from ${subId}`);
    } else {
      this.logger.info(`Connection ${id}: Unsubscribing from all subscriptions`);
    }

    let subCount = 0;
    for (const [tag, subs] of Object.entries(this.subscriptions)) {
      this.subscriptions[tag] = subs.filter((sub) => {
        const match = sub.connection.id === id && (!subId || subId === sub.subscriptionId);
        if (match) {
          if (this.logger.isLevelEnabled('debug')) {
            this.logger.debug(
              `Connection ${sub.connection.id}. Unsubscribing subId: ${sub.subscriptionId}; tag: ${tag}`,
            );
          }
          sub.endTimer();
          subCount++;
        }

        return !match;
      });

      if (!this.subscriptions[tag].length) {
        if (this.logger.isLevelEnabled('debug')) {
          this.logger.debug(`No subscribers for ${tag}. Removing from list.`);
        }
        delete this.subscriptions[tag];
        this.pollerService.remove(tag);
      }
    }

    return subCount;
  }

  public notifySubscribers(tag, data) {
    if (this.subscriptions[tag] && this.subscriptions[tag].length) {
      this.subscriptions[tag].forEach((sub) => {
        const subscriptionData = {
          result: data,
          subscription: sub.subscriptionId,
        };
        const hash = this.createHash(JSON.stringify(subscriptionData));

        // If the hash exists in the cache then the data has recently been sent to the subscriber
        if (!this.cache.get(hash)) {
          this.cache.set(hash, true);
          if (this.logger.isLevelEnabled('debug')) {
            this.logger.debug(
              `Sending data from tag: ${tag} to subscriptionId: ${sub.subscriptionId}, connectionId: ${sub.connection.id}, data: ${subscriptionData}`,
            );
          }
          this.resultsSentToSubscribersCounter.labels('sub.subscriptionId', tag).inc();
          sub.connection.send(
            JSON.stringify({
              jsonrpc: '2.0',
              method: 'eth_subscription',
              params: subscriptionData,
            }),
          );
          sub.connection.limiter.resetInactivityTTLTimer(sub.connection);
        }
      });
    }
  }
}
