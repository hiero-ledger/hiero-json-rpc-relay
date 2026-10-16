// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { Transaction, Wallet } from 'ethers';
import { pino } from 'pino';
import { Registry } from 'prom-client';
import { createClient, type RedisClientType } from 'redis';
import sinon from 'sinon';

import constants from '../../../../src/relay/lib/constants';
import { type TransactionService } from '../../../../src/relay/lib/services/ethService/transactionService/TransactionService';
import { RedisPendingTransactionStorage } from '../../../../src/relay/lib/services/transactionPoolService/RedisPendingTransactionStorage';
import { TransactionPoolService } from '../../../../src/relay/lib/services/transactionPoolService/transactionPoolService';
import { RequestDetails } from '../../../../src/relay/lib/types';
import { overrideEnvsInMochaDescribe, useInMemoryRedisServer, withOverriddenEnvsInMochaTest } from '../../helpers';
import { DEFAULT_LOGS_3 } from './eth-config';
import { generateEthTestEnv } from './eth-helpers';

describe('pending pool confirmation from eth_getTransactionReceipt and eth_getTransactionByHash', function () {
  this.timeout(10000);

  overrideEnvsInMochaDescribe({
    ENABLE_TX_POOL: true,
    ENABLE_NONCE_ORDERING: true,
    SEND_RAW_TRANSACTION_WAIT_TIME: 0,
    SEND_RAW_TRANSACTION_POLLING_INTERVAL_MS: 0,
    SEND_RAW_TRANSACTION_POLLING_MAX_ATTEMPTS: 1,
  });

  const { restMock, ethImpl, cacheService, transactionPoolService: localTransactionPoolService } = generateEthTestEnv();
  const requestDetails = new RequestDetails({ requestId: 'ethPendingPoolConfirmationTest', ipAddress: '0.0.0.0' });
  const transactionService = ethImpl['transactionService'] as TransactionService;
  const accountService = ethImpl['accountService'];

  const wallet = Wallet.createRandom();
  const sender = wallet.address.toLowerCase();
  const confirmedBaseline = 5;

  let sandbox: sinon.SinonSandbox;
  let parsedTx: Transaction;
  let otherParsedTx: Transaction;

  // The pool service the relay services currently use; swapped for the Redis-backed variant below.
  let poolService: TransactionPoolService;

  const signTx = async (nonce: number): Promise<Transaction> =>
    Transaction.from(
      await wallet.signTransaction({
        chainId: 0x12a,
        nonce,
        to: '0x0000000000000000000000000000000000001389',
        value: 0,
        gasLimit: 21000,
        gasPrice: 1_000_000_000_000,
      }),
    );

  const contractResultFor = (tx: Transaction, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    address: '0x0000000000000000000000000000000000001389',
    amount: 0,
    bloom: constants.EMPTY_BLOOM,
    call_result: '0x',
    contract_id: '0.0.5001',
    created_contract_ids: [],
    error_message: null,
    from: sender,
    function_parameters: '0x',
    gas_limit: 21000,
    gas_used: 21000,
    timestamp: '167654.000123456',
    to: '0x0000000000000000000000000000000000001389',
    block_hash: '0xd693b532a80fed6392b428604171fb32fdbf953728a3a7ecc7d4062b1652c042000102030405060708090a0b0c0d0e0f',
    block_number: 17,
    logs: [],
    result: 'SUCCESS',
    transaction_index: 0,
    hash: tx.hash,
    status: '0x1',
    type: 0,
    nonce: tx.nonce,
    chain_id: '0x12a',
    gas_price: '0x4a817c80',
    max_fee_per_gas: '0x',
    max_priority_fee_per_gas: '0x',
    access_list: [],
    r: tx.signature!.r,
    s: tx.signature!.s,
    v: tx.signature!.v,
    ...overrides,
  });

  const mockContractResult = (tx: Transaction, overrides: Record<string, unknown> = {}): void => {
    restMock
      .onGet(`contracts/results/${tx.hash}?hbar=false`)
      .reply(200, JSON.stringify(contractResultFor(tx, overrides)));
    restMock.onGet(`contracts/results/${tx.hash}`).reply(200, JSON.stringify(contractResultFor(tx, overrides)));
  };

  const mockNoSyntheticLogs = (hash: string): void => {
    restMock
      .onGet(`contracts/results/logs?transaction.hash=${hash}&limit=100&order=asc`)
      .reply(200, JSON.stringify({ logs: [] }));
  };

  const mockSyntheticLogs = (hash: string): void => {
    restMock.onGet(`contracts/results/${hash}?hbar=false`).reply(404);
    restMock
      .onGet(`contracts/results/logs?transaction.hash=${hash}&limit=100&order=asc`)
      .reply(200, JSON.stringify({ logs: DEFAULT_LOGS_3 }));
  };

  const poll = (tx: Transaction): Promise<void> => transactionService['pollMirrorNodeAndCleanup'](tx, requestDetails);

  const expectPool = async (pending: number, confirmed: number): Promise<void> => {
    expect(await poolService.getPendingCount(sender)).to.equal(pending);
    expect(await poolService.getConfirmedCount(sender)).to.equal(confirmed);
  };

  const expectLatestNonce = async (nonce: number): Promise<void> => {
    expect(await ethImpl.getTransactionCount(sender, 'latest', requestDetails)).to.equal(`0x${nonce.toString(16)}`);
  };

  before(async () => {
    parsedTx = await signTx(confirmedBaseline);
    otherParsedTx = await signTx(confirmedBaseline + 1);
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    poolService = localTransactionPoolService;
    sandbox.stub(ethImpl['common'], 'resolveEvmAddress').callsFake(async (address) => address);
    sandbox.stub(ethImpl['common'], 'getCurrentGasPriceForBlock').resolves('0xad78ebc5ac620000');
  });

  afterEach(async () => {
    restMock.resetHandlers();
    sandbox.restore();
    await cacheService.clear();
    await localTransactionPoolService['storage'].removeAll();
  });

  /** Points both the transaction and the account service at the given pool service. */
  const usePoolService = (service: TransactionPoolService): void => {
    poolService = service;
    type WithPoolService = { transactionPoolService: TransactionPoolService };
    sandbox.replace(transactionService as unknown as WithPoolService, 'transactionPoolService', service);
    sandbox.replace(accountService as unknown as WithPoolService, 'transactionPoolService', service);
  };

  const idempotencyTests = (): void => {
    it('should confirm the pending transaction from eth_getTransactionReceipt before the Mirror Node poll runs', async () => {
      await poolService.saveTransaction(sender, parsedTx, confirmedBaseline);
      await expectPool(1, confirmedBaseline);
      await expectLatestNonce(confirmedBaseline);
      mockContractResult(parsedTx);

      const receipt = await ethImpl.getTransactionReceipt(parsedTx.hash!, requestDetails);

      expect(receipt?.transactionHash).to.equal(parsedTx.hash);
      await expectPool(0, confirmedBaseline + 1);
      await expectLatestNonce(confirmedBaseline + 1);
    });

    it('should confirm the pending transaction from eth_getTransactionByHash before the Mirror Node poll runs', async () => {
      await poolService.saveTransaction(sender, parsedTx, confirmedBaseline);
      await expectPool(1, confirmedBaseline);
      await expectLatestNonce(confirmedBaseline);
      mockContractResult(parsedTx);

      const tx = await ethImpl.getTransactionByHash(parsedTx.hash!, requestDetails);

      expect(tx?.hash).to.equal(parsedTx.hash);
      expect(tx?.blockNumber).to.equal('0x11');
      await expectPool(0, confirmedBaseline + 1);
      await expectLatestNonce(confirmedBaseline + 1);
    });

    it('should increment the confirmed count once when the receipt path runs before the poll', async () => {
      await poolService.saveTransaction(sender, parsedTx, confirmedBaseline);
      mockContractResult(parsedTx);

      await ethImpl.getTransactionReceipt(parsedTx.hash!, requestDetails);
      await poll(parsedTx);

      await expectPool(0, confirmedBaseline + 1);
      await expectLatestNonce(confirmedBaseline + 1);
    });

    it('should increment the confirmed count once when the poll runs before the receipt path', async () => {
      await poolService.saveTransaction(sender, parsedTx, confirmedBaseline);
      mockContractResult(parsedTx);

      await poll(parsedTx);
      await ethImpl.getTransactionReceipt(parsedTx.hash!, requestDetails);

      await expectPool(0, confirmedBaseline + 1);
      await expectLatestNonce(confirmedBaseline + 1);
    });

    it('should increment the confirmed count once for eth_getTransactionByHash, then the receipt, then the poll', async () => {
      await poolService.saveTransaction(sender, parsedTx, confirmedBaseline);
      mockContractResult(parsedTx);

      await ethImpl.getTransactionByHash(parsedTx.hash!, requestDetails);
      await ethImpl.getTransactionReceipt(parsedTx.hash!, requestDetails);
      await poll(parsedTx);

      await expectPool(0, confirmedBaseline + 1);
      await expectLatestNonce(confirmedBaseline + 1);
    });

    it('should increment the confirmed count once when eth_getTransactionByHash, the receipt and the poll run concurrently', async () => {
      await poolService.saveTransaction(sender, parsedTx, confirmedBaseline);
      mockContractResult(parsedTx);

      await Promise.all([
        ethImpl.getTransactionByHash(parsedTx.hash!, requestDetails),
        ethImpl.getTransactionReceipt(parsedTx.hash!, requestDetails),
        poll(parsedTx),
      ]);

      await expectPool(0, confirmedBaseline + 1);
    });

    it('should confirm a failed (status 0x0) transaction, since it consumed its nonce too', async () => {
      await poolService.saveTransaction(sender, parsedTx, confirmedBaseline);
      mockContractResult(parsedTx, {
        status: '0x0',
        result: 'CONTRACT_REVERT_EXECUTED',
        error_message: '0x',
      });

      const receipt = await ethImpl.getTransactionReceipt(parsedTx.hash!, requestDetails);

      expect(receipt?.status).to.equal(constants.ZERO_HEX);
      await expectPool(0, confirmedBaseline + 1);
    });

    it('should only confirm the transaction the receipt is for', async () => {
      await poolService.saveTransaction(sender, parsedTx, confirmedBaseline);
      await poolService.saveTransaction(sender, otherParsedTx, confirmedBaseline);
      mockContractResult(parsedTx);

      await ethImpl.getTransactionReceipt(parsedTx.hash!, requestDetails);

      await expectPool(1, confirmedBaseline + 1);
      expect(await poolService.getTransactions(sender)).to.deep.equal(new Set([otherParsedTx.serialized]));
      // pending nonce stays right: confirmed + pending
      expect(await ethImpl.getTransactionCount(sender, 'pending', requestDetails)).to.equal(
        `0x${(confirmedBaseline + 2).toString(16)}`,
      );
    });
  };

  describe('with local storage', () => {
    idempotencyTests();

    describe('eth_getTransactionReceipt', () => {
      it('should not touch the pool for a receipt of a transaction that is not in the pool', async () => {
        await poolService.saveTransaction(sender, otherParsedTx, confirmedBaseline);
        mockContractResult(parsedTx);
        const removeSpy = sandbox.spy(poolService, 'removeTransaction');

        const receipt = await ethImpl.getTransactionReceipt(parsedTx.hash!, requestDetails);

        expect(receipt?.transactionHash).to.equal(parsedTx.hash);
        expect(removeSpy.notCalled).to.be.true;
        await expectPool(1, confirmedBaseline);
      });

      it('should not touch the pool for a receipt of a sender with no pending transactions', async () => {
        mockContractResult(parsedTx);
        const removeSpy = sandbox.spy(poolService, 'removeTransaction');

        await ethImpl.getTransactionReceipt(parsedTx.hash!, requestDetails);

        expect(removeSpy.notCalled).to.be.true;
        expect(await poolService.getConfirmedCount(sender)).to.be.null;
      });

      it('should not touch the pool for a synthetic receipt', async () => {
        await poolService.saveTransaction(sender, parsedTx, confirmedBaseline);
        const syntheticHash = DEFAULT_LOGS_3[0].transaction_hash;
        mockSyntheticLogs(syntheticHash);
        const getTransactionsSpy = sandbox.spy(poolService, 'getTransactions');

        const receipt = await ethImpl.getTransactionReceipt(syntheticHash, requestDetails);

        expect(receipt).to.not.be.null;
        expect(getTransactionsSpy.notCalled).to.be.true;
        await expectPool(1, confirmedBaseline);
      });

      withOverriddenEnvsInMochaTest({ ENABLE_TX_POOL: false }, () => {
        it('should not touch the pool when the pool is disabled', async () => {
          mockContractResult(parsedTx);
          const getTransactionsSpy = sandbox.spy(poolService, 'getTransactions');
          const removeSpy = sandbox.spy(poolService, 'removeTransaction');

          const receipt = await ethImpl.getTransactionReceipt(parsedTx.hash!, requestDetails);

          expect(receipt?.transactionHash).to.equal(parsedTx.hash);
          expect(getTransactionsSpy.notCalled).to.be.true;
          expect(removeSpy.notCalled).to.be.true;
        });
      });

      it('should still return the receipt when reading the pool fails', async () => {
        mockContractResult(parsedTx);
        sandbox.stub(poolService, 'getTransactions').rejects(new Error('pool read failed'));

        const receipt = await ethImpl.getTransactionReceipt(parsedTx.hash!, requestDetails);

        expect(receipt?.transactionHash).to.equal(parsedTx.hash);
      });

      it('should still return the receipt when removing from the pool fails', async () => {
        await poolService.saveTransaction(sender, parsedTx, confirmedBaseline);
        mockContractResult(parsedTx);
        sandbox.stub(poolService, 'removeTransaction').rejects(new Error('pool removal failed'));

        const receipt = await ethImpl.getTransactionReceipt(parsedTx.hash!, requestDetails);

        expect(receipt?.transactionHash).to.equal(parsedTx.hash);
        // left for the Mirror Node poll to clean up
        await expectPool(1, confirmedBaseline);
      });
    });

    describe('eth_getTransactionByHash', () => {
      it('should not touch the pool for a synthetic transaction', async () => {
        await poolService.saveTransaction(sender, parsedTx, confirmedBaseline);
        const syntheticHash = DEFAULT_LOGS_3[0].transaction_hash;
        mockSyntheticLogs(syntheticHash);
        const getTransactionsSpy = sandbox.spy(poolService, 'getTransactions');

        const tx = await ethImpl.getTransactionByHash(syntheticHash, requestDetails);

        expect(tx).to.not.be.null;
        expect(getTransactionsSpy.notCalled).to.be.true;
        await expectPool(1, confirmedBaseline);
      });

      it('should not touch the pool for an immature (rejected) record', async () => {
        await poolService.saveTransaction(sender, parsedTx, confirmedBaseline);
        mockContractResult(parsedTx, { block_number: null, transaction_index: null, result: 'WRONG_NONCE' });
        const getTransactionsSpy = sandbox.spy(poolService, 'getTransactions');

        expect(await ethImpl.getTransactionByHash(parsedTx.hash!, requestDetails)).to.be.null;
        expect(getTransactionsSpy.notCalled).to.be.true;
        await expectPool(1, confirmedBaseline);
      });

      it('should not touch the pool when the transaction is not found', async () => {
        await poolService.saveTransaction(sender, parsedTx, confirmedBaseline);
        restMock.onGet(`contracts/results/${parsedTx.hash}?hbar=false`).reply(404);
        mockNoSyntheticLogs(parsedTx.hash!);
        const getTransactionsSpy = sandbox.spy(poolService, 'getTransactions');

        expect(await ethImpl.getTransactionByHash(parsedTx.hash!, requestDetails)).to.be.null;
        expect(getTransactionsSpy.notCalled).to.be.true;
        await expectPool(1, confirmedBaseline);
      });

      it('should not touch the pool for a transaction that is not in the pool', async () => {
        await poolService.saveTransaction(sender, otherParsedTx, confirmedBaseline);
        mockContractResult(parsedTx);
        const removeSpy = sandbox.spy(poolService, 'removeTransaction');

        const tx = await ethImpl.getTransactionByHash(parsedTx.hash!, requestDetails);

        expect(tx?.hash).to.equal(parsedTx.hash);
        expect(removeSpy.notCalled).to.be.true;
        await expectPool(1, confirmedBaseline);
      });

      withOverriddenEnvsInMochaTest({ ENABLE_TX_POOL: false }, () => {
        it('should not touch the pool when the pool is disabled', async () => {
          mockContractResult(parsedTx);
          const getTransactionsSpy = sandbox.spy(poolService, 'getTransactions');
          const removeSpy = sandbox.spy(poolService, 'removeTransaction');

          const tx = await ethImpl.getTransactionByHash(parsedTx.hash!, requestDetails);

          expect(tx?.hash).to.equal(parsedTx.hash);
          expect(getTransactionsSpy.notCalled).to.be.true;
          expect(removeSpy.notCalled).to.be.true;
        });
      });

      it('should still return the transaction when reading the pool fails', async () => {
        mockContractResult(parsedTx);
        sandbox.stub(poolService, 'getTransactions').rejects(new Error('pool read failed'));

        const tx = await ethImpl.getTransactionByHash(parsedTx.hash!, requestDetails);

        expect(tx?.hash).to.equal(parsedTx.hash);
      });

      it('should still return the transaction when removing from the pool fails', async () => {
        await poolService.saveTransaction(sender, parsedTx, confirmedBaseline);
        mockContractResult(parsedTx);
        sandbox.stub(poolService, 'removeTransaction').rejects(new Error('pool removal failed'));

        const tx = await ethImpl.getTransactionByHash(parsedTx.hash!, requestDetails);

        expect(tx?.hash).to.equal(parsedTx.hash);
        // left for the Mirror Node poll to clean up
        await expectPool(1, confirmedBaseline);
      });
    });
  });

  describe('with Redis storage', () => {
    const logger = pino({ level: 'silent' });
    let redisClient: RedisClientType;
    let redisPoolService: TransactionPoolService;

    // registered before useInMemoryRedisServer so the client quits before the server stops
    after(async () => {
      await redisClient.quit();
    });

    useInMemoryRedisServer(logger, 6393);

    before(async () => {
      redisClient = createClient({ url: 'redis://127.0.0.1:6393' });
      await redisClient.connect();
      redisPoolService = new TransactionPoolService(
        new RedisPendingTransactionStorage(redisClient),
        logger,
        new Registry(),
      );
    });

    beforeEach(async () => {
      await redisClient.flushAll();
      usePoolService(redisPoolService);
    });

    idempotencyTests();
  });
});
