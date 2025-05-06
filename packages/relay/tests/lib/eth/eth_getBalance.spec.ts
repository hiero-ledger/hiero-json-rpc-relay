// SPDX-License-Identifier: Apache-2.0

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

import { numberTo0x } from '../../../dist/formatters';
import { SDKClient } from '../../../src/lib/clients';
import constants from '../../../src/lib/constants';
import { RequestDetails } from '../../../src/lib/types';
import { buildCryptoTransferTransaction, overrideEnvsInMochaDescribe } from '../../helpers';
import {
  BLOCK_TIMESTAMP,
  BLOCK_ZERO,
  BLOCKS_LIMIT_ORDER_URL,
  CONTRACT_ADDRESS_1,
  CONTRACT_ID_1,
  DEF_BALANCE,
  DEF_HEX_BALANCE,
  DEFAULT_BLOCK,
  DEFAULT_NETWORK_FEES,
  MOCK_BALANCE_RES,
  MOCK_BLOCK_NUMBER_1000_RES,
  MOCK_BLOCKS_FOR_BALANCE_RES,
  NOT_FOUND_RES,
  TINYBAR_TO_WEIBAR_COEF_BIGINT,
} from './eth-config';
import { balancesByAccountIdByTimestampURL, generateEthTestEnv } from './eth-helpers';

use(chaiAsPromised);

let sdkClientStub: sinon.SinonStubbedInstance<SDKClient>;
let getSdkClientStub: sinon.SinonStub;

