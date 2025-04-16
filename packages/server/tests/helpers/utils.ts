// SPDX-License-Identifier: Apache-2.0

import { ethers } from 'ethers';
import Assertions from './assertions';
import crypto from 'crypto';
import RelayClient from '../clients/relayClient';
import { numberTo0x } from '@hashgraph/json-rpc-relay/dist/formatters';
import RelayCall from '../../tests/helpers/constants';
import { AccountId, KeyList, PrivateKey } from '@hashgraph/sdk';
import { AliasAccount } from '../types/AliasAccount';
import ServicesClient from '../clients/servicesClient';
import http from 'http';
import { GCProfiler, setFlagsFromString, writeHeapSnapshot } from 'v8';
import { runInNewContext } from 'vm';
import { Context } from 'mocha';
import { GitHubClient } from '../clients/githubClient';
import MirrorClient from '../clients/mirrorClient';
import { HeapDifferenceStatistics } from '../types/HeapDifferenceStatistics';
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';

export class Utils {
  static readonly HEAP_SIZE_DIFF_MEMORY_LEAK_THRESHOLD: number = 4e6; // 4 MB
  static readonly HEAP_SIZE_DIFF_SNAPSHOT_THRESHOLD: number = 5e6; // 5 MB
  static readonly WARM_UP_TEST_COUNT: number = 3;

  /**
   * Converts a number to its hexadecimal representation.
   *
   * @param {number | bigint | string} num The number to convert to hexadecimal.
   * @returns {string} The hexadecimal representation of the number.
   */
  static toHex = (num: number | bigint | string): string => {
    return Number(num).toString(16);
  };

  /**
   * Converts a given Hedera account ID to an EVM compatible address.
   *
   * @param {string} id The Hedera account ID to convert.
   * @returns {string} The EVM compatible address.
   */
  static idToEvmAddress = (id: string): string => {
    Assertions.assertId(id);
    const [shard, realm, num] = id.split('.');

    return [
      '0x',
      this.toHex(shard).padStart(8, '0'),
      this.toHex(realm).padStart(16, '0'),
      this.toHex(num).padStart(16, '0'),
    ].join('');
  };

  /**
   * Converts a value from tinybars to weibars.
   *
   * @param {number | bigint | string} value The value in tinybars to convert.
   * @returns {bigint} The value converted to weibars.
   */
  static tinyBarsToWeibars = (value: number | bigint | string): bigint => {
    return ethers.parseUnits(Number(value).toString(), 10);
  };

