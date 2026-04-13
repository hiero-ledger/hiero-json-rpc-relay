// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import { GCProfiler } from 'node:v8';

import { AccountId, Hbar } from '@hashgraph/sdk';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import pino from 'pino';

import { ConfigService } from '../src/config-service/services';
import constants from '../src/relay/lib/constants';
import { setServerTimeout } from '../src/server/koaJsonRpc/lib/utils';
import { initializeServer } from '../src/server/server';
import { initializeWsServer } from '../src/ws-server/webSocketServer';
import MetricsClient from './server/clients/metricsClient';
import MirrorClient from './server/clients/mirrorClient';
import RelayClient from './server/clients/relayClient';
import ServicesClient from './server/clients/servicesClient';
import { Utils } from './server/helpers/utils';
import type { AliasAccount } from './server/types/AliasAccount';

chai.use(chaiAsPromised);

export interface AcceptanceSuiteOptions {
  /** Absolute path to the directory containing spec files to load. */
  testDir: string;
  /**
   * When to start the WebSocket server in local-relay mode:
   * - `'always'`  – start unconditionally (used by protocol tests)
   * - `'config'`  – start only when `TEST_WS_SERVER` env var is truthy (default)
   * - `'never'`   – never start the WS server
   */
  wsServer?: 'always' | 'config' | 'never';
}

/**
 * Registers the standard acceptance-test suite (globals setup, before/after
 * lifecycle, and recursive spec-file discovery) inside a Mocha describe block.
 *
 * Call this from an `index.spec.ts` entry point after `dotenv.config()`.
 */
