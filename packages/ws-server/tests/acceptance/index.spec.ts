// SPDX-License-Identifier: Apache-2.0

// Important! Load env variables before importing anything else
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

import { Server } from 'node:http';

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import constants from '@hashgraph/json-rpc-relay/dist/lib/constants';
import { setServerTimeout } from '@hashgraph/json-rpc-server/dist/koaJsonRpc/lib/utils';
import { initializeServer } from '@hashgraph/json-rpc-server/dist/server';
import MirrorClient from '@hashgraph/json-rpc-server/tests/clients/mirrorClient';
import RelayClient from '@hashgraph/json-rpc-server/tests/clients/relayClient';
import ServicesClient from '@hashgraph/json-rpc-server/tests/clients/servicesClient';
import { AliasAccount } from '@hashgraph/json-rpc-server/tests/types/AliasAccount';
import { initializeWsServer } from '@hashgraph/json-rpc-ws-server/dist/webSocketServer';
import { AccountId, Hbar } from '@hashgraph/sdk';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import fs from 'fs';
import pino from 'pino';

chai.use(chaiAsPromised);

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
  const RELAY_URL = ConfigService.get('E2E_RELAY_HOST');
  const CHAIN_ID = ConfigService.get('CHAIN_ID');

  global.relayIsLocal = RELAY_URL === LOCAL_RELAY_URL;
  global.servicesNode = new ServicesClient(NETWORK, OPERATOR_ID, OPERATOR_KEY);
  global.mirrorNode = new MirrorClient(MIRROR_NODE_URL);
  global.relay = new RelayClient(RELAY_URL);
  global.logger = logger;

  let startOperatorBalance: Hbar;

  before(async () => {
    // configuration details
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
    const initialAccount: AliasAccount = await global.servicesNode.createInitialAliasAccount(RELAY_URL, CHAIN_ID);

    global.accounts = new Array<AliasAccount>(initialAccount);
    await global.mirrorNode.get(`/accounts/${initialAccount.address}`);
  });

  after(async function () {
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
        // @ts-ignore
        const cost = BigInt(gasEstimation * feeData?.gasPrice) * BigInt(10);

        await account.wallet.sendTransaction({
          to: operatorAddress,
          gasLimit: gasEstimation,
          // @ts-ignore
          value: balance - cost,
        });
        logger.info(`Account ${account.address} refunded back to operator ${balance} th.`);
      } catch (error) {
        logger.error(`Account ${account.address} couldn't send the hbars back to the operator: ${error}`);
      }
    }

    const endOperatorBalance = await global.servicesNode.getOperatorBalance();
    const cost = startOperatorBalance.toTinybars().subtract(endOperatorBalance.toTinybars());
    logger.info(`Acceptance Tests spent ${Hbar.fromTinybars(cost)}`);

    //stop relay
    logger.info('Stop relay');
    const relayServer: Server = global.relayServer;
    if (relayServer !== undefined) {
      relayServer.close();
    }

    const socketServer: Server = global.socketServer;
    if (ConfigService.get('TEST_WS_SERVER') && socketServer !== undefined) {
      socketServer.close();
    }
  });

  describe('Acceptance tests', async () => {
    fs.readdirSync(path.resolve(__dirname, './')).forEach((file) => {
      if (fs.statSync(path.resolve(__dirname, file)).isDirectory()) {
        fs.readdirSync(path.resolve(__dirname, file)).forEach((subFile) => {
          loadTest(`${file}/${subFile}`);
        });
      } else {
        loadTest(file);
      }
    });
  });

  function loadTest(testFile) {
    if (testFile !== 'index.spec.ts' && testFile.endsWith('.spec.ts')) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(`./${testFile}`);
    }
  }

  async function runLocalRelay() {
    // start local relay, relay instance in local should not be running

    logger.info(`Start relay on port ${constants.RELAY_PORT}`);
    const { app } = await initializeServer();
    const relayServer = app.listen({ port: constants.RELAY_PORT });
    global.relayServer = relayServer;
    setServerTimeout(relayServer);

    if (ConfigService.get('TEST_WS_SERVER')) {
      logger.info(`Start ws-server on port ${constants.WEB_SOCKET_PORT}`);
      const { app: wsApp } = await initializeWsServer();
      global.socketServer = wsApp.listen({ port: constants.WEB_SOCKET_PORT });
    }
  }
});
