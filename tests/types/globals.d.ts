// SPDX-License-Identifier: Apache-2.0

import type { Server } from 'node:http';

import type { Logger } from 'pino';

import type { Relay } from '../../src/relay';
import type MetricsClient from '../server/clients/metricsClient';
import type MirrorClient from '../server/clients/mirrorClient';
import type RelayClient from '../server/clients/relayClient';
import type ServicesClient from '../server/clients/servicesClient';
import type { AliasAccount } from '../server/types/AliasAccount';

declare global {
  var relayIsLocal: boolean;
  var servicesNode: ServicesClient;
  var mirrorNode: MirrorClient;
  var metrics: MetricsClient;
  var relay: RelayClient;
  var logger: Logger;
  var initialBalance: number;
  var restartLocalRelay: () => Promise<void>;
  var accounts: AliasAccount[];
  var relayServer: Server;
  var relayImpl: Relay;
  var socketServer: Server & { _connections: number };
}
