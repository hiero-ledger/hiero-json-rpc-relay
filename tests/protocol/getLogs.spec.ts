// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { ethers } from 'ethers';

import { ConfigService } from '../../src/config-service/services';
import { predefined } from '../../src/relay';
import { numberTo0x } from '../../src/relay/formatters';
import { ConfigServiceTestHelper } from '../config-service/configServiceTestHelper';
import MirrorClient from '../server/clients/mirrorClient';
import RelayClient from '../server/clients/relayClient';
import logsContractJson from '../server/contracts/Logs.json';
import Address from '../server/helpers/constants';
import RelayCalls from '../server/helpers/constants';
import { Utils } from '../server/helpers/utils';
import { AliasAccount } from '../server/types/AliasAccount';
import { ALL_PROTOCOL_CLIENTS } from './helpers/protocolClient';

describe('@release @protocol-acceptance eth_getLogs', async function () {
  this.timeout(240 * 1000);
  const METHOD_NAME = 'eth_getLogs';

  const FAKE_TX_HASH = `0x${'00'.repeat(20)}`;
  const INVALID_PARAMS: any[][] = [
    [],
    [{ address: '0xhedera', fromBlock: 'latest', toBlock: 'latest' }],
    [{ address: FAKE_TX_HASH, fromBlock: '0xhedera', toBlock: 'latest' }],
    [{ address: FAKE_TX_HASH, fromBlock: 'latest', toBlock: '0xhedera' }],
  ];

  // @notice: Simple contract with a single LuckyNum(uint256) event emitted during deployment with value 7.
  const SIMPLE_CONTRACT_EXPECTED_VALUE = 7;
  const SIMPLE_CONTRACT_ABI = [
    { inputs: [], stateMutability: 'nonpayable', type: 'constructor' },
    {
      anonymous: false,
      inputs: [{ indexed: false, internalType: 'uint256', name: '', type: 'uint256' }],
      name: 'LuckyNum',
      type: 'event',
    },
  ];
  const SIMPLE_CONTRACT_BYTECODE =
    '0x6080604052348015600f57600080fd5b507f4e7df42af9a017b7c655a28ef10cbc8f05b2b088f087ee02416cfa1a96ac3be26007604051603e91906091565b60405180910390a160aa565b6000819050919050565b6000819050919050565b6000819050919050565b6000607d6079607584604a565b605e565b6054565b9050919050565b608b816068565b82525050565b600060208201905060a460008301846084565b92915050565b603f8060b76000396000f3fe6080604052600080fdfea264697066735822122084db7fe76bde5c9c041d61bb40294c56dc6d339bdbc8e0cd285fc4008ccefc2c64736f6c63430008180033';

  // @ts-ignore
  const {
    mirrorNode,
    relay,
    initialBalance,
  }: { mirrorNode: MirrorClient; relay: RelayClient; initialBalance: string } = global;

  const accounts: AliasAccount[] = [];
  let log0Block: any, log4Block: any;
  let contractAddress: string, contractAddress2: string;
  let latestBlock: number, previousBlock: number;
  let expectedAmountOfLogs: number;
  let simpleContractFilterObj: any;

  before(async () => {
    accounts.push(...(await Utils.createMultipleAliasAccounts(mirrorNode, global.accounts[0], 2, initialBalance)));
    global.accounts.push(...accounts);

    // Setup for WS-origin happy-path: simple contract that emits LuckyNum event on deployment.
    const currentBlock = Number(await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_BLOCK_NUMBER, []));
    const currentBlockHex = numberTo0x(currentBlock);
    const simpleContract = await Utils.deployContract(
      SIMPLE_CONTRACT_ABI,
      SIMPLE_CONTRACT_BYTECODE,
      accounts[0].wallet,
    );
    simpleContractFilterObj = {
      address: simpleContract.target,
      fromBlock: currentBlockHex,
      toBlock: 'latest',
    };

    // Setup for HTTP-origin tests: Logs contract with log0–log4 methods.
    const logsContract = await Utils.deployContract(
      logsContractJson.abi,
      logsContractJson.bytecode,
      accounts[0].wallet,
    );
    const logsContract2 = await Utils.deployContract(
      logsContractJson.abi,
      logsContractJson.bytecode,
      accounts[0].wallet,
    );
    contractAddress = logsContract.target.toString();
    contractAddress2 = logsContract2.target.toString();

    previousBlock = Number(await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_BLOCK_NUMBER, []));

    // @ts-ignore
    await (await logsContract.connect(accounts[1].wallet).log0(1)).wait();
    // @ts-ignore
    await (await logsContract.connect(accounts[1].wallet).log1(1)).wait();
    // @ts-ignore
    await (await logsContract.connect(accounts[1].wallet).log2(1, 1)).wait();
    // @ts-ignore
    await (await logsContract.connect(accounts[1].wallet).log3(1, 1, 1)).wait();
    // @ts-ignore
    await (await logsContract.connect(accounts[1].wallet).log4(1, 1, 1, 1)).wait();
    // @ts-ignore
    await (await logsContract2.connect(accounts[1].wallet).log4(1, 1, 1, 1)).wait();

    expectedAmountOfLogs = 6;
    latestBlock = Number(await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_BLOCK_NUMBER, []));
  });

  after(async () => {
    if (global?.socketServer) {
      expect(global.socketServer._connections).to.eq(0);
    }
  });

  for (const client of ALL_PROTOCOL_CLIENTS) {
    describe(client.label, () => {
      it('@release Should execute eth_getLogs and handle valid requests correctly', async () => {
        const logs = (await client.call(METHOD_NAME, [simpleContractFilterObj])) as any[];

        expect(logs[0].address.toLowerCase()).to.eq((simpleContractFilterObj.address as string).toLowerCase());
        expect(logs[0].logIndex).to.eq('0x0');
        expect(parseInt(logs[0].data)).to.eq(SIMPLE_CONTRACT_EXPECTED_VALUE);
      });

      it('@release should deploy a contract', async () => {
        //empty params for get logs defaults to latest block, which doesn't have required logs, that's why we fetch the last 12
        const logs = (await client.call(METHOD_NAME, [
          {
            fromBlock: numberTo0x(previousBlock),
            address: [contractAddress, contractAddress2],
          },
        ])) as any[];

        expect(logs.length).to.be.greaterThan(0);
        const txIndexLogIndexMapping: any[] = [];
        for (const i in logs) {
          expect(logs[i]).to.have.property('address');
          expect(logs[i]).to.have.property('logIndex');
          expect(logs[i]).to.have.property('blockTimestamp');

          const key = `${logs[i].transactionHash}---${logs[i].logIndex}`;
          txIndexLogIndexMapping.push(key);
        }
        const uniqueTxIndexLogIndexMapping = txIndexLogIndexMapping.filter(
          (value, index, self) => self.indexOf(value) === index,
        );
        expect(txIndexLogIndexMapping.length).to.equal(uniqueTxIndexLogIndexMapping.length);

        log0Block = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_HASH, [logs[0].transactionHash]);
        const transactionCountLog0Block = await relay.provider.getTransactionCount(
          log0Block.from,
          log0Block.blockNumber,
        );

        log4Block = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_BY_HASH, [
          logs[logs.length - 1].transactionHash,
        ]);
        const transactionCountLog4Block = await relay.provider.getTransactionCount(
          log4Block.from,
          log4Block.blockNumber,
        );

        expect(log0Block).to.exist;
        expect(log0Block).to.have.property('blockNumber');

        // nonce is zero based, so we need to subtract 1
        expect(parseInt(log0Block.nonce, 16)).to.equal(transactionCountLog0Block - 1);

        expect(log4Block).to.exist;
        expect(log4Block).to.have.property('blockNumber');

        // nonce is zero based, so we need to subtract 1
        expect(parseInt(log4Block.nonce, 16)).to.equal(transactionCountLog4Block - 1);
      });

      it('should be able to use `fromBlock` param', async () => {
        const logs = (await client.call(METHOD_NAME, [
          {
            fromBlock: log0Block.blockNumber,
            address: [contractAddress, contractAddress2],
          },
        ])) as any[];
        expect(logs.length).to.be.greaterThan(0);

        const log0BlockInt = parseInt(log0Block.blockNumber);
        for (const i in logs) {
          expect(parseInt(logs[i].blockNumber, 16)).to.be.greaterThanOrEqual(log0BlockInt);
        }
      });

      it('should not be able to use `toBlock` without `fromBlock` param if `toBlock` is not latest', async () => {
        const response = await client.callRaw(METHOD_NAME, [{ toBlock: log0Block.blockNumber }]);
        expect(response.error).to.exist;
        expect(response.error!.code).to.eq(predefined.MISSING_FROM_BLOCK_PARAM.code);
      });

      it('should be able to use range of `fromBlock` and `toBlock` params', async () => {
        const logs = (await client.call(METHOD_NAME, [
          {
            fromBlock: log0Block.blockNumber,
            toBlock: log4Block.blockNumber,
            address: [contractAddress, contractAddress2],
          },
        ])) as any[];
        expect(logs.length).to.be.greaterThan(0);

        const log0BlockInt = parseInt(log0Block.blockNumber);
        const log4BlockInt = parseInt(log4Block.blockNumber);
        for (const i in logs) {
          expect(parseInt(logs[i].blockNumber, 16)).to.be.greaterThanOrEqual(log0BlockInt);
          expect(parseInt(logs[i].blockNumber, 16)).to.be.lessThanOrEqual(log4BlockInt);
        }
      });

      it('should return empty logs if `toBlock` is not found', async () => {
        const notExistedLog = latestBlock + 99;

        const logs = (await client.call(METHOD_NAME, [
          {
            fromBlock: log0Block.blockNumber,
            toBlock: `0x${notExistedLog.toString(16)}`,
            address: [contractAddress, contractAddress2],
          },
        ])) as any[];

        expect(logs.length).to.eq(0);
      });

      it('should be able to use `address` param', async () => {
        //when we pass only address, it defaults to the latest block
        const logs = (await client.call(METHOD_NAME, [
          {
            fromBlock: numberTo0x(previousBlock),
            address: contractAddress,
          },
        ])) as any[];
        expect(logs.length).to.be.greaterThan(0);

        for (const i in logs) {
          expect(logs[i].address.toLowerCase()).to.equal(contractAddress.toLowerCase());
        }
      });

      it('should be able to use `address` param with a large block range', async () => {
        const blockRangeLimit = ConfigService.get('ETH_GET_LOGS_BLOCK_RANGE_LIMIT');
        let customBlockRangeLimit = 10;
        try {
          //when we pass only address, it defaults to the latest block
          const logs = (await client.call(METHOD_NAME, [
            {
              fromBlock: numberTo0x(latestBlock - customBlockRangeLimit - 1),
              address: contractAddress,
            },
          ])) as any[];
          expect(logs.length).to.be.greaterThan(0);

          for (const i in logs) {
            expect(logs[i].address.toLowerCase()).to.equal(contractAddress.toLowerCase());
          }
        } finally {
          customBlockRangeLimit = blockRangeLimit;
        }
      });

      it('should be able to use `address` param with multiple addresses', async () => {
        const logs = (await client.call(METHOD_NAME, [
          {
            fromBlock: numberTo0x(previousBlock),
            address: [contractAddress, contractAddress2, Address.NON_EXISTING_ADDRESS],
          },
        ])) as any[];
        expect(logs.length).to.be.greaterThan(0);
        expect(logs.length).to.be.eq(6);

        for (let i = 0; i < 5; i++) {
          expect(logs[i].address.toLowerCase()).to.equal(contractAddress.toLowerCase());
        }

        expect(logs[5].address.toLowerCase()).to.equal(contractAddress2.toLowerCase());
      });

      it('should be able to use `blockHash` param', async () => {
        const logs = (await client.call(METHOD_NAME, [
          {
            blockHash: log0Block.blockHash,
            address: [contractAddress, contractAddress2],
          },
        ])) as any[];
        expect(logs.length).to.be.greaterThan(0);

        for (const i in logs) {
          expect(logs[i].blockHash).to.equal(log0Block.blockHash);
        }
      });

      it('should return empty result for  non-existing `blockHash`', async () => {
        const logs = (await client.call(METHOD_NAME, [
          {
            blockHash: Address.NON_EXISTING_BLOCK_HASH,
            address: [contractAddress, contractAddress2],
          },
        ])) as any[];
        expect(logs).to.exist;
        expect(logs.length).to.be.eq(0);
      });

      it('should be able to use `topics` param', async () => {
        const logs = (await client.call(METHOD_NAME, [
          {
            fromBlock: log0Block.blockNumber,
            toBlock: log4Block.blockNumber,
            address: [contractAddress, contractAddress2],
          },
        ])) as any[];
        expect(logs.length).to.be.greaterThan(0);
        //using second log in array, because the first doesn't contain any topics
        const topic = logs[1].topics[0];

        const logsWithTopic = (await client.call(METHOD_NAME, [
          {
            fromBlock: log0Block.blockNumber,
            toBlock: log4Block.blockNumber,
            topics: [topic],
          },
        ])) as any[];
        expect(logsWithTopic.length).to.be.greaterThan(0);

        for (const i in logsWithTopic) {
          expect(logsWithTopic[i].topics.length).to.be.greaterThan(0);
          expect(logsWithTopic[i].topics[0]).to.be.equal(topic);
        }
      });

      it('should be able to return more than 2 logs with limit of 2 logs per request', async () => {
        //for the purpose of the test, we are settings limit to 2, and fetching all.
        //setting mirror node limit to 2 for this test only
        ConfigServiceTestHelper.dynamicOverride('MIRROR_NODE_LIMIT_PARAM', '2');

        const logs = (await client.call(METHOD_NAME, [
          {
            fromBlock: numberTo0x(previousBlock),
            toBlock: numberTo0x(latestBlock),
            address: [contractAddress, contractAddress2],
          },
        ])) as any[];

        expect(logs.length).to.eq(expectedAmountOfLogs);
      });

      it('should return empty logs if address = ZeroAddress', async () => {
        const logs = (await client.call(METHOD_NAME, [
          {
            fromBlock: '0x0',
            toBlock: 'latest',
            address: ethers.ZeroAddress,
          },
        ])) as any[];
        expect(logs.length).to.eq(0);
      });

      it('should return only logs of non-zero addresses', async () => {
        const currentBlock = Number(await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_BLOCK_NUMBER, []));
        let blocksBehindLatest = 0;
        if (currentBlock > 10) {
          blocksBehindLatest = currentBlock - 10;
        }
        const logs = (await client.call(METHOD_NAME, [
          {
            fromBlock: numberTo0x(blocksBehindLatest),
            toBlock: 'latest',
            address: [ethers.ZeroAddress, contractAddress2],
          },
        ])) as any[];
        expect(logs.length).to.eq(1);
      });

      for (const params of INVALID_PARAMS) {
        it(`Should fail eth_getLogs and throw INVALID_PARAMETERS if the request's params variable is invalid. params=[${JSON.stringify(params)}]`, async () => {
          const response = await client.callRaw(METHOD_NAME, params);
          expect(response.error).to.exist;
          expect(response.error!.code).to.be.oneOf([-32000, -32602, -32603]);
        });
      }
    });
  }
});
