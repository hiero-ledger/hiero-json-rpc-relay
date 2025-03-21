// SPDX-License-Identifier: Apache-2.0
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Relay } from '@hashgraph/json-rpc-relay/dist';
import { Logger } from 'pino';
import { Registry } from 'prom-client';

import { SubscriptionController } from './controllers/subscriptionController';
import { Poller } from './poller';

let subscriptionController: SubscriptionController | undefined = undefined;

/**
 * Initializes the Poller and SubscriptionController.
 * @param relay - The relay instance.
 * @param logger - The logger instance.
 * @param register - The registry instance.
 */
export function initializeSubscriptionManager(relay: Relay, logger: Logger, register: Registry) {
  if (ConfigService.get('SUBSCRIPTIONS_ENABLED')) {
    const poller = new Poller(relay, logger.child({ name: 'poller' }), register);
    subscriptionController = new SubscriptionController(poller, logger.child({ name: 'subscr-ctrl' }), register);
  }
}

/**
 * @returns The SubscriptionController instance.
 */
export function getSubscriptionController(): SubscriptionController | undefined {
  return subscriptionController;
}
