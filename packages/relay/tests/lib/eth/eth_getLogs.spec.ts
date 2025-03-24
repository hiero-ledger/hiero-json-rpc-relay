// SPDX-License-Identifier: Apache-2.0

import MockAdapter from 'axios-mock-adapter';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ethers } from 'ethers';
import sinon from 'sinon';

import { Eth, predefined } from '../../../src';
import { SDKClient } from '../../../src/lib/clients';
import { CacheService } from '../../../src/lib/services/cacheService/cacheService';
import HAPIService from '../../../src/lib/services/hapiService/hapiService';
import { RequestDetails } from '../../../src/lib/types';
import {
  defaultDetailedContractResults,
  defaultDetailedContractResults2,
  defaultDetailedContractResults3,
  defaultEvmAddress,
  ethGetLogsFailing,
  expectLogData,
  expectLogData1,
  expectLogData2,
  expectLogData3,
  expectLogData4,
  overrideEnvsInMochaDescribe,
  withOverriddenEnvsInMochaTest,
} from '../../helpers';
import {
  BLOCK_HASH,
  BLOCK_NUMBER_2,
  BLOCK_NUMBER_3,
  BLOCKS_LIMIT_ORDER_URL,
  CONTRACT_ADDRESS_1,
  CONTRACT_ADDRESS_2,
  CONTRACT_RESULTS_LOGS_WITH_FILTER_URL,
  CONTRACTS_LOGS_WITH_FILTER,
  DEFAULT_BLOCK,
  DEFAULT_BLOCKS_RES,
  DEFAULT_CONTRACT,
  DEFAULT_CONTRACT_2,
  DEFAULT_LOG_TOPICS,
  DEFAULT_LOG_TOPICS_1,
  DEFAULT_LOGS,
  DEFAULT_LOGS_3,
  DEFAULT_LOGS_4,
  DEFAULT_NETWORK_FEES,
  DEFAULT_NULL_LOG_TOPICS,
  NOT_FOUND_RES,
} from './eth-config';
import { generateEthTestEnv } from './eth-helpers';

use(chaiAsPromised);

let sdkClientStub: sinon.SinonStubbedInstance<SDKClient>;
let getSdkClientStub: sinon.SinonStub;