  /**
   * Generates a random string of the specified length.
   *
   * @param {number} length The length of the random string to generate.
   * @returns {string} The generated random string.
   */
  static randomString(length: number): string {
    let result = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Generates a random trace ID for requests.
   *
   * @returns {string} The generated random trace ID.
   */
  static generateRequestId = (): string => {
    return crypto.randomUUID();
  };

  /**
   * Format message prefix for logger.
   */
  static formatRequestIdMessage = (requestId?: string): string => {
    return requestId ? `[Request ID: ${requestId}]` : '';
  };

  static deployContractWithEthers = async (
    constructorArgs: any[] = [],
    contractJson: { abi: ethers.InterfaceAbi | ethers.Interface; bytecode: ethers.BytesLike | { object: string } },
    wallet: ethers.Wallet,
    relay: RelayClient,
  ) => {
    const factory = new ethers.ContractFactory(contractJson.abi, contractJson.bytecode, wallet);
    let contract = await factory.deploy(...constructorArgs);
    await contract.waitForDeployment();

    // re-init the contract with the deployed address
    const receipt = await relay.provider.getTransactionReceipt(contract.deploymentTransaction()!.hash);

    let contractAddress: string | ethers.Addressable;
    if (receipt?.to) {
      // long-zero address
      contractAddress = receipt.to;
    } else {
      // evm address
      contractAddress = contract.target;
    }

    return new ethers.Contract(contractAddress, contractJson.abi, wallet);
  };

  // The main difference between this and deployContractWithEthers is that this does not re-init the contract with the deployed address
  // and that results in the contract address coming in EVM Format instead of LongZero format
  static deployContractWithEthersV2 = async (
    constructorArgs: any[] = [],
    contractJson: { abi: ethers.Interface | ethers.InterfaceAbi; bytecode: ethers.BytesLike | { object: string } },
    wallet: ethers.Wallet,
  ) => {
    const factory = new ethers.ContractFactory(contractJson.abi, contractJson.bytecode, wallet);
    const contract = await factory.deploy(...constructorArgs);
    await contract.waitForDeployment();
    // no need to re-init the contract with the deployed address
    return contract;
  };

  static createHTS = async (
    tokenName: string,
    symbol: string,
    adminAccount: AliasAccount,
    initialSupply: number,
    abi: ethers.InterfaceAbi | ethers.Interface,
    associatedAccounts: AliasAccount[],
    owner: AliasAccount,
    servicesNode: ServicesClient,
    requestId?: string,
  ) => {
    const htsResult = await servicesNode.createHTS({
      tokenName,
      symbol,
      treasuryAccountId: adminAccount.accountId.toString(),
      initialSupply,
      adminPrivateKey: adminAccount.privateKey,
    });

    // Associate and approve token for all accounts
    for (const account of associatedAccounts) {
      await servicesNode.associateHTSToken(
        account.accountId,
        htsResult.receipt.tokenId!,
        account.privateKey,
        htsResult.client,
        requestId,
      );
      await servicesNode.approveHTSToken(account.accountId, htsResult.receipt.tokenId!, htsResult.client, requestId);
    }

    // Setup initial balance of token owner account
    await servicesNode.transferHTSToken(
      owner.accountId,
      htsResult.receipt.tokenId!,
      initialSupply,
      htsResult.client.operatorAccountId!,
      requestId,
    );
    const evmAddress = Utils.idToEvmAddress(htsResult.receipt.tokenId!.toString());
    return new ethers.Contract(evmAddress, abi, owner.wallet);
  };

  static add0xPrefix = (num: string) => {
    return num.startsWith('0x') ? num : '0x' + num;
  };

  static gasOptions = async (requestId: string, gasLimit = 1_500_000) => {
    const relay: RelayClient = global.relay;
    return {
      gasLimit: gasLimit,
      gasPrice: await relay.gasPrice(requestId),
    };
  };

  static convertEthersResultIntoStringsArray = (res) => {
    if (typeof res === 'object') {
      return res.toArray().map((e) => Utils.convertEthersResultIntoStringsArray(e));
    }
    return res.toString();
  };

  static ethCallWRetries = async (
    relay: RelayClient,
    callData: { from: string; to: any; gas: string; data: string },
    blockNumber: string,
    requestId: string,
  ): Promise<string> => {
    let numberOfCalls = 0;
    let res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, blockNumber], requestId);
    while (res === '0x' && numberOfCalls < 3) {
      await new Promise((r) => setTimeout(r, 2000));
      res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, blockNumber], requestId);
      numberOfCalls++;
    }
    return res;
  };

  /**
   * Deploys a contract using the provided ABI and bytecode.
   *
   * @param {ethers.InterfaceAbi} abi The ABI of the contract.
   * @param {string} bytecode The bytecode of the contract.
   * @param {ethers.Wallet} signer The wallet used to sign the deployment transaction.
   * @returns {Promise<ethers.Contract>} A promise resolving to the deployed contract.
   */
  static readonly deployContract = async (
    abi: ethers.InterfaceAbi,
    bytecode: string,
    signer: ethers.Wallet,
  ): Promise<ethers.Contract> => {
    const factory = new ethers.ContractFactory(abi, bytecode, signer);
    const contract = await factory.deploy();
    await contract.waitForDeployment();

    return contract as ethers.Contract;
  };

  static sendTransaction = async (
    ONE_TINYBAR: any,
    CHAIN_ID: string | number,
    accounts: AliasAccount[],
    rpcServer: any,
    requestId: any,
    mirrorNodeServer: any,
  ) => {
    const transaction = {
      value: ONE_TINYBAR,
      gasLimit: numberTo0x(30000),
      chainId: Number(CHAIN_ID),
      to: accounts[1].address,
      nonce: await rpcServer.getAccountNonce(accounts[0].address, requestId),
      maxFeePerGas: await rpcServer.gasPrice(requestId),
    };

    const signedTx = await accounts[0].wallet.signTransaction(transaction);
    const transactionHash = await rpcServer.sendRawTransaction(signedTx, requestId);

    await mirrorNodeServer.get(`/contracts/results/${transactionHash}`, requestId);

    return await rpcServer.call(RelayCall.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT, [transactionHash], requestId);
  };
  /**
   * Creates an alias account on the mirror node with the provided details.
   *
   * @param {MirrorClient} mirrorNode The mirror node client.
   * @param {AliasAccount} creator The creator account for the alias.
   * @param {string} requestId The unique identifier for the request.
   * @param {string} balanceInTinyBar The initial balance for the alias account in tiny bars. Defaults to 10 HBAR.
   * @returns {Promise<AliasAccount>} A promise resolving to the created alias account.
   */
  static readonly createAliasAccount = async (
    mirrorNode: MirrorClient,
    creator: AliasAccount,
    requestId: string,
    balanceInTinyBar: string = '1000000000', //10 HBAR
  ): Promise<AliasAccount> => {
    const signer = creator.wallet;
    const accountBalance = Utils.tinyBarsToWeibars(balanceInTinyBar);
    const privateKey = PrivateKey.generateECDSA();
    const wallet = new ethers.Wallet(privateKey.toStringRaw(), signer.provider);
    const address = wallet.address;

    // create hollow account
    await signer.sendTransaction({
      to: wallet.address,
      value: accountBalance,
    });

    const mirrorNodeAccount = (await mirrorNode.get(`/accounts/${address}`, requestId)).account;
    const accountId = AccountId.fromString(mirrorNodeAccount);
    const client: ServicesClient = new ServicesClient(
      ConfigService.get('HEDERA_NETWORK')!,
      accountId.toString(),
      privateKey.toStringDer(),
      creator.client.getLogger(),
    );

    const account: AliasAccount = {
      alias: accountId,
      accountId,
      address: wallet.address,
      client: client,
      privateKey,
      wallet,
      keyList: KeyList.from([privateKey]),
    };

    return account;
  };

  static async createMultipleAliasAccounts(
    mirrorNode: MirrorClient,
    initialAccount: AliasAccount,
    neededAccounts: number,
    initialAmountInTinyBar: string,
    requestDetails: RequestDetails,
  ): Promise<AliasAccount[]> {
    const accounts: AliasAccount[] = [];
    for (let i = 0; i < neededAccounts; i++) {
      const account = await Utils.createAliasAccount(
        mirrorNode,
        initialAccount,
        requestDetails.requestId,
        initialAmountInTinyBar,
      );
      if (global.logger.isLevelEnabled('trace')) {
        global.logger.trace(
          `${requestDetails.formattedRequestId} Create new Eth compatible account w alias: ${account.address} and balance ~${initialAmountInTinyBar} wei`,
        );
      }
      accounts.push(account);
    }
    return accounts;
  }

  static sendJsonRpcRequestWithDelay(
    host: string,
    port: number,
    method: string,
    params: any[],
    delayMs: number,
  ): Promise<any> {
    const requestData = JSON.stringify({
      jsonrpc: '2.0',
      method: method,
      params: params,
      id: 1,
    });

    const options = {
      hostname: host,
      port: port,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestData),
      },
      timeout: delayMs,
    };

    return new Promise((resolve, reject) => {
      // setup the request
      const req = http.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          resolve(JSON.parse(data));
        });
      });

      // handle request errors for testing purposes
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timed out after ${delayMs}ms`));
      });

      req.on('error', (err) => {
        reject(err);
      });

      // Introduce a delay with inactivity, before sending the request
      setTimeout(async () => {
        req.write(requestData);
        req.end();
        await new Promise((r) => setTimeout(r, delayMs + 1000));
      }, delayMs);
    });
  }

  static async wait(time: number): Promise<void> {
    await new Promise((r) => setTimeout(r, time));
  }

  static async writeHeapSnapshotAsync(): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      try {
        const fileName = writeHeapSnapshot();
        console.info(`Heap snapshot written to ${fileName}`);
        resolve(fileName);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Captures memory leaks in the test suite.
   * The function will start the profiler before each test and stop it after each test.
   * If a memory leak is detected, the function will log the difference in memory usage.
   */
  static captureMemoryLeaks(profiler: GCProfiler): void {
    setFlagsFromString('--expose_gc');
    const gc = runInNewContext('gc');
    const githubClient = new GitHubClient();

    let isWarmUpCompleted = false;

    const warmUp = async () => {
      for (let i = 0; i < Utils.WARM_UP_TEST_COUNT; i++) {
        // Run dummy tests to warm up the environment
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      isWarmUpCompleted = true;
    };

    beforeEach(async function () {
      if (!isWarmUpCompleted) {
        await warmUp();
      }
      profiler.start();
    });

    afterEach(async function (this: Context) {
      this.timeout(60000);
      await gc(); // force a garbage collection to get accurate memory usage
      try {
        const result = profiler.stop();
        const statsGrowingHeapSize = result.statistics.filter((stats) => {
          return stats.afterGC.heapStatistics.totalHeapSize > stats.beforeGC.heapStatistics.totalHeapSize;
        });
        const totalDiffBytes = statsGrowingHeapSize.reduce((acc, stats) => {
          const diff = stats.afterGC.heapStatistics.totalHeapSize - stats.beforeGC.heapStatistics.totalHeapSize;
          return acc + diff;
        }, 0);
        const isPotentialMemoryLeak = totalDiffBytes > Utils.HEAP_SIZE_DIFF_MEMORY_LEAK_THRESHOLD;

        if (isPotentialMemoryLeak) {
          console.warn('Potential memory leak detected!');
          const statsDiff: HeapDifferenceStatistics = statsGrowingHeapSize.map((stats) => ({
            gcType: stats.gcType,
            cost: stats.cost,
            diffGC: {
              heapStatistics: Utils.difference(stats.afterGC.heapStatistics, stats.beforeGC.heapStatistics),
              heapSpaceStatistics: Utils.difference(
                stats.afterGC.heapSpaceStatistics,
                stats.beforeGC.heapSpaceStatistics,
              ).filter((spaceStatistics) => spaceStatistics.spaceSize > 0),
            },
          }));
          console.error(
            `Total Heap Size ${Utils.formatBytes(totalDiffBytes)}: --> ` + JSON.stringify(statsDiff, null, 2),
          );
          // add comment on PR highlighting after which test the memory leak is happening
          const testTitle = this.currentTest?.title ?? 'Unknown test';
          const comment = Utils.generateMemoryLeakComment(testTitle, statsDiff);
          await githubClient.addOrUpdateExistingCommentOnPullRequest(comment, (existing: string) =>
            existing.includes(`\`${testTitle}\``),
          );
          // write a heap snapshot if the memory leak is more than 1 MB
          const isMemoryLeakSnapshotEnabled = ConfigService.get('WRITE_SNAPSHOT_ON_MEMORY_LEAK');
          if (isMemoryLeakSnapshotEnabled && totalDiffBytes > Utils.HEAP_SIZE_DIFF_SNAPSHOT_THRESHOLD) {
            console.info('Writing heap snapshot...');
            await Utils.writeHeapSnapshotAsync();
          }
        }
      } catch (error) {
        console.error('Error capturing memory leaks:', error);
      }
    });
  }

  /**
   * Generates a comment indicating a memory leak detected during tests.
   * @param {string} testTitle The title of the current test.
   * @param {HeapDifferenceStatistics} statsDiff The difference in memory statistics indicating the leak.
   * @returns {string} The formatted comment.
   */
  private static generateMemoryLeakComment(testTitle: string, statsDiff: HeapDifferenceStatistics): string {
    const commentHeader = '## 🚨 Memory Leak Detected 🚨';
    const summary = `A potential memory leak has been detected in the test titled \`${testTitle}\`. This may impact the application's performance and stability.`;
    const detailsHeader = '### Details';
    const formattedStatsDiff = this.formatHeapDifferenceStatistics(statsDiff);
    const recommendationsHeader = '### Recommendations';
    const recommendations =
      'Please investigate the memory allocations in this test, focusing on objects that are not being properly deallocated.';

    return `${commentHeader}\n\n${summary}\n\n${detailsHeader}\n${formattedStatsDiff}\n\n${recommendationsHeader}\n${recommendations}`;
  }

  /**
   * Formats the difference in heap statistics into a readable string.
   * @param {HeapDifferenceStatistics} statsDiff The difference in heap statistics.
   * @returns {string} The formatted string.
   */
  private static formatHeapDifferenceStatistics(statsDiff: HeapDifferenceStatistics): string {
    let message = '📊 **Memory Leak Detection Report** 📊\n\n';

    statsDiff.forEach((entry) => {
      message += `**GC Type**: ${entry.gcType}\n`;
      message += `**Cost**: ${entry.cost.toLocaleString()} ms\n\n`;
      message += '**Heap Statistics (before vs after executing the test)**:\n';
      Object.entries(entry.diffGC.heapStatistics).forEach(([key, value]) => {
        message += `- **${this.camelCaseToTitleCase(key)}**: ${this.formatBytes(value)}\n`;
      });
      message += '\n**Heap Space Statistics (before vs after executing the test)**:\n';
      entry.diffGC.heapSpaceStatistics.forEach((space) => {
        message += `  - **${this.snakeCaseToTitleCase(space.spaceName)}**:\n`;
        Object.entries(space).forEach(([key, value]) => {
          if (key !== 'spaceName') {
            message += `    - **${this.camelCaseToTitleCase(key)}**: ${this.formatBytes(value)}\n`;
          }
        });
        message += '\n';
      });
    });

    return message;
  }

  /**
   * Converts a string in camel case to title case.
   * @param textInCamelCase The text in camel case.
   * @return The text in title case.
   */
  private static camelCaseToTitleCase(textInCamelCase: string): string {
    return textInCamelCase
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
  }

  /**
   * Converts a string in snake case to title case.
   * @param textInSnakeCase The text in snake case.
   * @return The text in title case.
   */
  private static snakeCaseToTitleCase(textInSnakeCase: string): string {
    return textInSnakeCase
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')
      .trim();
  }

  /**
   * Calculates the difference between two objects or arrays of objects.
   * This utility method is used to calculate the difference in heap statistics before and after GC.
   * @param after The object representing the state after an operation.
   * @param before The object representing the state before the operation.
   * @returns The difference between the two states.
   */
  private static difference<T extends number | string | object | object[]>(after: T, before: T): T {
    if (Array.isArray(after) && Array.isArray(before)) {
      return this.arrayDifference(after, before);
    } else if (typeof after === 'object' && typeof before === 'object') {
      return this.objectDifference(after, before);
    } else if (typeof after === 'number' && typeof before === 'number') {
      return (after - before) as T;
    } else if (typeof after === 'string' && typeof before === 'string') {
      if (after !== before) {
        throw new Error(`Mismatched values: ${after} is not equal to ${before}`);
      }
      return after as T;
    } else {
      throw new Error('Invalid input: both parameters must be objects or arrays of objects');
    }
  }

  /**
   * Calculates the difference between two objects
   * @param after
   * @param before
   */
  private static objectDifference<T extends object>(after: T, before: T): T {
    const diff = { ...after };
    for (const key of Object.keys(after)) {
      if (!(key in before)) {
        throw new Error(`Mismatched properties: ${key} is not present in both objects`);
      }
      diff[key] = this.difference(after[key], before[key]);
    }
    return diff as T;
  }

  /**
   * Calculates the difference between two arrays of objects
   * @param after
   * @param before
   */
  private static arrayDifference<T extends object[]>(after: T, before: T): T {
    return after.map((item: object, index: number) => this.difference(item, before[index])) as T;
  }

  /**
   * Formats bytes into a readable string.
   * @param {number} bytes The number of bytes.
   * @returns {string} A formatted string representing the size in bytes, KB, MB, GB, or TB.
   */
  private static formatBytes(bytes: number): string {
    if (bytes === 0) return 'no changes';
    const prefix = bytes > 0 ? 'increased with' : 'decreased with';
    const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
    let power = Math.floor(Math.log(Math.abs(bytes)) / Math.log(1000));
    power = Math.min(power, units.length - 1);
    const size = Math.abs(bytes) / Math.pow(1000, power);
    return `${prefix} ${size.toFixed(2)} ${units[power]}`;
  }
}
