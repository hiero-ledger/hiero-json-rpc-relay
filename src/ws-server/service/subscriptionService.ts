// SPDX-License-Identifier: Apache-2.0

import crypto from 'crypto';
import { LRUCache } from 'lru-cache';
import { type Logger } from 'pino';
import { type Counter, type Histogram, type Registry } from 'prom-client';

import { ConfigService } from '../../config-service/services';
import { METRICS, MetricsFactory } from '../../metrics';
import { predefined } from '../../relay';
import { generateRandomHex } from '../../relay/formatters';
import { type Relay } from '../../relay/lib/relay';
import type { RelayWebSocket } from '../types';
import { PollerService } from './pollerService';

export interface Subscriber {
  connection: RelayWebSocket;
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

    this.cache = new LRUCache({ max: ConfigService.get('CACHE_MAX'), ttl: CACHE_TTL });

    const metricsFactory = new MetricsFactory(register);
    this.activeSubscriptionHistogram = metricsFactory.histogram(METRICS.ws.subscription.activeSubscriptionTimes);
    this.resultsSentToSubscribersCounter = metricsFactory.counter(METRICS.ws.subscription.resultsSentToSubscribers);
  }

  private createHash(data: string): string {
    return crypto.createHash('sha256').update(data.toString()).digest('hex');
  }

  // Generates a random 16 byte hex string
  public generateId(): string {
    return generateRandomHex();
  }

  /**
   * @param {RelayWebSocket} connection - The client connection to subscribe.
   * @param {string} event - The event to subscribe to.
   * @param {object} [filters] - The filters narrowing the event.
   * @returns {string} The id of the new subscription, or of the existing one when the connection is already subscribed to the same tag.
   * @throws {JsonRpcError} `MAX_SUBSCRIPTIONS` when a new subscription would take the connection over `WS_SUBSCRIPTION_LIMIT`.
   */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  public subscribe(connection: RelayWebSocket, event: string, filters?: {}): string {
    const tagObject: { event: string; filters?: typeof filters } = { event };
    if (filters && Object.keys(filters).length) {
      tagObject.filters = filters;
    }

    const tag = JSON.stringify(tagObject);

    if (ConfigService.get('WS_SAME_SUB_FOR_SAME_EVENT')) {
      // Check if the connection is already subscribed to this event
      const existingSub = this.subscriptions[tag]?.find((sub) => sub.connection.id === connection.id);
      if (existingSub) {
        this.logger.debug(`Connection %s: Attempting to subscribe to %s; already subscribed`, connection.id, tag);
        return existingSub.subscriptionId;
      }
    }

    if (!connection.limiter.validateSubscriptionLimit(connection)) {
      this.logger.warn(`Connection %s: Refusing to subscribe to %s; subscription limit reached`, connection.id, tag);
      throw predefined.MAX_SUBSCRIPTIONS;
    }

    const subId = this.generateId();

    this.logger.info(`Connection %s: created subscription %s, listening for %s`, connection.id, subId, tag);

    if (!this.subscriptions[tag]) {
      this.subscriptions[tag] = [];
    }

    this.subscriptions[tag].push({
      subscriptionId: subId,
      connection,
      endTimer: this.activeSubscriptionHistogram.startTimer(), // observes the time in seconds
    });
    connection.limiter.incrementSubs(connection);

    this.pollerService.add(tag, this.notifySubscribers.bind(this, tag));

    return subId;
  }

  public unsubscribe(connection: RelayWebSocket, subId?: string): number {
    const { id } = connection;

    if (subId) {
      this.logger.info(`Connection %s: Unsubscribing from %s`, id, subId);
    } else {
      this.logger.info(`Connection %s: Unsubscribing from all subscriptions`, id);
    }

    let subCount = 0;
    for (const [tag, subs] of Object.entries(this.subscriptions)) {
      this.subscriptions[tag] = subs.filter((sub) => {
        const match = sub.connection.id === id && (!subId || subId === sub.subscriptionId);
        if (match) {
          this.logger.debug(
            `Connection %s. Unsubscribing subId: %s; tag: %s`,
            sub.connection.id,
            sub.subscriptionId,
            tag,
          );
          sub.endTimer();
          subCount++;
        }

        return !match;
      });

      if (!this.subscriptions[tag].length) {
        this.logger.debug(`No subscribers for %s. Removing from list.`, tag);
        delete this.subscriptions[tag];
        this.pollerService.remove(tag);
      }
    }

    return subCount;
  }

  public notifySubscribers(tag: string, data: unknown): void {
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
          this.logger.debug(
            `Sending data from tag: %s to subscriptionId: %s, connectionId: %s, data: %s`,
            tag,
            sub.subscriptionId,
            sub.connection.id,
            subscriptionData,
          );
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