describe('@ethGetLogs using MirrorNode', async function () {
  this.timeout(100000);
  const latestBlock = {
    ...DEFAULT_BLOCK,
    number: 17,
    timestamp: {
      from: `1651560393.060890949`,
      to: '1651560395.060890949',
    },
  };
  const {
    restMock,
    hapiServiceInstance,
    ethImpl,
    cacheService,
  }: { restMock: MockAdapter; hapiServiceInstance: HAPIService; ethImpl: Eth; cacheService: CacheService } =
    generateEthTestEnv();
  const filteredLogs = {
    logs: [DEFAULT_LOGS.logs[0], DEFAULT_LOGS.logs[1]],
  };

  const requestDetails = new RequestDetails({ requestId: 'eth_getLogsTest', ipAddress: '0.0.0.0' });

  overrideEnvsInMochaDescribe({ ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE: 1 });

  beforeEach(async () => {
    // reset cache and restMock
    await cacheService.clear(requestDetails);
    restMock.reset();

    sdkClientStub = sinon.createStubInstance(SDKClient);
    getSdkClientStub = sinon.stub(hapiServiceInstance, 'getSDKClient').returns(sdkClientStub);
    restMock.onGet('network/fees').reply(200, JSON.stringify(DEFAULT_NETWORK_FEES));
  });

  afterEach(() => {
    getSdkClientStub.restore();
  });

  describe('timeout', async function () {
    beforeEach(() => {
      restMock.onGet(`blocks/${BLOCK_HASH}`).timeout();
      restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(DEFAULT_BLOCKS_RES));
      restMock.onGet(CONTRACTS_LOGS_WITH_FILTER).timeout();
      restMock.onGet(CONTRACT_RESULTS_LOGS_WITH_FILTER_URL).reply(200, JSON.stringify(filteredLogs));
    });

    it('BLOCK_HASH filter timeouts and throws the expected error', async () => {
      await ethGetLogsFailing(
        ethImpl,
        [{ blockHash: BLOCK_HASH, fromBlock: null, toBlock: null, address: null, topics: null }, requestDetails],
        (error: any) => {
          expect(error.statusCode).to.equal(504);
          expect(error.message).to.eq('timeout of 10000ms exceeded');
        },
      );
    });

    it('address filter timeouts and throws the expected error', async () => {
      await ethGetLogsFailing(
        ethImpl,
        [
          { blockHash: null, fromBlock: null, toBlock: null, address: CONTRACT_ADDRESS_1, topics: null },
          requestDetails,
        ],
        (error: any) => {
          expect(error.statusCode).to.equal(504);
          expect(error.message).to.eq('timeout of 10000ms exceeded');
        },
      );
    });
  });

  it('error when retrieving logs', async function () {
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(DEFAULT_BLOCKS_RES));
    restMock
      .onGet(CONTRACT_RESULTS_LOGS_WITH_FILTER_URL)
      .reply(400, JSON.stringify({ _status: { messages: [{ message: 'Mocked error' }] } }));

    let errorReceived = false;
    try {
      await ethImpl.getLogs(
        { blockHash: null, fromBlock: 'latest', toBlock: 'latest', address: null, topics: null },
        requestDetails,
      );
    } catch (error: any) {
      errorReceived = true;
      expect(error.statusCode).to.equal(400);
      expect(error.message).to.eq('Mocked error');
    }

    expect(errorReceived, 'Error should be thrown').to.be.true;
  });

  it('no filters', async function () {
    const filteredLogs = {
      logs: [
        DEFAULT_LOGS.logs[0],
        { ...DEFAULT_LOGS.logs[1], address: '0x0000000000000000000000000000000002131952' },
        { ...DEFAULT_LOGS.logs[2], address: '0x0000000000000000000000000000000002131953' },
        { ...DEFAULT_LOGS.logs[3], address: '0x0000000000000000000000000000000002131954' },
      ],
    };
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(DEFAULT_BLOCKS_RES));
    restMock.onGet(CONTRACT_RESULTS_LOGS_WITH_FILTER_URL).reply(200, JSON.stringify(filteredLogs));
    filteredLogs.logs.forEach((log, index) => {
      restMock
        .onGet(`contracts/${log.address}`)
        .reply(200, JSON.stringify({ ...DEFAULT_CONTRACT, contract_id: `0.0.105${index}` }));
    });

    const result = await ethImpl.getLogs(
      { blockHash: null, fromBlock: 'latest', toBlock: 'latest', address: null, topics: null },
      requestDetails,
    );
    expect(result).to.exist;

    expect(result.length).to.eq(4);
    expectLogData(result[0], filteredLogs.logs[0], defaultDetailedContractResults);
    expectLogData(result[1], filteredLogs.logs[1], defaultDetailedContractResults);
    expectLogData(result[2], filteredLogs.logs[2], defaultDetailedContractResults2);
    expectLogData(result[3], filteredLogs.logs[3], defaultDetailedContractResults3);
  });

  it('should throw an error if transaction_index is falsy', async function () {
    const filteredLogs = {
      logs: [
        { ...DEFAULT_LOGS.logs[0], transaction_index: undefined },
        { ...DEFAULT_LOGS.logs[1], transaction_index: undefined },
        { ...DEFAULT_LOGS.logs[2], transaction_index: undefined },
        { ...DEFAULT_LOGS.logs[3], transaction_index: undefined },
      ],
    };
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(DEFAULT_BLOCKS_RES));
    restMock.onGet(CONTRACT_RESULTS_LOGS_WITH_FILTER_URL).reply(200, JSON.stringify(filteredLogs));
    filteredLogs.logs.forEach((log, index) => {
      restMock
        .onGet(`contracts/${log.address}`)
        .reply(200, JSON.stringify({ ...DEFAULT_CONTRACT, contract_id: `0.0.105${index}` }));
    });

    try {
      await ethImpl.getLogs(
        { blockHash: null, fromBlock: 'latest', toBlock: 'latest', address: null, topics: null },
        requestDetails,
      );
      expect.fail('should have thrown an error');
    } catch (error) {
      expect(error).to.exist;
      expect(error).to.eq(predefined.DEPENDENT_SERVICE_IMMATURE_RECORDS);
    }
  });

  withOverriddenEnvsInMochaTest({ MIRROR_NODE_LIMIT_PARAM: '2' }, () => {
    it('should be able to return more than two logs with limit of two per request', async function () {
      const unfilteredLogs = {
        logs: [
          { ...DEFAULT_LOGS.logs[0], address: '0x67D8d32E9Bf1a9968a5ff53B87d777Aa8EBBEe69' },
          { ...DEFAULT_LOGS.logs[1], address: '0x0000000000000000000000000000000002131952' },
          { ...DEFAULT_LOGS.logs[2], address: '0x0000000000000000000000000000000002131953' },
          { ...DEFAULT_LOGS.logs[3], address: '0x0000000000000000000000000000000002131954' },
        ],
      };
      const filteredLogs = {
        logs: [
          { ...DEFAULT_LOGS.logs[0], address: '0x67D8d32E9Bf1a9968a5ff53B87d777Aa8EBBEe69' },
          { ...DEFAULT_LOGS.logs[1], address: '0x0000000000000000000000000000000002131952' },
        ],
        links: { next: 'contracts/results/logs?limit=2&order=desc&timestamp=lte:1668432962.375200975&index=lt:0' },
      };
      const filteredLogsNext = {
        logs: [
          { ...DEFAULT_LOGS.logs[2], address: '0x0000000000000000000000000000000002131953' },
          { ...DEFAULT_LOGS.logs[3], address: '0x0000000000000000000000000000000002131954' },
        ],
        links: { next: null },
      };

      restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(DEFAULT_BLOCKS_RES));

      restMock
        .onGet(
          `contracts/results/logs?timestamp=gte:${DEFAULT_BLOCK.timestamp.from}&timestamp=lte:${DEFAULT_BLOCK.timestamp.to}&limit=2&order=asc`,
        )
        .replyOnce(200, JSON.stringify(filteredLogs))
        .onGet('contracts/results/logs?limit=2&order=desc&timestamp=lte:1668432962.375200975&index=lt:0')
        .replyOnce(200, JSON.stringify(filteredLogsNext));

      unfilteredLogs.logs.forEach((log, index) => {
        restMock
          .onGet(`contracts/${log.address}`)
          .reply(200, JSON.stringify({ ...DEFAULT_CONTRACT, contract_id: `0.0.105${index}` }));
      });

      const result = await ethImpl.getLogs(
        { blockHash: null, fromBlock: 'latest', toBlock: 'latest', address: null, topics: null },
        requestDetails,
      );
      expect(result).to.exist;

      expect(result.length).to.eq(4);
      expectLogData(result[0], filteredLogs.logs[0], defaultDetailedContractResults);
      expectLogData(result[1], filteredLogs.logs[1], defaultDetailedContractResults);
      expectLogData(result[2], filteredLogsNext.logs[0], defaultDetailedContractResults2);
      expectLogData(result[3], filteredLogsNext.logs[1], defaultDetailedContractResults3);
    });
  });

  it('Should return evm address if contract has one', async function () {
    const filteredLogs = {
      logs: [
        {
          ...DEFAULT_LOGS.logs[0],
          address: defaultEvmAddress,
        },
      ],
    };

    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(DEFAULT_BLOCKS_RES));
    restMock.onGet(CONTRACT_RESULTS_LOGS_WITH_FILTER_URL).reply(200, JSON.stringify(filteredLogs));
    restMock
      .onGet(`contracts/${filteredLogs.logs[0].address}`)
      .reply(200, JSON.stringify({ ...DEFAULT_CONTRACT, evm_address: defaultEvmAddress }));

    const result = await ethImpl.getLogs(
      { blockHash: null, fromBlock: 'latest', toBlock: 'latest', address: null, topics: null },
      requestDetails,
    );
    expect(result).to.exist;

    expect(result.length).to.eq(1);
    expect(result[0].address).to.eq(defaultEvmAddress);
  });

  it('address filter', async function () {
    const filteredLogs = {
      logs: [DEFAULT_LOGS.logs[0], DEFAULT_LOGS.logs[1], DEFAULT_LOGS.logs[2]],
    };
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(DEFAULT_BLOCKS_RES));
    restMock.onGet(CONTRACTS_LOGS_WITH_FILTER).reply(200, JSON.stringify(filteredLogs));
    for (const log of filteredLogs.logs) {
      restMock.onGet(`contracts/${log.address}`).reply(200, JSON.stringify(DEFAULT_CONTRACT));
    }

    const result = await ethImpl.getLogs(
      { blockHash: null, fromBlock: 'latest', toBlock: 'latest', address: CONTRACT_ADDRESS_1, topics: null },
      requestDetails,
    );

    expect(result).to.exist;

    expect(result.length).to.eq(3);
    expectLogData1(result[0]);
    expectLogData2(result[1]);
    expectLogData3(result[2]);
  });

  [CONTRACT_ADDRESS_1, [CONTRACT_ADDRESS_1]].forEach((address) => {
    it(`should filter logs by \`${JSON.stringify(address)}\` with a large block range`, async function () {
      const filteredLogs = {
        logs: [DEFAULT_LOGS.logs[0], DEFAULT_LOGS.logs[1], DEFAULT_LOGS.logs[2]],
      };
      restMock.onGet(CONTRACTS_LOGS_WITH_FILTER).reply(200, JSON.stringify(filteredLogs));
      for (const log of filteredLogs.logs) {
        restMock.onGet(`contracts/${log.address}`).reply(200, JSON.stringify(DEFAULT_CONTRACT));
      }

      const fromBlock = {
        ...DEFAULT_BLOCK,
        number: 1,
      };
      const toBlock = {
        ...DEFAULT_BLOCK,
        number: 1003,
      };

      const blockBeyondMaximumRange = {
        ...DEFAULT_BLOCK,
        number: 1007,
      };

      restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify({ blocks: [blockBeyondMaximumRange] }));
      restMock.onGet('blocks/1').reply(200, JSON.stringify(fromBlock));
      restMock.onGet('blocks/1003').reply(200, JSON.stringify(toBlock));

      const result = await ethImpl.getLogs(
        { blockHash: null, fromBlock: '0x1', toBlock: '0x3eb', address, topics: null },
        requestDetails,
      );

      expect(result).to.exist;

      expect(result.length).to.eq(3);
      expectLogData1(result[0]);
      expectLogData2(result[1]);
      expectLogData3(result[2]);
    });
  });

  it('multiple addresses filter', async function () {
    const filteredLogsAddress1 = {
      logs: [DEFAULT_LOGS.logs[0], DEFAULT_LOGS.logs[1], DEFAULT_LOGS.logs[2]],
    };
    const filteredLogsAddress2 = {
      logs: DEFAULT_LOGS_3,
    };
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(DEFAULT_BLOCKS_RES));
    restMock.onGet(CONTRACTS_LOGS_WITH_FILTER).reply(200, JSON.stringify(filteredLogsAddress1));
    restMock
      .onGet(
        `contracts/${CONTRACT_ADDRESS_2}/results/logs?timestamp=gte:${DEFAULT_BLOCK.timestamp.from}&timestamp=lte:${DEFAULT_BLOCK.timestamp.to}&limit=100&order=asc`,
      )
      .reply(200, JSON.stringify(filteredLogsAddress2));
    for (const log of filteredLogsAddress1.logs) {
      restMock.onGet(`contracts/${log.address}`).reply(200, JSON.stringify(DEFAULT_CONTRACT));
    }
    restMock.onGet(`contracts/${CONTRACT_ADDRESS_2}`).reply(200, JSON.stringify(DEFAULT_CONTRACT_2));

    const result = await ethImpl.getLogs(
      {
        blockHash: null,
        fromBlock: 'latest',
        toBlock: 'latest',
        address: [CONTRACT_ADDRESS_1, CONTRACT_ADDRESS_2],
        topics: null,
      },
      requestDetails,
    );

    expect(result).to.exist;

    expect(result.length).to.eq(4);
    expectLogData1(result[0]);
    expectLogData2(result[1]);
    expectLogData3(result[2]);
    expectLogData4(result[3]);
  });

  it('BLOCK_HASH filter', async function () {
    const filteredLogs = {
      logs: [DEFAULT_LOGS.logs[0], DEFAULT_LOGS.logs[1]],
    };

    restMock.onGet(`blocks/${BLOCK_HASH}`).reply(200, JSON.stringify(DEFAULT_BLOCK));
    restMock.onGet(CONTRACT_RESULTS_LOGS_WITH_FILTER_URL).reply(200, JSON.stringify(filteredLogs));
    for (const log of filteredLogs.logs) {
      restMock.onGet(`contracts/${log.address}`).reply(200, JSON.stringify(DEFAULT_CONTRACT));
    }

    const result = await ethImpl.getLogs(
      { blockHash: BLOCK_HASH, fromBlock: 'latest', toBlock: 'latest', address: null, topics: null },
      requestDetails,
    );

    expect(result).to.exist;
    expectLogData1(result[0]);
    expectLogData2(result[1]);
  });

  it('with valid fromBlock && toBlock filter', async function () {
    const filteredLogs = {
      logs: [DEFAULT_LOGS.logs[0], DEFAULT_LOGS.logs[1]],
    };
    const toBlock = {
      ...DEFAULT_BLOCK,
      number: 16,
      timestamp: {
        from: `1651560391.060890949`,
        to: '1651560393.060890949',
      },
    };

    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify({ blocks: [latestBlock] }));
    restMock.onGet('blocks/5').reply(200, JSON.stringify(DEFAULT_BLOCK));
    restMock.onGet('blocks/16').reply(200, JSON.stringify(toBlock));
    restMock
      .onGet(
        `contracts/results/logs?timestamp=gte:${DEFAULT_BLOCK.timestamp.from}&timestamp=lte:${toBlock.timestamp.to}&limit=100&order=asc`,
      )
      .reply(200, JSON.stringify(filteredLogs));
    for (const log of filteredLogs.logs) {
      restMock.onGet(`contracts/${log.address}`).reply(200, JSON.stringify(DEFAULT_CONTRACT));
    }

    const result = await ethImpl.getLogs(
      { blockHash: null, fromBlock: '0x5', toBlock: '0x10', address: null, topics: null },
      requestDetails,
    );

    expect(result).to.exist;
    expectLogData1(result[0]);
    expectLogData2(result[1]);
  });

  it('with non-existing fromBlock filter', async function () {
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify({ blocks: [latestBlock] }));

    restMock.onGet('blocks/5').reply(200, JSON.stringify(DEFAULT_BLOCK));
    restMock.onGet('blocks/16').reply(404, JSON.stringify(NOT_FOUND_RES));

    const result = await ethImpl.getLogs(
      { blockHash: null, fromBlock: '0x10', toBlock: '0x5', address: null, topics: null },
      requestDetails,
    );

    expect(result).to.exist;
    expect(result).to.be.empty;
  });

  it('should return empty response if toBlock is not existed', async function () {
    const filteredLogs = {
      logs: [DEFAULT_LOGS.logs[0]],
    };

    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify({ blocks: [latestBlock] }));
    restMock.onGet('blocks/5').reply(200, JSON.stringify(DEFAULT_BLOCK));
    restMock.onGet('blocks/16').reply(404, JSON.stringify(NOT_FOUND_RES));
    restMock
      .onGet(`contracts/results/logs?timestamp=gte:${DEFAULT_BLOCK.timestamp.from}&limit=100&order=asc`)
      .reply(200, JSON.stringify(filteredLogs));
    restMock.onGet(`contracts/${filteredLogs.logs[0].address}`).reply(200, JSON.stringify(DEFAULT_CONTRACT));

    const result = await ethImpl.getLogs(
      { blockHash: null, fromBlock: '0x5', toBlock: '0x10', address: null, topics: null },
      requestDetails,
    );

    expect(result).to.exist;
    expect(result).to.be.empty;
  });

  it('when fromBlock > toBlock', async function () {
    const fromBlock = {
      ...DEFAULT_BLOCK,
      number: 16,
      timestamp: {
        from: `1651560391.060890949`,
        to: '1651560393.060890949',
      },
    };

    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify({ blocks: [latestBlock] }));
    restMock.onGet('blocks/16').reply(200, JSON.stringify(fromBlock));
    restMock.onGet('blocks/5').reply(200, JSON.stringify(DEFAULT_BLOCK));

    await expect(
      ethImpl.getLogs(
        { blockHash: null, fromBlock: '0x10', toBlock: '0x5', address: null, topics: null },
        requestDetails,
      ),
    ).to.be.rejectedWith(predefined.INVALID_BLOCK_RANGE.message);
  });

  it('with only toBlock', async function () {
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify({ blocks: [latestBlock] }));
    restMock.onGet('blocks/5').reply(200, JSON.stringify(DEFAULT_BLOCKS_RES));

    await ethGetLogsFailing(
      ethImpl,
      [{ blockHash: null, fromBlock: null, toBlock: '0x5', address: null, topics: null }, requestDetails],
      (error: any) => {
        expect(error.code).to.equal(-32011);
        expect(error.message).to.equal('Provided toBlock parameter without specifying fromBlock');
      },
    );
  });

  it('with block tag', async function () {
    const filteredLogs = {
      logs: [DEFAULT_LOGS.logs[0]],
    };

    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(DEFAULT_BLOCKS_RES));
    restMock.onGet(CONTRACT_RESULTS_LOGS_WITH_FILTER_URL).reply(200, JSON.stringify(filteredLogs));
    for (const log of filteredLogs.logs) {
      restMock.onGet(`contracts/${log.address}`).reply(200, JSON.stringify(DEFAULT_CONTRACT));
    }

    const result = await ethImpl.getLogs(
      { blockHash: null, fromBlock: 'latest', toBlock: 'latest', address: null, topics: null },
      requestDetails,
    );

    expect(result).to.exist;
    expectLogData1(result[0]);
  });

  [null, [], [CONTRACT_ADDRESS_1, CONTRACT_ADDRESS_2]].forEach((address) => {
    it(`should fail when block range is too large for address(es) \`${JSON.stringify(address)}\``, async function () {
      const fromBlock = {
        ...DEFAULT_BLOCK,
        number: 1,
      };
      const toBlock = {
        ...DEFAULT_BLOCK,
        number: 1003,
      };

      const blockBeyondMaximumRange = {
        ...DEFAULT_BLOCK,
        number: 1007,
      };

      restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify({ blocks: [blockBeyondMaximumRange] }));
      restMock.onGet('blocks/1').reply(200, JSON.stringify(fromBlock));
      restMock.onGet('blocks/1003').reply(200, JSON.stringify(toBlock));

      await ethGetLogsFailing(
        ethImpl,
        [{ blockHash: null, fromBlock: '0x1', toBlock: '0x3eb', address, topics: null }, requestDetails],
        (error: any) => {
          expect(error.message).to.equal('Exceeded maximum block range: 1000');
        },
      );
    });
  });

  it('with topics filter', async function () {
    const filteredLogs = {
      logs: [DEFAULT_LOGS.logs[0], DEFAULT_LOGS.logs[1]],
    };

    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(DEFAULT_BLOCKS_RES));
    restMock
      .onGet(
        `contracts/results/logs` +
          `?timestamp=gte:${DEFAULT_BLOCK.timestamp.from}` +
          `&timestamp=lte:${DEFAULT_BLOCK.timestamp.to}` +
          `&topic0=${DEFAULT_LOG_TOPICS[0]}&topic1=${DEFAULT_LOG_TOPICS[1]}` +
          `&topic2=${DEFAULT_LOG_TOPICS[2]}&topic3=${DEFAULT_LOG_TOPICS[3]}&limit=100&order=asc`,
      )
      .reply(200, JSON.stringify(filteredLogs));
    for (const log of filteredLogs.logs) {
      restMock.onGet(`contracts/${log.address}`).reply(200, JSON.stringify(DEFAULT_CONTRACT));
    }

    const result = await ethImpl.getLogs(
      { blockHash: null, fromBlock: 'latest', toBlock: 'latest', address: null, topics: DEFAULT_LOG_TOPICS },
      requestDetails,
    );

    expect(result).to.exist;
    expectLogData1(result[0]);
    expectLogData2(result[1]);
  });

  it('with null topics filter', async function () {
    const filteredLogs = {
      logs: [DEFAULT_LOGS_4[0]],
    };
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(DEFAULT_BLOCKS_RES));
    restMock
      .onGet(
        `contracts/results/logs` +
          `?timestamp=gte:${DEFAULT_BLOCK.timestamp.from}` +
          `&timestamp=lte:${DEFAULT_BLOCK.timestamp.to}` +
          `&topic0=${DEFAULT_LOG_TOPICS_1[0]}` +
          `&topic1=${DEFAULT_LOG_TOPICS_1[1]}&limit=100&order=asc`,
      )
      .reply(200, JSON.stringify(filteredLogs));
    for (const log of filteredLogs.logs) {
      restMock.onGet(`contracts/${log.address}`).reply(200, JSON.stringify(DEFAULT_CONTRACT));
    }
    const result = await ethImpl.getLogs(
      { blockHash: null, fromBlock: 'latest', toBlock: 'latest', address: null, topics: DEFAULT_NULL_LOG_TOPICS },
      requestDetails,
    );

    expect(result).to.exist;
    expect(result[0].topics.length).to.eq(DEFAULT_LOGS_4[0].topics.length);
    for (let index = 0; index < result[0].topics.length; index++) {
      expect(result[0].topics[index]).to.eq(DEFAULT_LOGS_4[0].topics[index]);
    }
  });

  it('with topics and blocks filter', async function () {
    const filteredLogs = {
      logs: [DEFAULT_LOGS.logs[0], DEFAULT_LOGS.logs[1]],
    };

    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify({ blocks: [latestBlock] }));
    restMock.onGet('blocks/5').reply(200, JSON.stringify(DEFAULT_BLOCK));
    restMock.onGet('blocks/16').reply(200, JSON.stringify(DEFAULT_BLOCK));
    restMock
      .onGet(
        `contracts/results/logs` +
          `?timestamp=gte:${DEFAULT_BLOCK.timestamp.from}` +
          `&timestamp=lte:${DEFAULT_BLOCK.timestamp.to}` +
          `&topic0=${DEFAULT_LOG_TOPICS[0]}&topic1=${DEFAULT_LOG_TOPICS[1]}` +
          `&topic2=${DEFAULT_LOG_TOPICS[2]}&topic3=${DEFAULT_LOG_TOPICS[3]}&limit=100&order=asc`,
      )
      .reply(200, JSON.stringify(filteredLogs));
    for (const log of filteredLogs.logs) {
      restMock.onGet(`contracts/${log.address}`).reply(200, JSON.stringify(DEFAULT_CONTRACT));
    }

    const result = await ethImpl.getLogs(
      { blockHash: null, fromBlock: '0x5', toBlock: '0x10', address: null, topics: DEFAULT_LOG_TOPICS },
      requestDetails,
    );

    expectLogData1(result[0]);
    expectLogData2(result[1]);
  });

  it('Should return empty log if address = ZeroAddress', async () => {
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify({ blocks: [latestBlock] }));
    restMock.onGet('blocks/0').reply(200, JSON.stringify(DEFAULT_BLOCK));
    restMock.onGet('blocks/latest').reply(200, JSON.stringify(DEFAULT_BLOCK));
    const result = await ethImpl.getLogs(
      { blockHash: null, fromBlock: '0x0', toBlock: 'latest', address: ethers.ZeroAddress, topics: DEFAULT_LOG_TOPICS },
      requestDetails,
    );
    expect(result.length).to.eq(0);
    expect(result).to.deep.equal([]);
  });

  it('Should throw TIMESTAMP_RANGE_TOO_LARGE predefined error if timestamp range between fromBlock and toBlock exceed the maximum allowed duration of 7 days', async () => {
    const mockedFromTimeStamp = 1651560389;
    const mockedToTimeStamp = mockedFromTimeStamp + 604800 * 2 + 1; // 7 days (604800 seconds) and 1 second greater than mockedFromTimeStamp

    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify({ blocks: [latestBlock] }));
    restMock.onGet(`blocks/${BLOCK_NUMBER_2}`).reply(
      200,
      JSON.stringify({
        ...DEFAULT_BLOCK,
        timestamp: { ...DEFAULT_BLOCK.timestamp, from: mockedFromTimeStamp.toString() },
        number: BLOCK_NUMBER_2,
      }),
    );

    restMock.onGet(`blocks/${BLOCK_NUMBER_3}`).reply(
      200,
      JSON.stringify({
        ...DEFAULT_BLOCK,
        timestamp: { ...DEFAULT_BLOCK.timestamp, to: mockedToTimeStamp.toString() },
        number: BLOCK_NUMBER_3,
      }),
    );

    await expect(
      ethImpl.getLogs(
        {
          blockHash: null,
          fromBlock: BLOCK_NUMBER_2.toString(16),
          toBlock: BLOCK_NUMBER_3.toString(16),
          address: ethers.ZeroAddress,
          topics: DEFAULT_LOG_TOPICS,
        },
        requestDetails,
      ),
    ).to.be.rejectedWith(
      predefined.TIMESTAMP_RANGE_TOO_LARGE(
        `0x${BLOCK_NUMBER_2.toString(16)}`,
        mockedFromTimeStamp,
        `0x${BLOCK_NUMBER_3.toString(16)}`,
        mockedToTimeStamp,
      ).message,
    );
  });
});