describe('@ethGetBalance using MirrorNode', async function () {
  this.timeout(10000);
  const { restMock, hapiServiceInstance, ethImpl, cacheService } = generateEthTestEnv();

  const requestDetails = new RequestDetails({ requestId: 'eth_getBalanceTest', ipAddress: '0.0.0.0' });

  overrideEnvsInMochaDescribe({ ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE: 1 });

  this.beforeEach(async () => {
    // reset cache and restMock
    await cacheService.clear(requestDetails);
    restMock.reset();

    sdkClientStub = sinon.createStubInstance(SDKClient);
    getSdkClientStub = sinon.stub(hapiServiceInstance, 'getSDKClient').returns(sdkClientStub);
    restMock.onGet('network/fees').reply(200, JSON.stringify(DEFAULT_NETWORK_FEES));
  });

  this.afterEach(() => {
    getSdkClientStub.restore();
    restMock.resetHandlers();
  });

  it('should return balance from mirror node', async () => {
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOCK_BLOCK_NUMBER_1000_RES));
    restMock.onGet(`accounts/${CONTRACT_ADDRESS_1}?limit=100`).reply(200, JSON.stringify(MOCK_BALANCE_RES));

    const resBalance = await ethImpl.getBalance(CONTRACT_ADDRESS_1, null, requestDetails);
    expect(resBalance).to.equal(DEF_HEX_BALANCE);
  });

  it('should return balance for latest block from cache', async () => {
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOCK_BLOCK_NUMBER_1000_RES));
    restMock.onGet(`accounts/${CONTRACT_ADDRESS_1}?limit=100`).reply(200, JSON.stringify(MOCK_BALANCE_RES));

    const resBalance = await ethImpl.getBalance(CONTRACT_ADDRESS_1, null, requestDetails);
    expect(resBalance).to.equal(DEF_HEX_BALANCE);

    // next call should use cache
    restMock.onGet(`accounts/${CONTRACT_ADDRESS_1}?limit=100`).reply(404, {});

    const resBalanceCached = await ethImpl.getBalance(CONTRACT_ADDRESS_1, null, requestDetails);
    expect(resBalanceCached).to.equal(resBalance);

    // Third call should return new number using mirror node
    const newBalance = 55555;
    const newBalanceHex = numberTo0x(BigInt(newBalance) * TINYBAR_TO_WEIBAR_COEF_BIGINT);
    restMock.onGet(`accounts/${CONTRACT_ADDRESS_1}?limit=100`).reply(
      200,
      JSON.stringify({
        account: CONTRACT_ADDRESS_1,
        balance: {
          balance: newBalance,
        },
      }),
    );
    // expire cache, instead of waiting for ttl we clear it to simulate expiry faster.
    await cacheService.clear(requestDetails);

    const resBalanceNew = await ethImpl.getBalance(CONTRACT_ADDRESS_1, null, requestDetails);
    expect(newBalanceHex).to.equal(resBalanceNew);
  });

  it('should return balance from mirror node with block number passed as param the same as latest', async () => {
    const blockNumber = '0x2710';
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOCK_BLOCKS_FOR_BALANCE_RES));
    restMock.onGet(`accounts/${CONTRACT_ADDRESS_1}?limit=100`).reply(200, JSON.stringify(MOCK_BALANCE_RES));

    const resBalance = await ethImpl.getBalance(CONTRACT_ADDRESS_1, blockNumber, requestDetails);
    expect(resBalance).to.equal(DEF_HEX_BALANCE);
  });

  it('should return balance from mirror node with block hash passed as param the same as latest', async () => {
    const blockHash = '0x43da6a71f66d6d46d2b487c8231c04f01b3ba3bd91d165266d8eb39de3c0152b';
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOCK_BLOCKS_FOR_BALANCE_RES));
    restMock.onGet(`blocks/${blockHash}`).reply(
      200,
      JSON.stringify({
        number: 10000,
      }),
    );
    restMock.onGet(`accounts/${CONTRACT_ADDRESS_1}?limit=100`).reply(200, JSON.stringify(MOCK_BALANCE_RES));

    const resBalance = await ethImpl.getBalance(CONTRACT_ADDRESS_1, blockHash, requestDetails);
    expect(resBalance).to.equal(DEF_HEX_BALANCE);
  });

  it('should return balance from mirror node with block number passed as param, one behind latest', async () => {
    const blockNumber = '0x270F';
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOCK_BLOCKS_FOR_BALANCE_RES));
    restMock.onGet(`accounts/${CONTRACT_ADDRESS_1}?limit=100`).reply(200, JSON.stringify(MOCK_BALANCE_RES));

    const resBalance = await ethImpl.getBalance(CONTRACT_ADDRESS_1, blockNumber, requestDetails);
    expect(resBalance).to.equal(DEF_HEX_BALANCE);
  });

  it('should return balance from mirror node with block hash passed as param, one behind latest', async () => {
    const blockHash = '0x43da6a71f66d6d46d2b487c8231c04f01b3ba3bd91d165266d8eb39de3c0152b';
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOCK_BLOCKS_FOR_BALANCE_RES));
    restMock.onGet(`blocks/${blockHash}`).reply(
      200,
      JSON.stringify({
        number: 9998,
        timestamp: {
          from: '1651550386',
        },
      }),
    );

    restMock.onGet(balancesByAccountIdByTimestampURL(CONTRACT_ADDRESS_1, '1651550386')).reply(
      200,
      JSON.stringify({
        account: CONTRACT_ADDRESS_1,
        balances: [
          {
            balance: DEF_BALANCE,
          },
        ],
      }),
    );

    const resBalance = await ethImpl.getBalance(CONTRACT_ADDRESS_1, blockHash, requestDetails);
    expect(resBalance).to.equal(DEF_HEX_BALANCE);
  });

  it('should return balance from consensus node', async () => {
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOCK_BLOCK_NUMBER_1000_RES));
    restMock.onGet(`contracts/${CONTRACT_ADDRESS_1}`).reply(200, JSON.stringify(null));
    restMock.onGet(`accounts/${CONTRACT_ADDRESS_1}?limit=100`).reply(404, JSON.stringify(NOT_FOUND_RES));

    const resBalance = await ethImpl.getBalance(CONTRACT_ADDRESS_1, null, requestDetails);
    expect(resBalance).to.equal(constants.ZERO_HEX);
  });

  it('should return cached value for mirror nodes', async () => {
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOCK_BLOCK_NUMBER_1000_RES));
    restMock.onGet(`accounts/${CONTRACT_ADDRESS_1}?limit=100`).reply(200, JSON.stringify(MOCK_BALANCE_RES));

    const resNoCache = await ethImpl.getBalance(CONTRACT_ADDRESS_1, null, requestDetails);

    restMock.onGet(`accounts/${CONTRACT_ADDRESS_1}?limit=100`).reply(404, NOT_FOUND_RES);

    const resCached = await ethImpl.getBalance(CONTRACT_ADDRESS_1, null, requestDetails);
    expect(resNoCache).to.equal(DEF_HEX_BALANCE);
    expect(resCached).to.equal(DEF_HEX_BALANCE);
  });

  it('should return cached value for mirror nodes that is not latest so will need to query mirror node', async () => {
    const blockNumber = '0x1';
    restMock.onGet('blocks/1').reply(200, JSON.stringify(DEFAULT_BLOCK));

    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(
      200,
      JSON.stringify({
        blocks: [
          {
            number: 3,
            timestamp: {
              from: `${BLOCK_TIMESTAMP}.060890919`,
              to: '1651560389.060890949',
            },
          },
        ],
      }),
    );

    restMock.onGet(`accounts/${CONTRACT_ADDRESS_1}?limit=100`).reply(
      200,
      JSON.stringify({
        account: CONTRACT_ADDRESS_1,
        balance: {
          balance: DEF_BALANCE,
        },
        transactions: [
          buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 100, { timestamp: `${BLOCK_TIMESTAMP}.002391010` }),
          buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 50, { timestamp: `${BLOCK_TIMESTAMP}.002392003` }),
          buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 25, { timestamp: `${BLOCK_TIMESTAMP}.980350003` }),
        ],
        links: {
          next: null,
        },
      }),
    );

    const resNoCache = await ethImpl.getBalance(CONTRACT_ADDRESS_1, blockNumber, requestDetails);

    restMock.onGet(`accounts/${CONTRACT_ADDRESS_1}?limit=100`).reply(404, JSON.stringify(NOT_FOUND_RES));

    const resCached = await ethImpl.getBalance(CONTRACT_ADDRESS_1, blockNumber, requestDetails);
    expect(resNoCache).to.equal(DEF_HEX_BALANCE);
    expect(resCached).to.equal(DEF_HEX_BALANCE);
  });

  describe('with blockNumberOrTag filter', async function () {
    const balance1 = 99960581131;
    const balance2 = 99960581132;
    const balance3 = 99960581133;
    const timestamp1 = 1651550386;
    const timestamp2 = 1651560286;
    const timestamp3 = 1651560386;
    const timestamp4 = 1651561386;

    const hexBalance1 = numberTo0x(BigInt(balance1) * TINYBAR_TO_WEIBAR_COEF_BIGINT);
    const hexBalance3 = numberTo0x(BigInt(balance3) * TINYBAR_TO_WEIBAR_COEF_BIGINT);

    const latestBlock = {
      ...DEFAULT_BLOCK,
      number: 4,
      timestamp: {
        from: `${timestamp3}.060890949`,
        to: `${timestamp4}.060890949`,
      },
    };

    const recentBlock = {
      ...DEFAULT_BLOCK,
      number: 2,
      timestamp: {
        from: `${timestamp2}.060890949`,
        to: `${timestamp3}.060890949`,
      },
    };

    const earlierBlock = {
      ...DEFAULT_BLOCK,
      number: 1,
      timestamp: {
        from: `${timestamp1}.060890949`,
        to: `${timestamp2}.060890949`,
      },
    };

    beforeEach(async () => {
      restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify({ blocks: [latestBlock] }));
      restMock.onGet(`blocks/3`).reply(200, JSON.stringify(DEFAULT_BLOCK));
      restMock.onGet(`blocks/0`).reply(200, JSON.stringify(BLOCK_ZERO));
      restMock.onGet(`blocks/2`).reply(200, JSON.stringify(recentBlock));
      restMock.onGet(`blocks/1`).reply(200, JSON.stringify(earlierBlock));

      restMock.onGet(`accounts/${CONTRACT_ID_1}?limit=100`).reply(
        200,
        JSON.stringify({
          account: CONTRACT_ID_1,
          balance: {
            balance: balance3,
            timestamp: `${timestamp4}.060890949`,
          },
          transactions: [],
        }),
      );

      restMock.onGet(balancesByAccountIdByTimestampURL(CONTRACT_ID_1, earlierBlock.timestamp.from)).reply(
        200,
        JSON.stringify({
          timestamp: `${timestamp1}.060890949`,
          balances: [
            {
              account: CONTRACT_ID_1,
              balance: balance1,
              tokens: [],
            },
          ],
          links: {
            next: null,
          },
        }),
      );

      restMock.onGet(balancesByAccountIdByTimestampURL(CONTRACT_ID_1, recentBlock.timestamp.from)).reply(
        200,
        JSON.stringify({
          timestamp: `${timestamp2}.060890949`,
          balances: [
            {
              account: CONTRACT_ID_1,
              balance: balance2,
              tokens: [],
            },
          ],
          links: {
            next: null,
          },
        }),
      );

      restMock.onGet(balancesByAccountIdByTimestampURL(CONTRACT_ID_1)).reply(
        200,
        JSON.stringify({
          timestamp: `${timestamp4}.060890949`,
          balances: [
            {
              account: CONTRACT_ID_1,
              balance: balance3,
              tokens: [],
            },
          ],
          links: {
            next: null,
          },
        }),
      );

      restMock.onGet(balancesByAccountIdByTimestampURL(CONTRACT_ID_1, BLOCK_ZERO.timestamp.from)).reply(
        200,
        JSON.stringify({
          timestamp: null,
          balances: [],
          links: {
            next: null,
          },
        }),
      );
    });

    it('latest', async () => {
      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, 'latest', requestDetails);
      expect(resBalance).to.equal(hexBalance3);
    });

    it('finalized', async () => {
      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, 'finalized', requestDetails);
      expect(resBalance).to.equal(hexBalance3);
    });

    it('safe', async () => {
      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, 'safe', requestDetails);
      expect(resBalance).to.equal(hexBalance3);
    });

    it('earliest', async () => {
      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, 'earliest', requestDetails);
      expect(resBalance).to.equal('0x0');
    });

    it('pending', async () => {
      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, 'pending', requestDetails);
      expect(resBalance).to.equal(hexBalance3);
    });

    it('blockNumber is in the latest 15 minutes and the block.timstamp.to is later than the consensus transactions timestamps', async () => {
      const fromTimestamp = '1651560934';
      const toTimestamp = '1651560935';
      const recentBlockWithinLastfifteen = {
        ...DEFAULT_BLOCK,
        number: 2,
        timestamp: {
          from: `${fromTimestamp}.002391003`,
          to: `${toTimestamp}.980351003`,
        },
      };

      restMock.onGet(`blocks/2`).reply(200, JSON.stringify(recentBlockWithinLastfifteen));

      restMock.onGet(`accounts/${CONTRACT_ID_1}?limit=100`).reply(
        200,
        JSON.stringify({
          account: CONTRACT_ID_1,
          balance: {
            balance: balance3,
            timestamp: `${BLOCK_TIMESTAMP}.060890960`,
          },
          transactions: [
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 100, { timestamp: `${fromTimestamp}.002391010` }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 50, { timestamp: `${fromTimestamp}.002392003` }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 25, { timestamp: `${fromTimestamp}.980350003` }),
          ],
          links: {
            next: null,
          },
        }),
      );

      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, '2', requestDetails);
      const historicalBalance = numberTo0x(BigInt(balance3) * TINYBAR_TO_WEIBAR_COEF_BIGINT);
      expect(resBalance).to.equal(historicalBalance);
    });

    it('blockNumber is not in the latest 15 minutes', async () => {
      restMock.onGet(`accounts/${CONTRACT_ID_1}?limit=100`).reply(
        200,
        JSON.stringify({
          account: CONTRACT_ID_1,
          balance: {
            balance: balance3,
            timestamp: `${timestamp4}.060890949`,
          },
          transactions: [],
        }),
      );

      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, '1', requestDetails);
      expect(resBalance).to.equal(hexBalance1);
    });

    it('blockNumber is in the latest 15 minutes and there have been several debit transactions with consensus.timestamps greater the block.timestamp.to', async () => {
      const blockTimestamp = '1651560900';
      const recentBlockWithinLastfifteen = {
        ...DEFAULT_BLOCK,
        number: 2,
        timestamp: {
          from: '1651560899.060890921',
          to: `${blockTimestamp}.060890941`,
        },
      };
      restMock.onGet(`blocks/2`).reply(200, JSON.stringify(recentBlockWithinLastfifteen));
      restMock.onGet(`accounts/${CONTRACT_ID_1}?limit=100`).reply(
        200,
        JSON.stringify({
          account: CONTRACT_ID_1,
          balance: {
            balance: balance3,
            timestamp: `${blockTimestamp}.060890960`,
          },
          transactions: [
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 100, { timestamp: `${blockTimestamp}.060890954` }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 50, { timestamp: `${blockTimestamp}.060890953` }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 25, { timestamp: `${blockTimestamp}.060890952` }),
          ],
          links: {
            next: null,
          },
        }),
      );

      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, '2', requestDetails);
      const historicalBalance = numberTo0x(BigInt(balance3 - 175) * TINYBAR_TO_WEIBAR_COEF_BIGINT);
      expect(resBalance).to.equal(historicalBalance);
    });

    it('blockNumber is in the latest 15 minutes and there have been several credit transactions with consensus.timestamps greater the block.timestamp.to', async () => {
      const recentBlockWithinLastfifteen = {
        ...DEFAULT_BLOCK,
        number: 2,
        timestamp: {
          from: '1651560899.060890921',
          to: '1651560900.060890941',
        },
      };

      restMock.onGet(`blocks/2`).reply(200, JSON.stringify(recentBlockWithinLastfifteen));
      restMock.onGet(`accounts/${CONTRACT_ID_1}?limit=100`).reply(
        200,
        JSON.stringify({
          account: CONTRACT_ID_1,
          balance: {
            balance: balance3,
            timestamp: `${timestamp4}.060890960`,
          },
          transactions: [
            buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 100, { timestamp: '1651561386.060890954' }),
            buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 50, { timestamp: '1651561386.060890953' }),
            buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 25, { timestamp: '1651561386.060890952' }),
          ],
          links: {
            next: null,
          },
        }),
      );

      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, '2', requestDetails);
      const historicalBalance = numberTo0x(BigInt(balance3 + 175) * TINYBAR_TO_WEIBAR_COEF_BIGINT);
      expect(resBalance).to.equal(historicalBalance);
    });

    it('blockNumber is in the latest 15 minutes and there have been mixed credit and debit transactions with consensus.timestamps greater the block.timestamp.to', async () => {
      const recentBlockWithinLastfifteen = {
        ...DEFAULT_BLOCK,
        number: 2,
        timestamp: {
          from: '1651560899.060890921',
          to: '1651560900.060890941',
        },
      };

      restMock.onGet(`blocks/2`).reply(200, JSON.stringify(recentBlockWithinLastfifteen));
      restMock.onGet(`accounts/${CONTRACT_ID_1}?limit=100`).reply(
        200,
        JSON.stringify({
          account: CONTRACT_ID_1,
          balance: {
            balance: balance3,
            timestamp: `${timestamp4}.060890960`,
          },
          transactions: [
            buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 100, { timestamp: '1651561386.060890954' }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 50, { timestamp: '1651561386.060890953' }),
            buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 25, { timestamp: '1651561386.060890952' }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 10, { timestamp: '1651561386.060890951' }),
          ],
          links: {
            next: null,
          },
        }),
      );

      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, '2', requestDetails);
      const historicalBalance = numberTo0x(BigInt(balance3 + 65) * TINYBAR_TO_WEIBAR_COEF_BIGINT);
      expect(resBalance).to.equal(historicalBalance);
    });

    it('blockNumber is in the latest 15 minutes and there have been mixed credit and debit transactions and a next pagination with a timestamp less than the block.timestamp.to', async () => {
      const recentBlockWithinLastfifteen = {
        ...DEFAULT_BLOCK,
        number: 1,
        timestamp: {
          from: '1651550584.060890921',
          to: '1651550585.060890941',
        },
      };
      restMock.onGet(`blocks/1`).reply(200, JSON.stringify(recentBlockWithinLastfifteen));
      restMock.onGet(`accounts/${CONTRACT_ID_1}?limit=100`).reply(
        200,
        JSON.stringify({
          account: CONTRACT_ID_1,
          balance: {
            balance: balance3,
            timestamp: '1651550587.060890941',
          },
          transactions: [
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 100, { timestamp: '1651550587.060890964' }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 55, { timestamp: '1651550587.060890958' }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 50, { timestamp: '1651550587.060890953' }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 25, { timestamp: '1651550587.060890952' }),
          ],
          links: {
            next: `/api/v1/accounts/${CONTRACT_ID_1}?limit=100&timestamp=lt:1651550575.060890941`,
          },
        }),
      );

      restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(
        200,
        JSON.stringify({
          blocks: [
            {
              ...DEFAULT_BLOCK,
              number: 4,
              timestamp: {
                from: '1651550595.060890941',
                to: '1651550597.060890941',
              },
            },
          ],
        }),
      );

      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, '1', requestDetails);
      const historicalBalance = numberTo0x(BigInt(balance3 - 230) * TINYBAR_TO_WEIBAR_COEF_BIGINT);
      expect(resBalance).to.equal(historicalBalance);
    });

    it('blockNumber is in the latest 15 minutes with debit transactions and a next pagination with a timestamp greater than the block.timestamp.to', async () => {
      const recentBlockWithinLastfifteen = {
        ...DEFAULT_BLOCK,
        number: 1,
        timestamp: {
          from: '1651550564.060890921',
          to: '1651550565.060890941',
        },
      };

      restMock.onGet(`blocks/1`).reply(200, JSON.stringify(recentBlockWithinLastfifteen));
      restMock.onGet(`accounts/${CONTRACT_ID_1}?limit=100`).reply(
        200,
        JSON.stringify({
          account: CONTRACT_ID_1,
          balance: {
            balance: balance3,
            timestamp: '1651550587.060890941',
          },
          transactions: [
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 100, { timestamp: '1651550587.060890964' }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 55, { timestamp: '1651550587.060890958' }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 50, { timestamp: '1651550587.060890953' }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 25, { timestamp: '1651550587.060890952' }),
          ],
          links: {
            next: `/api/v1/accounts/${CONTRACT_ID_1}?limit=100&timestamp=lt:1651550575.060890941`,
          },
        }),
      );

      restMock.onGet(`accounts/${CONTRACT_ID_1}?limit=100&timestamp=lt:1651550575.060890941`).reply(
        200,
        JSON.stringify({
          account: CONTRACT_ID_1,
          balance: {
            balance: balance3,
            timestamp: '1651550587.060890941',
          },
          transactions: [
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 200, { timestamp: '1651550574.060890964' }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 50, { timestamp: '1651550573.060890958' }),
          ],
          links: {
            next: null,
          },
        }),
      );

      const latestBlock = {
        ...DEFAULT_BLOCK,
        number: 4,
        timestamp: {
          from: '1651550595.060890941',
          to: '1651550597.060890941',
        },
      };

      restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(
        200,
        JSON.stringify({
          blocks: [latestBlock],
        }),
      );

      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, '1', requestDetails);
      const historicalBalance = numberTo0x(BigInt(balance3 - 480) * TINYBAR_TO_WEIBAR_COEF_BIGINT);
      expect(resBalance).to.equal(historicalBalance);
    });

    it('blockNumber is in the latest 15 minutes with credit and debit transactions and a next pagination with a timestamp greater than the block.timestamp.to', async () => {
      const recentBlockWithinLastfifteen = {
        ...DEFAULT_BLOCK,
        number: 1,
        timestamp: {
          from: '1651550564.060890921',
          to: '1651550565.060890941',
        },
      };
      restMock.onGet(`blocks/1`).reply(200, JSON.stringify(recentBlockWithinLastfifteen));
      restMock.onGet(`accounts/${CONTRACT_ID_1}?limit=100`).reply(
        200,
        JSON.stringify({
          account: CONTRACT_ID_1,
          balance: {
            balance: balance3,
            timestamp: '1651550587.060890941',
          },
          transactions: [
            buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 100, { timestamp: '1651550587.060890964' }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 55, { timestamp: '1651550587.060890958' }),
            buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 50, { timestamp: '1651550587.060890953' }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 25, { timestamp: '1651550587.060890952' }),
          ],
          links: {
            next: `/api/v1/accounts/${CONTRACT_ID_1}?limit=100&timestamp=lt:1651550575.060890941`,
          },
        }),
      );

      restMock.onGet(`accounts/${CONTRACT_ID_1}?limit=100&timestamp=lt:1651550575.060890941`).reply(
        200,
        JSON.stringify({
          account: CONTRACT_ID_1,
          balance: {
            balance: balance3,
            timestamp: '1651550587.060890941',
          },
          transactions: [
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 200, { timestamp: '1651550574.060890964' }),
            buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 50, { timestamp: '1651550573.060890958' }),
          ],
          links: {
            next: null,
          },
        }),
      );

      const latestBlock = {
        ...DEFAULT_BLOCK,
        number: 4,
        timestamp: {
          from: '1651550595.060890941',
          to: '1651550597.060890941',
        },
      };

      restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(
        200,
        JSON.stringify({
          blocks: [latestBlock],
        }),
      );

      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, '1', requestDetails);
      const historicalBalance = numberTo0x(BigInt(balance3 - 80) * TINYBAR_TO_WEIBAR_COEF_BIGINT);
      expect(resBalance).to.equal(historicalBalance);
    });

    it('blockNumber is the same as the latest block', async () => {
      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, '3', requestDetails);
      expect(resBalance).to.equal(hexBalance3);
    });

    it('blockNumber is not in the latest 15 minutes, mirror node balance for address not found 404 status', async () => {
      // random evm address
      const notFoundEvmAddress = '0x1234567890123456789012345678901234567890';
      restMock
        .onGet(balancesByAccountIdByTimestampURL(notFoundEvmAddress, '1651550386.060890949'))
        .reply(404, JSON.stringify(NOT_FOUND_RES));

      const resBalance = await ethImpl.getBalance(notFoundEvmAddress, '1', requestDetails);
      expect(resBalance).to.equal(constants.ZERO_HEX);
    });

    it('blockNumber is in the latest 15 minutes, mirror node balance for address not found 404 status', async () => {
      // random evm address
      const notFoundEvmAddress = '0x1234567890123456789012345678901234567890';
      const blockTimestamp = '1651560900';
      const recentBlockWithinLastfifteen = {
        ...DEFAULT_BLOCK,
        number: 2,
        timestamp: {
          from: '1651560899.060890921',
          to: `${blockTimestamp}.060890941`,
        },
      };
      restMock.onGet(`blocks/2`).reply(200, JSON.stringify(recentBlockWithinLastfifteen));
      restMock.onGet(`accounts/${notFoundEvmAddress}?limit=100`).reply(404, JSON.stringify(NOT_FOUND_RES));

      const resBalance = await ethImpl.getBalance(notFoundEvmAddress, '2', requestDetails);
      expect(resBalance).to.equal(constants.ZERO_HEX);
    });
  });

  describe('Calculate balance at block timestamp via getBalanceAtBlockTimestamp', async function () {
    const timestamp1 = 1651550386;

    it('Given a blockNumber, return the account balance at that blocknumber, with transactions that debit the account balance', async () => {
      const transactionsInBlockTimestamp: any[] = [
        buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 100, { timestamp: `${timestamp1}.060890955` }),
        buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 50, { timestamp: `${timestamp1}.060890954` }),
      ];

      const resultingUpdate = ethImpl['accountService']['getBalanceAtBlockTimestamp'](
        CONTRACT_ID_1,
        transactionsInBlockTimestamp,
        Number(`${timestamp1}.060890950`),
      );
      // Transactions up to the block timestamp.to timestamp will be subsctracted from the current balance to get the block's balance.
      expect(resultingUpdate).to.equal(+150);
    });

    it('Given a blockNumber, return the account balance at that blocknumber, with transactions that credit the account balance', async () => {
      const transactionsInBlockTimestamp: any[] = [
        buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 100, { timestamp: `${timestamp1}.060890955` }),
        buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 50, { timestamp: `${timestamp1}.060890954` }),
      ];

      const resultingUpdate = ethImpl['accountService']['getBalanceAtBlockTimestamp'](
        CONTRACT_ID_1,
        transactionsInBlockTimestamp,
        Number(`${timestamp1}.060890950`),
      );
      // Transactions up to the block timestamp.to timestamp will be subsctracted from the current balance to get the block's balance.
      expect(resultingUpdate).to.equal(-150);
    });

    it('Given a blockNumber, return the account balance at that blocknumber, with transactions that debit and credit the account balance', async () => {
      const transactionsInBlockTimestamp: any[] = [
        buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 100, { timestamp: `${timestamp1}.060890955` }),
        buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 50, { timestamp: `${timestamp1}.060890954` }),
      ];

      const resultingUpdate = ethImpl['accountService']['getBalanceAtBlockTimestamp'](
        CONTRACT_ID_1,
        transactionsInBlockTimestamp,
        Number(`${timestamp1}.060890950`),
      );
      // Transactions up to the block timestamp.to timestamp will be subsctracted from the current balance to get the block's balance.
      expect(resultingUpdate).to.equal(+50);
    });

    it('Given a blockNumber, return the account balance at that blocknumber, with transactions that debit, credit, and debit the account balance', async () => {
      const transactionsInBlockTimestamp: any[] = [
        buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 100, { timestamp: `${timestamp1}.060890955` }),
        buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 50, { timestamp: `${timestamp1}.060890954` }),
        buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 20, { timestamp: `${timestamp1}.060890955` }),
      ];

      const resultingUpdate = ethImpl['accountService']['getBalanceAtBlockTimestamp'](
        CONTRACT_ID_1,
        transactionsInBlockTimestamp,
        Number(`${timestamp1}.060890950`),
      );
      // Transactions up to the block timestamp.to timestamp will be subsctracted from the current balance to get the block's balance.
      expect(resultingUpdate).to.equal(+70);
    });
  });
});
