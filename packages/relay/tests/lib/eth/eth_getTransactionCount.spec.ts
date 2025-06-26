// SPDX-License-Identifier: Apache-2.0

import MockAdapter from 'axios-mock-adapter';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

import { Eth, predefined } from '../../../src';
import { numberTo0x } from '../../../src/formatters';
import { SDKClient } from '../../../src/lib/clients';
import constants from '../../../src/lib/constants';
import { CacheService } from '../../../src/lib/services/cacheService/cacheService';
import HAPIService from '../../../src/lib/services/hapiService/hapiService';
import { RequestDetails } from '../../../src/lib/types';
import RelayAssertions from '../../assertions';
import {
  defaultDetailedContractResults,
  defaultEthereumTransactions,
  mockData,
  overrideEnvsInMochaDescribe,
} from '../../helpers';
import { DEFAULT_NETWORK_FEES, NO_TRANSACTIONS } from './eth-config';
import { generateEthTestEnv } from './eth-helpers';

use(chaiAsPromised);

let sdkClientStub: sinon.SinonStubbedInstance<SDKClient>;
let getSdkClientStub: sinon.SinonStub;

describe('@ethGetTransactionCount eth_getTransactionCount spec', async function () {
  this.timeout(10000);
  const {
    restMock,
    hapiServiceInstance,
    ethImpl,
    cacheService,
  }: { restMock: MockAdapter; hapiServiceInstance: HAPIService; ethImpl: Eth; cacheService: CacheService } =
    generateEthTestEnv();

  const requestDetails = new RequestDetails({ requestId: 'eth_getTransactionCountTest', ipAddress: '0.0.0.0' });
  const blockNumber = mockData.blocks.blocks[2].number;
  const blockNumberHex = numberTo0x(blockNumber);
  const transactionId = '0.0.1078@1686183420.196506746';
  const MOCK_ACCOUNT_ADDR = mockData.account.evm_address;

  const accountPath = `accounts/${MOCK_ACCOUNT_ADDR}${NO_TRANSACTIONS}`;
  const accountTimestampFilteredPath = `accounts/${MOCK_ACCOUNT_ADDR}?transactiontype=ETHEREUMTRANSACTION&timestamp=lte:${mockData.blocks.blocks[2].timestamp.to}&limit=2&order=desc`;
  const contractPath = `contracts/${MOCK_ACCOUNT_ADDR}`;
  const contractResultsPath = `contracts/results/${transactionId}`;
  const earliestBlockPath = `blocks?limit=1&order=asc`;
  const blockPath = `blocks/${blockNumber}`;
  const latestBlockPath = `blocks?limit=1&order=desc`;

  function transactionPath(address: string, num: number) {
    return `accounts/${address}?transactiontype=ETHEREUMTRANSACTION&timestamp=lte:${mockData.blocks.blocks[2].timestamp.to}&limit=${num}&order=desc`;
  }

  overrideEnvsInMochaDescribe({ ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE: 1 });

  this.beforeEach(() => {
    restMock.onGet('network/fees').reply(200, JSON.stringify(DEFAULT_NETWORK_FEES));
    restMock.onGet(blockPath).reply(200, JSON.stringify(mockData.blocks.blocks[2]));
    restMock.onGet(accountPath).reply(200, JSON.stringify(mockData.account));
    restMock.onGet(latestBlockPath).reply(
      202,
      JSON.stringify({
        blocks: [
          {
            ...mockData.blocks.blocks[2],
            number: blockNumber + constants.MAX_BLOCK_RANGE + 1,
          },
        ],
      }),
    );
    restMock
      .onGet(transactionPath(mockData.account.evm_address, 2))
      .reply(200, JSON.stringify({ transactions: [{ transaction_id: transactionId }, {}] }));
  });

  this.afterEach(async () => {
    getSdkClientStub.restore();
    restMock.resetHandlers();
    // reset cache and restMock
    await cacheService.clear(requestDetails);
    restMock.reset();
  });

  this.beforeAll(async () => {
    sdkClientStub = sinon.createStubInstance(SDKClient);
    getSdkClientStub = sinon.stub(hapiServiceInstance, 'getSDKClient').returns(sdkClientStub);
  });

  it('should return 0x0 nonce for latest block with not found account', async () => {
    restMock.onGet(contractPath).reply(404, JSON.stringify(mockData.notFound));
    restMock.onGet(accountPath).reply(404, JSON.stringify(mockData.notFound));
    const nonce = await ethImpl.getTransactionCount(MOCK_ACCOUNT_ADDR, 'latest', requestDetails);
    expect(nonce).to.exist;
    expect(nonce).to.equal(constants.ZERO_HEX);
  });

  it('should return latest nonce for latest block but valid account', async () => {
    restMock.onGet(contractPath).reply(404, JSON.stringify(mockData.notFound));
    restMock.onGet(accountPath).reply(200, JSON.stringify(mockData.account));
    const nonce = await ethImpl.getTransactionCount(MOCK_ACCOUNT_ADDR, 'latest', requestDetails);
    expect(nonce).to.exist;
    expect(nonce).to.equal(numberTo0x(mockData.account.ethereum_nonce));
  });

  it('should return 0x0 nonce for block 0 consideration', async () => {
    restMock.onGet(accountPath).reply(200, JSON.stringify(mockData.account));
    const nonce = await ethImpl.getTransactionCount(MOCK_ACCOUNT_ADDR, '0', requestDetails);
    expect(nonce).to.exist;
    expect(nonce).to.equal(constants.ZERO_HEX);
  });

  it('should return 0x0 nonce for block 1 consideration', async () => {
    restMock.onGet(accountPath).reply(200, JSON.stringify(mockData.account));
    const nonce = await ethImpl.getTransactionCount(MOCK_ACCOUNT_ADDR, '1', requestDetails);
    expect(nonce).to.exist;
    expect(nonce).to.equal(constants.ZERO_HEX);
  });

  it('should return latest nonce for latest block', async () => {
    restMock.onGet(accountPath).reply(200, JSON.stringify(mockData.account));
    const nonce = await ethImpl.getTransactionCount(MOCK_ACCOUNT_ADDR, constants.BLOCK_LATEST, requestDetails);
    expect(nonce).to.exist;
    expect(nonce).to.equal(numberTo0x(mockData.account.ethereum_nonce));
  });

  it('should return latest nonce for finalized block', async () => {
    restMock.onGet(accountPath).reply(200, JSON.stringify(mockData.account));
    const nonce = await ethImpl.getTransactionCount(MOCK_ACCOUNT_ADDR, constants.BLOCK_FINALIZED, requestDetails);
    expect(nonce).to.exist;
    expect(nonce).to.equal(numberTo0x(mockData.account.ethereum_nonce));
  });

  it('should return latest nonce for latest block', async () => {
    restMock.onGet(accountPath).reply(200, JSON.stringify(mockData.account));
    const nonce = await ethImpl.getTransactionCount(MOCK_ACCOUNT_ADDR, constants.BLOCK_SAFE, requestDetails);
    expect(nonce).to.exist;
    expect(nonce).to.equal(numberTo0x(mockData.account.ethereum_nonce));
  });

  it('should return latest nonce for pending block', async () => {
    restMock.onGet(accountPath).reply(200, JSON.stringify(mockData.account));
    const nonce = await ethImpl.getTransactionCount(MOCK_ACCOUNT_ADDR, constants.BLOCK_PENDING, requestDetails);
    expect(nonce).to.exist;
    expect(nonce).to.equal(numberTo0x(mockData.account.ethereum_nonce));
  });

  it('should return 0x0 nonce for earliest block with valid block', async () => {
    restMock.onGet(earliestBlockPath).reply(200, JSON.stringify({ blocks: [mockData.blocks.blocks[0]] }));
    const nonce = await ethImpl.getTransactionCount(MOCK_ACCOUNT_ADDR, constants.BLOCK_EARLIEST, requestDetails);
    expect(nonce).to.exist;
    expect(nonce).to.equal(constants.ZERO_HEX);
  });

  it('should throw error for earliest block with invalid block', async () => {
    restMock.onGet(earliestBlockPath).reply(200, JSON.stringify({ blocks: [] }));
    const args = [MOCK_ACCOUNT_ADDR, constants.BLOCK_EARLIEST, requestDetails];

    await RelayAssertions.assertRejection(
      predefined.INTERNAL_ERROR('No network blocks found'),
      ethImpl.getTransactionCount,
      true,
      ethImpl,
      args,
    );
  });

  it('should throw error for earliest block with non 0 or 1 block', async () => {
    restMock.onGet(earliestBlockPath).reply(200, JSON.stringify({ blocks: [mockData.blocks.blocks[2]] }));

    const args = [MOCK_ACCOUNT_ADDR, constants.BLOCK_EARLIEST, requestDetails];

    const errMessage = `Partial mirror node encountered, earliest block number is ${mockData.blocks.blocks[2].number}`;

    await RelayAssertions.assertRejection(
      predefined.INTERNAL_ERROR(errMessage),
      ethImpl.getTransactionCount,
      true,
      ethImpl,
      args,
    );
  });

  it('should return nonce for request on historical numerical block', async () => {
    restMock
      .onGet(accountPath)
      .reply(200, JSON.stringify({ ...mockData.account, transactions: [defaultEthereumTransactions[0]] }));
    restMock
      .onGet(accountTimestampFilteredPath)
      .reply(200, JSON.stringify({ ...mockData.account, transactions: defaultEthereumTransactions }));
    restMock.onGet(`${contractResultsPath}`).reply(200, JSON.stringify(defaultDetailedContractResults));

    const accountPathContractResultsAddress = `accounts/${defaultDetailedContractResults.from}${NO_TRANSACTIONS}`;
    restMock
      .onGet(accountPathContractResultsAddress)
      .reply(200, JSON.stringify({ ...mockData.account, transactions: [defaultEthereumTransactions[0]] }));

    const nonce = await ethImpl.getTransactionCount(MOCK_ACCOUNT_ADDR, blockNumberHex, requestDetails);
    expect(nonce).to.exist;
    expect(nonce).to.equal(`0x${defaultDetailedContractResults.nonce + 1}`);
  });

  it('should throw error for account historical numerical block tag with missing block', async () => {
    restMock.onGet(blockPath).reply(404, JSON.stringify(mockData.notFound));

    const args = [MOCK_ACCOUNT_ADDR, blockNumberHex, requestDetails];

    await RelayAssertions.assertRejection(predefined.UNKNOWN_BLOCK(), ethImpl.getTransactionCount, true, ethImpl, args);
  });

  it('should throw error for account historical numerical block tag with error on latest block', async () => {
    restMock.onGet(blockPath).reply(404, JSON.stringify(mockData.notFound));
    restMock.onGet(latestBlockPath).reply(404, JSON.stringify(mockData.notFound));

    const args = [MOCK_ACCOUNT_ADDR, blockNumberHex, requestDetails];

    await RelayAssertions.assertRejection(predefined.UNKNOWN_BLOCK(), ethImpl.getTransactionCount, true, ethImpl, args);
  });

  it('should return valid nonce for historical numerical block close to latest', async () => {
    restMock.onGet(latestBlockPath).reply(
      202,
      JSON.stringify({
        blocks: [
          {
            ...mockData.blocks.blocks[2],
            number: blockNumber + 1,
          },
        ],
      }),
    );
    restMock.onGet(accountPath).reply(200, JSON.stringify(mockData.account));

    const nonce = await ethImpl.getTransactionCount(MOCK_ACCOUNT_ADDR, blockNumberHex, requestDetails);
    expect(nonce).to.exist;
    expect(nonce).to.equal(numberTo0x(mockData.account.ethereum_nonce));
  });

  it('should return 0x0 nonce for historical numerical block with no ethereum transactions found', async () => {
    restMock.onGet(transactionPath(MOCK_ACCOUNT_ADDR, 2)).reply(200, JSON.stringify({ transactions: [] }));

    const nonce = await ethImpl.getTransactionCount(MOCK_ACCOUNT_ADDR, blockNumberHex, requestDetails);
    expect(nonce).to.exist;
    expect(nonce).to.equal(constants.ZERO_HEX);
  });

  it('should return 0x1 nonce for historical numerical block with a single ethereum transactions found', async () => {
    restMock.onGet(transactionPath(MOCK_ACCOUNT_ADDR, 2)).reply(200, JSON.stringify({ transactions: [{}] }));

    const nonce = await ethImpl.getTransactionCount(MOCK_ACCOUNT_ADDR, blockNumberHex, requestDetails);
    expect(nonce).to.exist;
    expect(nonce).to.equal(constants.ONE_HEX);
  });

  it('should throw for historical numerical block with a missing contracts results', async () => {
    restMock
      .onGet(transactionPath(MOCK_ACCOUNT_ADDR, 2))
      .reply(200, JSON.stringify({ transactions: [{ transaction_id: transactionId }, {}] }));
    restMock.onGet(contractResultsPath).reply(404, JSON.stringify(mockData.notFound));

    const args = [MOCK_ACCOUNT_ADDR, blockNumberHex, requestDetails];
    const errMessage = `Failed to retrieve contract results for transaction ${transactionId}`;

    await RelayAssertions.assertRejection(
      predefined.RESOURCE_NOT_FOUND(errMessage),
      ethImpl.getTransactionCount,
      true,
      ethImpl,
      args,
    );
  });

  it('should return valid nonce for historical numerical block when contract result sender is not address', async () => {
    restMock.onGet(contractResultsPath).reply(200, JSON.stringify({ from: mockData.contract.evm_address, nonce: 2 }));

    const accountPathContractResultsAddress = `accounts/${mockData.contract.evm_address}${NO_TRANSACTIONS}`;
    restMock
      .onGet(accountPathContractResultsAddress)
      .reply(200, JSON.stringify({ ...mockData.account, transactions: [defaultEthereumTransactions[0]] }));

    const nonce = await ethImpl.getTransactionCount(mockData.account.evm_address, blockNumberHex, requestDetails);
    expect(nonce).to.exist;
    expect(nonce).to.equal(numberTo0x(3));
  });

  it('should return valid nonce for historical numerical block', async () => {
    restMock
      .onGet(contractResultsPath)
      .reply(200, JSON.stringify({ from: mockData.account.evm_address, nonce: mockData.account.ethereum_nonce - 1 }));
    const accountPathContractResultsAddress = `accounts/${mockData.account.evm_address}${NO_TRANSACTIONS}`;
    restMock
      .onGet(accountPathContractResultsAddress)
      .reply(200, JSON.stringify({ ...mockData.account, transactions: [defaultEthereumTransactions[0]] }));
    const nonce = await ethImpl.getTransactionCount(mockData.account.evm_address, blockNumberHex, requestDetails);
    expect(nonce).to.exist;
    expect(nonce).to.equal(numberTo0x(mockData.account.ethereum_nonce));
  });

  it('should throw for -1 invalid block tag', async () => {
    const args = [MOCK_ACCOUNT_ADDR, '-1', requestDetails];

    await RelayAssertions.assertRejection(predefined.UNKNOWN_BLOCK(), ethImpl.getTransactionCount, true, ethImpl, args);
  });

  it('should throw for invalid block tag', async () => {
    const args = [MOCK_ACCOUNT_ADDR, 'notablock', requestDetails];

    await RelayAssertions.assertRejection(predefined.UNKNOWN_BLOCK(), ethImpl.getTransactionCount, true, ethImpl, args);
  });

  it('should return 0x1 for pre-hip-729 contracts with nonce=null', async () => {
    restMock.onGet(accountPath).reply(200, JSON.stringify({ ...mockData.account, ethereum_nonce: null }));
    const nonce = await ethImpl.getTransactionCount(MOCK_ACCOUNT_ADDR, constants.BLOCK_LATEST, requestDetails);
    expect(nonce).to.exist;
    expect(nonce).to.equal(constants.ONE_HEX);
  });

  it('should return nonce when block hash is passed', async () => {
    const blockHash = mockData.blocks.blocks[2].hash;
    restMock.onGet(`blocks/${blockHash}`).reply(200, JSON.stringify(mockData.blocks.blocks[2]));
    restMock.onGet(`${contractResultsPath}`).reply(200, JSON.stringify(defaultDetailedContractResults));

    const accountPathContractResultsAddress = `accounts/${defaultDetailedContractResults.from}${NO_TRANSACTIONS}`;
    restMock
      .onGet(accountPathContractResultsAddress)
      .reply(200, JSON.stringify({ ...mockData.account, transactions: [defaultEthereumTransactions[0]] }));
    const nonce = await ethImpl.getTransactionCount(MOCK_ACCOUNT_ADDR, blockHash, requestDetails);
    expect(nonce).to.exist;
    expect(nonce).to.equal(numberTo0x(2));
  });
});