export function registerAcceptanceSuite(options: AcceptanceSuiteOptions): void {
  const { testDir, wsServer = 'config' } = options;

  describe('RPC Server Acceptance Tests', function () {
    this.timeout(240 * 1000); // 240 seconds

    const testLogger = pino({
      name: 'hedera-json-rpc-relay',
      level: ConfigService.get('LOG_LEVEL'),
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: true,
        },
      },
    });
    const logger = testLogger.child({ name: 'rpc-acceptance-test' });

    const NETWORK = ConfigService.get('HEDERA_NETWORK');
    const OPERATOR_KEY = ConfigService.get('OPERATOR_KEY_MAIN');
    const OPERATOR_ID = ConfigService.get('OPERATOR_ID_MAIN');
    const MIRROR_NODE_URL = ConfigService.get('MIRROR_NODE_URL');
    const LOCAL_RELAY_URL = 'http://localhost:7546';
    const RELAY_URL = ConfigService.get('E2E_RELAY_HOST') || LOCAL_RELAY_URL;
    const CHAIN_ID = ConfigService.get('CHAIN_ID');
    const INITIAL_BALANCE = ConfigService.get('INITIAL_BALANCE');

    global.relayIsLocal = RELAY_URL === LOCAL_RELAY_URL;
    global.servicesNode = new ServicesClient(NETWORK, OPERATOR_ID, OPERATOR_KEY);
    global.mirrorNode = new MirrorClient(MIRROR_NODE_URL);
    global.metrics = new MetricsClient(RELAY_URL);
    global.relay = new RelayClient(RELAY_URL);
    global.logger = logger;
    global.initialBalance = INITIAL_BALANCE;

    global.restartLocalRelay = async function () {
      if (global.relayIsLocal) {
        stopRelay();
        await new Promise((r) => setTimeout(r, 5000)); // wait for server to shutdown

        await runLocalRelay();
      }
    };

    // leak detection middleware
    if (ConfigService.get('MEMWATCH_ENABLED')) {
      Utils.captureMemoryLeaks(new GCProfiler());
    }

    let startOperatorBalance: Hbar;

    before(async () => {
      logger.info('Acceptance Tests Configurations successfully loaded');
      logger.info(`LOCAL_NODE: ${ConfigService.get('LOCAL_NODE')}`);
      logger.info(`CHAIN_ID: ${ConfigService.get('CHAIN_ID')}`);
      logger.info(`HEDERA_NETWORK: ${NETWORK}`);
      logger.info(`OPERATOR_ID_MAIN: ${OPERATOR_ID}`);
      logger.info(`MIRROR_NODE_URL: ${MIRROR_NODE_URL}`);
      logger.info(`E2E_RELAY_HOST: ${ConfigService.get('E2E_RELAY_HOST')}`);

      if (global.relayIsLocal) {
        await runLocalRelay();
      }

      // cache start balance
      startOperatorBalance = await global.servicesNode.getOperatorBalance();
      const initialAccount: AliasAccount = await global.servicesNode.createInitialAliasAccount(
        RELAY_URL,
        CHAIN_ID,
        ConfigService.get('TEST_INITIAL_ACCOUNT_STARTING_BALANCE'),
      );

      global.accounts = new Array<AliasAccount>(initialAccount);
      await global.mirrorNode.get(`/accounts/${initialAccount.address}`);
    });

    after(async () => {
      const operatorAddress = `0x${AccountId.fromString(OPERATOR_ID).toSolidityAddress()}`;
      const accounts: AliasAccount[] = global.accounts;
      for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        try {
          const balance = await account.wallet.provider?.getBalance(account.address);
          const tx = {
            to: operatorAddress,
            value: balance,
          };
          const feeData = await account.wallet.provider?.getFeeData();
          const gasEstimation = await account.wallet.provider?.estimateGas(tx);

          // we multiply by 10 to add tolerance
          const cost = (gasEstimation ?? 0n) * (feeData?.gasPrice ?? 0n) * 10n;

          await account.wallet.sendTransaction({
            to: operatorAddress,
            gasLimit: gasEstimation,
            value: (balance ?? 0n) - cost,
          });
          logger.info(`Account ${account.address} refunded back to operator ${balance} th.`);
        } catch (error) {
          logger.error(`Account ${account.address} couldn't send the hbars back to the operator: ${error}`);
        }
      }

      const endOperatorBalance = await global.servicesNode.getOperatorBalance();
      const cost = startOperatorBalance.toTinybars().subtract(endOperatorBalance.toTinybars());
      logger.info(`Acceptance Tests spent ${Hbar.fromTinybars(cost)}`);

      stopRelay();
    });

    describe('Acceptance tests', async () => {
      fs.readdirSync(testDir).forEach((file) => {
        if (fs.statSync(path.resolve(testDir, file)).isDirectory()) {
          fs.readdirSync(path.resolve(testDir, file)).forEach((subFile) => {
            loadTest(`${file}/${subFile}`);
          });
        } else {
          loadTest(file);
        }
      });
    });

    function loadTest(testFile: string): void {
      if (testFile !== 'index.spec.ts' && testFile.endsWith('.spec.ts')) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require(path.resolve(testDir, testFile));
      }
    }

    function stopRelay(): void {
      //stop relay
      logger.info('Stop relay');

      const relayServer: Server = global.relayServer;
      if (relayServer !== undefined) {
        relayServer.close();
      }

      const shouldStopWs = wsServer === 'always' || (wsServer === 'config' && ConfigService.get('TEST_WS_SERVER'));
      if (shouldStopWs && global.socketServer !== undefined) {
        global.socketServer.close();
      }
    }

    async function runLocalRelay(): Promise<void> {
      // start local relay, relay instance in local should not be running

      logger.info(`Start relay on port ${constants.RELAY_PORT}`);
      logger.info(`Start relay on host ${constants.RELAY_HOST}`);
      const { app, relay } = await initializeServer();
      const relayServer = app.listen({ port: constants.RELAY_PORT });
      global.relayServer = relayServer;
      global.relayImpl = relay;
      setServerTimeout(relayServer);

      const shouldStartWs = wsServer === 'always' || (wsServer === 'config' && ConfigService.get('TEST_WS_SERVER'));
      if (shouldStartWs) {
        logger.info(`Start ws-server on port ${constants.WEB_SOCKET_PORT}`);
        const { app: wsApp } = await initializeWsServer();
        global.socketServer = wsApp.listen({ port: constants.WEB_SOCKET_PORT });
      }
    }
  });
}
