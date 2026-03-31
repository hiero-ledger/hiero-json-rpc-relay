// SPDX-License-Identifier: Apache-2.0

import { prepend0x } from '@hashgraph/json-rpc-relay/dist/formatters';
import { withOverriddenEnvsInMochaTest } from '@hashgraph/json-rpc-relay/tests/helpers';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import MirrorClient from '../clients/mirrorClient';
import RelayClient from '../clients/relayClient';
import ServicesClient from '../clients/servicesClient';
import RelayCalls from '../helpers/constants';
import { Utils } from '../helpers/utils';
import { LargeBlocksFixture } from './fixtures/largeBlocksFixture';

use(chaiAsPromised);

describe('@mirror-node-pagination-limits pagination and range limits', function () {
  this.timeout(240 * 1_000 * 10); // 240 seconds

  const expectedTotal = 75_000;

  // @ts-ignore
  const {
    servicesNode,
    mirrorNode,
    relay,
  }: { relay: RelayClient; mirrorNode: MirrorClient; servicesNode: ServicesClient } = global;

  let initialBlockNumber: string;
  let latestBlockNumber: string;

  const getMostFrequentBlockInRecentPages = async (numberOfPagesToCheck: number) => {
    const { logs, links } = await mirrorNode.get('/contracts/results/logs');
    let { next } = links;
    while (next && numberOfPagesToCheck > 0) {
      numberOfPagesToCheck--;
      const nextPage = await mirrorNode.get(links.next.replace('/api/v1', ''));
      if (nextPage.logs) logs.push(...nextPage.logs);
      next = nextPage.links.next;
    }

    return Object.entries(
      logs.reduce((occurencesOfBlock, { block_number }) => {
        occurencesOfBlock[block_number] = (occurencesOfBlock[block_number] || 0) + 1;
        return occurencesOfBlock;
      }, {}),
    ).sort(
      (blockACount: [string, unknown], blockBCount: [string, unknown]) =>
        (blockBCount[1] as number) - (blockACount[1] as number),
    )[0]?.[0];
  };

  this.beforeAll(async () => {
    initialBlockNumber = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_BLOCK_NUMBER, []);

    const fixture = new LargeBlocksFixture(servicesNode.client);
    await fixture.createLargeBlockWithCryptoTransfer(expectedTotal);

    // Waiting for the mirror node to process the blocks.
    await new Promise((r) => setTimeout(r, 15_000));

    latestBlockNumber = prepend0x(Number(await getMostFrequentBlockInRecentPages(5)).toString(16));
  });

  const envCombos: Array<{ name: string; env: Map<string, number>; expectedError?: string }> = [
    {
      name: 'L=100, P_range=40 => MaxRecords = 4_000 (<75_000)',
      env: new Map(
        Object.entries({
          MIRROR_NODE_LIMIT_PARAM: 100,
          MIRROR_NODE_CONTRACT_RESULTS_LOGS_BLOCK_RANGE_PG_MAX: 100,
          MIRROR_NODE_CONTRACT_RESULTS_LOGS_PG_MAX: 40,
        }),
      ),
      expectedError: 'Exceeded maximum mirror node pagination count: 40',
    },
    {
      name: 'L=100, P_range=1_000 => MaxRecords = 100_000 (>=75_000)',
      env: new Map(
        Object.entries({
          MIRROR_NODE_LIMIT_PARAM: 100,
          MIRROR_NODE_CONTRACT_RESULTS_LOGS_BLOCK_RANGE_PG_MAX: 100,
          MIRROR_NODE_CONTRACT_RESULTS_LOGS_PG_MAX: 1000,
        }),
      ),
    },
    {
      name: 'L=10, P_range=2000 => MaxRecords = 2_000 (<75_000)',
      env: new Map(
        Object.entries({
          MIRROR_NODE_LIMIT_PARAM: 10,
          MIRROR_NODE_CONTRACT_RESULTS_LOGS_BLOCK_RANGE_PG_MAX: 1,
          MIRROR_NODE_CONTRACT_RESULTS_LOGS_PG_MAX: 2000,
        }),
      ),
      expectedError: 'Exceeded maximum mirror node pagination count: 2000',
    },
    {
      name: 'L=50, P_range=1510 => MaxRecords >=75_000',
      env: new Map(
        Object.entries({
          MIRROR_NODE_LIMIT_PARAM: 50,
          MIRROR_NODE_CONTRACT_RESULTS_LOGS_BLOCK_RANGE_PG_MAX: 1,
          MIRROR_NODE_CONTRACT_RESULTS_LOGS_PG_MAX: 1510,
        }),
      ),
    },
  ];

  envCombos.forEach(({ name, env, expectedError }) => {
    withOverriddenEnvsInMochaTest(
      { ...Object.fromEntries(env), RATE_LIMIT_DISABLED: true, WORKERS_POOL_ENABLED: false },
      () => {
        before(Utils.reloadLimitConfigs);
        it(`eth_getLogs over a block range honors constant MaxRecords when ${name}`, async function () {
          const promise = relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS, [
            {
              fromBlock: initialBlockNumber,
              toBlock: latestBlockNumber,
            },
          ]);
          if (expectedError) {
            await expect(promise).to.eventually.be.rejectedWith(expectedError);
          } else {
            expect(expectedTotal).to.not.be.undefined;

            // We should be able to retrieve all logs within this time frame. However, during the test run
            // additional transactions (and logs) may occur (e.g., health checks), so we assert that the
            // value is greater than or equal (>=), not exactly equal.
            await expect(promise)
              .to.eventually.be.instanceOf(Array)
              .and.have.length.gte(expectedTotal!)
              .and.lte(expectedTotal! + 2);
          }
        });
      },
    );
  });

  // Additional tests for eth_getBlock with transactions=true honoring pagination limits
  const envCombosBlocks: Array<{ name: string; env: Map<string, number> }> = [
    {
      name: 'L=1, P=1 => allows only 1 transaction on first page',
      env: new Map(
        Object.entries({
          MIRROR_NODE_LIMIT_PARAM: 1,
          MIRROR_NODE_CONTRACT_RESULTS_PG_MAX: 1,
        }),
      ),
    },
    {
      name: 'L=100, P=1000 => generous cap',
      env: new Map(
        Object.entries({
          MIRROR_NODE_LIMIT_PARAM: 100,
          MIRROR_NODE_CONTRACT_RESULTS_PG_MAX: 1000,
        }),
      ),
    },
  ];

  envCombosBlocks.forEach(({ name, env }) => {
    withOverriddenEnvsInMochaTest(
      { ...Object.fromEntries(env), RATE_LIMIT_DISABLED: true, WORKERS_POOL_ENABLED: false },
      () => {
        before(Utils.reloadLimitConfigs);
        it(`eth_getBlock (transactions=true) should return full data for block when ${name}`, async function () {
          const txCountHex = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_TRANSACTION_COUNT_BY_NUMBER, [
            initialBlockNumber,
          ]);
          const L = env.get('MIRROR_NODE_LIMIT_PARAM') as number;
          const pageMax = env.get('MIRROR_NODE_CONTRACT_RESULTS_PG_MAX') as number;
          const txCount = parseInt(txCountHex);
          const pagesRequired = Math.ceil((txCount || 0) / L);

          const promise = relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER, [initialBlockNumber, true]);

          if (pagesRequired > pageMax) {
            await expect(promise).to.eventually.be.rejectedWith(
              `Exceeded maximum mirror node pagination count: ${pageMax}`,
            );
          } else {
            const block = await promise;
            expect(block).to.be.an('object');
            expect(block).to.have.property('transactions');
            expect(block.transactions).to.be.an('array').and.not.empty;
          }
        });
      },
    );
  });

  // Additional tests for eth_getBlockReceipts honoring pagination limits
  const envCombosReceipts: Array<{ name: string; env: Map<string, number> }> = [
    {
      name: 'L=1, P=1 => allows only 1 receipt on first page',
      env: new Map(
        Object.entries({
          MIRROR_NODE_LIMIT_PARAM: 1,
          MIRROR_NODE_CONTRACT_RESULTS_PG_MAX: 1,
        }),
      ),
    },
    {
      name: 'L=100, P=1000 => generous cap',
      env: new Map(
        Object.entries({
          MIRROR_NODE_LIMIT_PARAM: 100,
          MIRROR_NODE_CONTRACT_RESULTS_PG_MAX: 1000,
        }),
      ),
    },
  ];

  envCombosReceipts.forEach(({ name, env }) => {
    withOverriddenEnvsInMochaTest(
      { ...Object.fromEntries(env), RATE_LIMIT_DISABLED: true, WORKERS_POOL_ENABLED: false },
      () => {
        before(Utils.reloadLimitConfigs);
        it(`eth_getBlockReceipts honors constant MaxRecords when ${name}`, async function () {
          const txCountHex = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_TRANSACTION_COUNT_BY_NUMBER, [
            latestBlockNumber,
          ]);
          const L = env.get('MIRROR_NODE_LIMIT_PARAM') as number;
          const pageMax = env.get('MIRROR_NODE_CONTRACT_RESULTS_PG_MAX') as number;
          const txCount = parseInt(txCountHex);
          const pagesRequired = Math.ceil((parseInt(txCountHex) || 0) / L);

          const promise = relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BLOCK_RECEIPTS, [latestBlockNumber]);

          if (pagesRequired > pageMax) {
            await expect(promise).to.eventually.be.rejectedWith(
              `Exceeded maximum mirror node pagination count: ${pageMax}`,
            );
          } else {
            const receipts = await promise;
            expect(receipts).to.be.an('array').and.not.empty;
            expect(receipts.length).to.be.lessThanOrEqual(txCount);
          }
        });
      },
    );
  });
});
