// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import {
  FileAppendTransaction,
  FileId,
  FileInfo,
  Hbar,
  HbarUnit,
  Long,
  TransactionId,
  TransactionResponse,
} from '@hashgraph/sdk';
import MockAdapter from 'axios-mock-adapter';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { EventEmitter } from 'events';
import pino from 'pino';
import sinon, { useFakeTimers } from 'sinon';

import { Eth, JsonRpcError, predefined } from '../../../src';
import { formatTransactionIdWithoutQueryParams } from '../../../src/formatters';
import { SDKClient } from '../../../src/lib/clients';
import type { ICacheClient } from '../../../src/lib/clients/cache/ICacheClient';
import constants from '../../../src/lib/constants';
import { SDKClientError } from '../../../src/lib/errors/SDKClientError';
import { LockService, TransactionPoolService } from '../../../src/lib/services';
import HAPIService from '../../../src/lib/services/hapiService/hapiService';
import { HbarLimitService } from '../../../src/lib/services/hbarLimitService';
import { RequestDetails } from '../../../src/lib/types';
import { Utils } from '../../../src/utils';
import RelayAssertions from '../../assertions';
import { mockData, overrideEnvsInMochaDescribe, signTransaction, withOverriddenEnvsInMochaTest } from '../../helpers';
import { ACCOUNT_ADDRESS_1, DEFAULT_NETWORK_FEES, MAX_GAS_LIMIT_HEX, NO_TRANSACTIONS } from './eth-config';
import { generateEthTestEnv } from './eth-helpers';

use(chaiAsPromised);

let sdkClientStub: sinon.SinonStubbedInstance<SDKClient>;
let getSdkClientStub: sinon.SinonStub;

describe('@ethSendRawTransaction eth_sendRawTransaction spec', async function () {
  this.timeout(10000);
  const {
    restMock,
    hapiServiceInstance,
    ethImpl,
    cacheService,
    registry,
  }: {
    restMock: MockAdapter;
    hapiServiceInstance: HAPIService;
    ethImpl: Eth;
    cacheService: ICacheClient;
    registry: import('prom-client').Registry;
  } = generateEthTestEnv();

  const requestDetails = new RequestDetails({ requestId: 'eth_sendRawTransactionTest', ipAddress: '0.0.0.0' });
  let lockServiceStub: sinon.SinonStubbedInstance<LockService>;
  overrideEnvsInMochaDescribe({ ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE: 1 });

  this.beforeEach(async () => {
    // reset cache and restMock
    await cacheService.clear(requestDetails);
    restMock.reset();
    sdkClientStub = sinon.createStubInstance(SDKClient);
    getSdkClientStub = sinon.stub(hapiServiceInstance, 'getSDKClient').returns(sdkClientStub);
    restMock.onGet('network/fees').reply(200, JSON.stringify(DEFAULT_NETWORK_FEES));
    const txPoolServiceWithMockedStorage = new TransactionPoolService(
      {
        getList: sinon.stub(),
        addToList: sinon.stub(),
        removeFromList: sinon.stub(),
        removeAll: sinon.stub(),
        getSetSize: sinon.stub(),
      },
      pino({ level: 'silent' }),
      registry,
    );
    ethImpl['transactionService']['precheck']['transactionPoolService'] = txPoolServiceWithMockedStorage;
    ethImpl['transactionService']['transactionPoolService'] = txPoolServiceWithMockedStorage;
  });

  this.afterEach(() => {
    getSdkClientStub.restore();
    restMock.resetHandlers();
  });

  describe('eth_sendRawTransaction', async function () {
    let clock: any;
    const accountAddress = '0x9eaee9E66efdb91bfDcF516b034e001cc535EB57';
    const accountEndpoint = `accounts/${accountAddress}${NO_TRANSACTIONS}`;
    const receiverAccountEndpoint = `accounts/${ACCOUNT_ADDRESS_1}${NO_TRANSACTIONS}`;
    const gasPrice = '0xad78ebc5ac620000';
    const transactionIdServicesFormat = '0.0.902@1684375868.230217103';
    const transactionId = '0.0.902-1684375868-230217103';
    const value = '0x511617DE831B9E173';
    const contractResultEndpoint = `contracts/results/${transactionId}`;
    const networkExchangeRateEndpoint = 'network/exchangerate';
    const ethereumHash = '0x6d20b034eecc8d455c4c040fb3763082d499353a8b7d318b1085ad8d7de15f7e';
    const mockedExchangeRate = {
      current_rate: {
        cent_equivalent: 12,
        expiration_time: 4102444800,
        hbar_equivalent: 1,
      },
    };
    const transaction = {
      chainId: Number(ConfigService.get('CHAIN_ID')),
      to: ACCOUNT_ADDRESS_1,
      from: accountAddress,
      value,
      gasPrice,
      gasLimit: MAX_GAS_LIMIT_HEX,
    };
    const ACCOUNT_RES = {
      account: accountAddress,
      balance: {
        balance: Hbar.from(100_000_000_000, HbarUnit.Hbar).to(HbarUnit.Tinybar),
      },
      ethereum_nonce: 0,
    };
    const RECEIVER_ACCOUNT_RES = {
      account: ACCOUNT_ADDRESS_1,
      balance: {
        balance: Hbar.from(1, HbarUnit.Hbar).to(HbarUnit.Tinybar),
      },
      ethereum_nonce: 0,
      receiver_sig_required: false,
    };
    const useAsyncTxProcessing = ConfigService.get('USE_ASYNC_TX_PROCESSING');

    beforeEach(() => {
      clock = useFakeTimers();
      sinon.restore();
      sdkClientStub = sinon.createStubInstance(SDKClient);
      sinon.stub(hapiServiceInstance, 'getSDKClient').returns(sdkClientStub);
      restMock.onGet(accountEndpoint).reply(200, JSON.stringify(ACCOUNT_RES));
      JSON.stringify(restMock.onGet(receiverAccountEndpoint).reply(200, JSON.stringify(RECEIVER_ACCOUNT_RES)));
      JSON.stringify(restMock.onGet(networkExchangeRateEndpoint).reply(200, JSON.stringify(mockedExchangeRate)));
      lockServiceStub = sinon.createStubInstance(LockService);

      // Replace the lock service with our stub
      ethImpl['transactionService']['lockService'] = lockServiceStub;
      lockServiceStub.acquireLock.resolves();
    });

    afterEach(() => {
      sinon.restore();
      clock.restore();
    });

    withOverriddenEnvsInMochaTest({ JUMBO_TX_ENABLED: false }, () => {
      it('should emit tracking event (limiter and metrics) only for successful tx responses from FileAppend transaction', async function () {
        const signed = await signTransaction({
          ...transaction,
          data: '0x' + '22'.repeat(13000),
        });
        const expectedTxHash = Utils.computeTransactionHash(Buffer.from(signed.replace('0x', ''), 'hex'));

        const FILE_ID = new FileId(0, 0, 5644);
        const sdkClientInternals = sdkClientStub as unknown as Record<string, any>;
        const enableCallThrough = (
          method: 'submitEthereumTransaction' | 'createFile' | 'executeAllTransaction',
        ): void => {
          (sdkClientInternals[method] as sinon.SinonStub).callsFake(function (this: SDKClient, ...args: unknown[]) {
            return (SDKClient.prototype[method] as unknown as (...methodArgs: unknown[]) => unknown).apply(this, args);
          });
        };
        enableCallThrough('submitEthereumTransaction');
        enableCallThrough('createFile');
        enableCallThrough('executeAllTransaction');

        sdkClientInternals.fileAppendChunkSize = 2048;
        sdkClientInternals.clientMain = { operatorAccountId: '', operatorKey: null };
        sdkClientInternals.logger = pino({ level: 'silent' });

        const fileInfoMock = { size: new Long(26000) } as unknown as FileInfo;
        (sdkClientInternals.executeQuery as sinon.SinonStub).resolves(fileInfoMock);

        // simulates error after first append by returning only one transaction response
        sinon
          .stub(FileAppendTransaction.prototype, 'executeAll')
          .resolves([{ transactionId: TransactionId.fromString(transactionIdServicesFormat) } as TransactionResponse]);

        const eventEmitterMock = sinon.createStubInstance(EventEmitter);
        sdkClientInternals.eventEmitter = eventEmitterMock;

        const hbarLimiterMock = sinon.createStubInstance(HbarLimitService);
        sdkClientInternals.hbarLimitService = hbarLimiterMock;

        const txResponseMock = sinon.createStubInstance(TransactionResponse);
        (sdkClientInternals.executeTransaction as sinon.SinonStub).resolves(txResponseMock);

        txResponseMock.getReceipt
          .onFirstCall()
          .resolves({ fileId: FILE_ID } as unknown as import('@hashgraph/sdk').TransactionReceipt);
        Object.assign(txResponseMock, {
          transactionId: TransactionId.fromString(transactionIdServicesFormat),
        });

        (sdkClientInternals.deleteFile as sinon.SinonStub).resolves();

        restMock.onGet(contractResultEndpoint).reply(200, JSON.stringify({ hash: expectedTxHash }));

        const resultingHash = await ethImpl.sendRawTransaction(signed, requestDetails);
        if (useAsyncTxProcessing) await clock.tickAsync(1);

        expect(eventEmitterMock.emit.callCount).to.equal(1);
        expect(hbarLimiterMock.shouldLimit.callCount).to.equal(1);
        expect(resultingHash).to.equal(expectedTxHash);
      });
    });

    it('should return a predefined GAS_LIMIT_TOO_HIGH instead of NUMERIC_FAULT as precheck exception', async function () {
      // tx with 'gasLimit: BigNumber { value: "30678687678687676876786786876876876000" }'
      const tx =
        '0x02f881820128048459682f0086014fa0186f00901714801554cbe52dd95512bedddf68e09405fba803be258049a27b820088bab1cad205887185174876e80080c080a0cab3f53602000c9989be5787d0db637512acdd2ad187ce15ba83d10d9eae2571a07802515717a5a1c7d6fa7616183eb78307b4657d7462dbb9e9deca820dd28f62';
      await RelayAssertions.assertRejection(
        predefined.GAS_LIMIT_TOO_HIGH(null, null),
        ethImpl.sendRawTransaction,
        false,
        ethImpl,
        [tx, requestDetails],
      );
    });

    it('should return a predefined INVALID_ARGUMENTS when transaction has invalid format', async function () {
      // signature has been truncated
      await RelayAssertions.assertRejection(
        predefined.INVALID_ARGUMENTS('unexpected junk after rlp payload'),
        ethImpl.sendRawTransaction,
        false,
        ethImpl,
        [constants.INVALID_TRANSACTION, requestDetails],
      );
    });

    it('should return a computed hash if unable to retrieve EthereumHash from record due to contract revert', async function () {
      const signed = await signTransaction(transaction);

      restMock.onGet(contractResultEndpoint).reply(200, JSON.stringify({ hash: ethereumHash }));

      const resultingHash = await ethImpl.sendRawTransaction(signed, requestDetails);
      expect(resultingHash).to.equal(ethereumHash);
    });

    it('should return hash from ContractResult mirror node api', async function () {
      restMock.onGet(contractResultEndpoint).reply(200, JSON.stringify({ hash: ethereumHash }));

      sdkClientStub.submitEthereumTransaction.resolves({
        txResponse: {
          transactionId: TransactionId.fromString(transactionIdServicesFormat),
        } as unknown as TransactionResponse,
        fileId: null,
      });
      const signed = await signTransaction(transaction);

      const resultingHash = await ethImpl.sendRawTransaction(signed, requestDetails);
      expect(resultingHash).to.equal(ethereumHash);
    });

    it('should not send second transaction upon succession', async function () {
      restMock.onGet(contractResultEndpoint).reply(200, JSON.stringify({ hash: ethereumHash }));

      sdkClientStub.submitEthereumTransaction.resolves({
        txResponse: {
          transactionId: TransactionId.fromString(transactionIdServicesFormat),
        } as unknown as TransactionResponse,
        fileId: null,
      });

      const signed = await signTransaction(transaction);

      const resultingHash = await ethImpl.sendRawTransaction(signed, requestDetails);
      if (useAsyncTxProcessing) await clock.tickAsync(1);

      expect(resultingHash).to.equal(ethereumHash);
      sinon.assert.calledOnce(sdkClientStub.submitEthereumTransaction);
    });

    it('should not send second transaction on error different from timeout', async function () {
      restMock.onGet(contractResultEndpoint).reply(200, JSON.stringify({ hash: ethereumHash }));
      const repeatedRequestSpy = sinon.spy((ethImpl as any).transactionService.mirrorNodeClient, 'repeatedRequest');
      sdkClientStub.submitEthereumTransaction.resolves({
        txResponse: {
          transactionId: TransactionId.fromString(transactionIdServicesFormat),
        } as unknown as TransactionResponse,
        fileId: null,
      });

      const signed = await signTransaction(transaction);

      const resultingHash = await ethImpl.sendRawTransaction(signed, requestDetails);
      const mirrorNodeRetry = 10;
      const newRequestDetails = { ...requestDetails, ipAddress: constants.MASKED_IP_ADDRESS };
      const formattedTransactionId = formatTransactionIdWithoutQueryParams(transactionIdServicesFormat);

      await clock.tickAsync(1);
      expect(resultingHash).to.equal(ethereumHash);
      sinon.assert.calledOnce(sdkClientStub.submitEthereumTransaction);
      sinon.assert.calledOnceWithExactly(
        repeatedRequestSpy,
        'getContractResult',
        [formattedTransactionId, newRequestDetails],
        mirrorNodeRetry,
      );
    });

    it('should throw precheck error for type=3 transactions', async function () {
      const type3tx = {
        ...transaction,
        type: 3,
        maxFeePerBlobGas: transaction.gasPrice,
        blobVersionedHashes: [ethereumHash],
      };
      const signed = await signTransaction(type3tx);

      await RelayAssertions.assertRejection(
        predefined.UNSUPPORTED_TRANSACTION_TYPE_3,
        ethImpl.sendRawTransaction,
        false,
        ethImpl,
        [signed, requestDetails],
      );
    });

    withOverriddenEnvsInMochaTest({ USE_ASYNC_TX_PROCESSING: false }, () => {
      withOverriddenEnvsInMochaTest({ ENABLE_TX_POOL: true }, () => {
        it('should save and remove transaction from transaction pool on success path', async function () {
          const signed = await signTransaction(transaction);
          const txPool = ethImpl['transactionService']['transactionPoolService'] as any;

          const saveStub = sinon.stub(txPool, 'saveTransaction').resolves();
          const removeStub = sinon.stub(txPool, 'removeTransaction').resolves();
          sinon.stub(txPool, 'getPendingCount').resolves(0);
          restMock.onGet(contractResultEndpoint).reply(200, JSON.stringify({ hash: ethereumHash }));
          sdkClientStub.submitEthereumTransaction.resolves({
            txResponse: {
              transactionId: TransactionId.fromString(transactionIdServicesFormat),
            } as unknown as TransactionResponse,
            fileId: null,
          });

          const result = await ethImpl.sendRawTransaction(signed, requestDetails);

          expect(result).to.equal(ethereumHash);
          sinon.assert.calledOnce(saveStub);
          sinon.assert.calledWithMatch(saveStub, accountAddress, sinon.match.object);

          sinon.assert.calledOnce(removeStub);
          sinon.assert.calledWith(removeStub, accountAddress, signed);

          saveStub.restore();
          removeStub.restore();
        });

        it('should save and remove transaction (fallback path uses parsedTx.serialized)', async function () {
          const signed = await signTransaction(transaction);
          const txPool = ethImpl['transactionService']['transactionPoolService'] as any;

          const saveStub = sinon.stub(txPool, 'saveTransaction').resolves();
          const removeStub = sinon.stub(txPool, 'removeTransaction').resolves();
          sinon.stub(txPool, 'getPendingCount').resolves(0);

          // Cause MN polling to fail, forcing fallback
          restMock.onGet(contractResultEndpoint).reply(404, JSON.stringify(mockData.notFound));
          sdkClientStub.submitEthereumTransaction.resolves({
            txResponse: {
              transactionId: TransactionId.fromString(transactionIdServicesFormat),
            } as unknown as TransactionResponse,
            fileId: null,
          });

          await ethImpl.sendRawTransaction(signed, requestDetails);

          sinon.assert.calledOnce(saveStub);
          sinon.assert.calledWithMatch(saveStub, accountAddress, sinon.match.object);

          sinon.assert.calledOnce(removeStub);
          sinon.assert.calledWith(removeStub, accountAddress, signed);

          saveStub.restore();
          removeStub.restore();
        });
      });

      it('[USE_ASYNC_TX_PROCESSING=true] should throw internal error when transaction returned from mirror node is null', async function () {
        const signed = await signTransaction(transaction);

        restMock.onGet(contractResultEndpoint).reply(404, JSON.stringify(mockData.notFound));

        sdkClientStub.submitEthereumTransaction.resolves({
          txResponse: {
            transactionId: transactionIdServicesFormat,
          } as unknown as TransactionResponse,
          fileId: null,
        });

        const response = (await ethImpl.sendRawTransaction(signed, requestDetails)) as JsonRpcError;

        expect(response.code).to.equal(predefined.INTERNAL_ERROR().code);
        expect(`Error invoking RPC: ${response.message}`).to.equal(predefined.INTERNAL_ERROR(response.message).message);
      });

      it('[USE_ASYNC_TX_PROCESSING=false] should throw internal error when transactionID is invalid', async function () {
        const signed = await signTransaction(transaction);

        restMock.onGet(contractResultEndpoint).reply(200, JSON.stringify({ hash: ethereumHash }));

        sdkClientStub.submitEthereumTransaction.resolves({
          txResponse: {
            transactionId: '',
          } as unknown as TransactionResponse,
          fileId: null,
        });

        const response = (await ethImpl.sendRawTransaction(signed, requestDetails)) as JsonRpcError;

        expect(response.code).to.equal(predefined.INTERNAL_ERROR().code);
        expect(`Error invoking RPC: ${response.message}`).to.equal(predefined.INTERNAL_ERROR(response.message).message);
      });

      it('[USE_ASYNC_TX_PROCESSING=false] should throw internal error if ContractResult from mirror node contains a null hash', async function () {
        restMock.onGet(contractResultEndpoint).reply(200, JSON.stringify({ hash: null }));

        sdkClientStub.submitEthereumTransaction.resolves({
          txResponse: {
            transactionId: TransactionId.fromString(transactionIdServicesFormat),
          } as unknown as TransactionResponse,
          fileId: null,
        });
        const signed = await signTransaction(transaction);

        const response = await ethImpl.sendRawTransaction(signed, requestDetails);

        expect(response).to.be.instanceOf(JsonRpcError);
        expect((response as JsonRpcError).message).to.include(`Transaction returned a null transaction hash`);
      });

      ['timeout exceeded', 'Connection dropped'].forEach((error) => {
        it(`[USE_ASYNC_TX_PROCESSING=false] should poll mirror node upon ${error} error for valid transaction and return correct transaction hash`, async function () {
          restMock
            .onGet(contractResultEndpoint)
            .replyOnce(404, mockData.notFound)
            .onGet(contractResultEndpoint)
            .reply(200, JSON.stringify({ hash: ethereumHash }));

          sdkClientStub.submitEthereumTransaction
            .onCall(0)
            .throws(new SDKClientError({ status: 21 }, error, transactionIdServicesFormat));

          const signed = await signTransaction(transaction);

          const resultingHash = await ethImpl.sendRawTransaction(signed, requestDetails);
          expect(resultingHash).to.equal(ethereumHash);
        });

        it(`[USE_ASYNC_TX_PROCESSING=false] should poll mirror node upon ${error} error for valid transaction and return correct ${error} error if no transaction is found`, async function () {
          restMock
            .onGet(contractResultEndpoint)
            .replyOnce(404, mockData.notFound)
            .onGet(contractResultEndpoint)
            .reply(200, JSON.stringify(null));

          sdkClientStub.submitEthereumTransaction
            .onCall(0)
            .throws(new SDKClientError({ status: 21 }, error, transactionIdServicesFormat));

          const signed = await signTransaction(transaction);

          const response = (await ethImpl.sendRawTransaction(signed, requestDetails)) as JsonRpcError;
          expect(response).to.be.instanceOf(JsonRpcError);
          expect(response.message).to.include(error);
        });
      });
    });

    withOverriddenEnvsInMochaTest({ USE_ASYNC_TX_PROCESSING: true }, () => {
      it('[USE_ASYNC_TX_PROCESSING=true] should still return expected transaction hash even when transaction returned from mirror node is null', async function () {
        const signed = await signTransaction(transaction);

        restMock.onGet(contractResultEndpoint).reply(404, JSON.stringify(mockData.notFound));

        sdkClientStub.submitEthereumTransaction.resolves({
          txResponse: {
            transactionId: transactionIdServicesFormat,
          } as unknown as TransactionResponse,
          fileId: null,
        });

        const response = await ethImpl.sendRawTransaction(signed, requestDetails);
        expect(response).to.equal(ethereumHash);
      });

      it('[USE_ASYNC_TX_PROCESSING=true] should still return expected transaction hash even when submitted transactionID is invalid', async function () {
        const signed = await signTransaction(transaction);

        restMock.onGet(contractResultEndpoint).reply(200, JSON.stringify({ hash: ethereumHash }));

        sdkClientStub.submitEthereumTransaction.resolves({
          txResponse: {
            transactionId: '',
          } as unknown as TransactionResponse,
          fileId: null,
        });

        const response = await ethImpl.sendRawTransaction(signed, requestDetails);
        expect(response).to.equal(ethereumHash);
      });

      it('[USE_ASYNC_TX_PROCESSING=true] should still return expected transaction hash even when ContractResult from mirror node contains a null hash', async function () {
        restMock.onGet(contractResultEndpoint).reply(200, JSON.stringify({ hash: null }));

        sdkClientStub.submitEthereumTransaction.resolves({
          txResponse: {
            transactionId: TransactionId.fromString(transactionIdServicesFormat),
          } as unknown as TransactionResponse,
          fileId: null,
        });
        const signed = await signTransaction(transaction);

        const response = await ethImpl.sendRawTransaction(signed, requestDetails);
        expect(response).to.equal(ethereumHash);
      });

      ['timeout exceeded', 'Connection dropped'].forEach((error) => {
        it(`[USE_ASYNC_TX_PROCESSING=true] should still return expected transaction hash even when hit ${error} error`, async function () {
          restMock
            .onGet(contractResultEndpoint)
            .replyOnce(404, mockData.notFound)
            .onGet(contractResultEndpoint)
            .reply(200, JSON.stringify({ hash: ethereumHash }));

          sdkClientStub.submitEthereumTransaction
            .onCall(0)
            .throws(new SDKClientError({ status: 21 }, error, transactionIdServicesFormat));

          const signed = await signTransaction(transaction);

          const resultingHash = await ethImpl.sendRawTransaction(signed, requestDetails);
          expect(resultingHash).to.equal(ethereumHash);
        });
      });
    });

    withOverriddenEnvsInMochaTest({ READ_ONLY: true }, () => {
      [false, true].forEach((useAsyncTxProcessing) => {
        withOverriddenEnvsInMochaTest({ USE_ASYNC_TX_PROCESSING: useAsyncTxProcessing }, () => {
          [
            { title: 'ill-formatted', transaction: constants.INVALID_TRANSACTION },
            {
              title: 'failed precheck',
              transaction:
                '0x02f881820128048459682f0086014fa0186f00901714801554cbe52dd95512bedddf68e09405fba803be258049a27b820088bab1cad205887185174876e80080c080a0cab3f53602000c9989be5787d0db637512acdd2ad187ce15ba83d10d9eae2571a07802515717a5a1c7d6fa7616183eb78307b4657d7462dbb9e9deca820dd28f62',
            },
            { title: 'valid', transaction },
          ].forEach(({ title, transaction }) => {
            it(`should throw \`UNSUPPORTED_OPERATION\` when Relay is in Read-Only mode for a '${title}' transaction`, async function () {
              const signed = typeof transaction === 'string' ? transaction : await signTransaction(transaction);
              await RelayAssertions.assertRejection(
                predefined.UNSUPPORTED_OPERATION('Relay is in read-only mode'),
                ethImpl.sendRawTransaction,
                false,
                ethImpl,
                [signed, requestDetails],
              );
            });
          });
        });
      });
    });

    describe('Lock Release Error Handling', () => {
      let loggerErrorStub: sinon.SinonStub;
      overrideEnvsInMochaDescribe({ ENABLE_NONCE_ORDERING: true });
      beforeEach(() => {
        loggerErrorStub = sinon.stub(ethImpl['transactionService']['logger'], 'error');
      });

      afterEach(() => {
        loggerErrorStub.restore();
      });

      describe('Validation Error Path', () => {
        it('should preserve original validation error when lock release fails', async function () {
          const transaction = {
            chainId: Number(ConfigService.get('CHAIN_ID')),
            to: ACCOUNT_ADDRESS_1,
            from: accountAddress,
            value: '0x1',
            gasPrice: '0x1', // Too low - will fail validation
            gasLimit: MAX_GAS_LIMIT_HEX,
            nonce: 0,
          };
          const signed = await signTransaction(transaction);

          // Mock account data
          restMock.onGet(accountEndpoint).reply(200, JSON.stringify(ACCOUNT_RES));
          restMock.onGet(receiverAccountEndpoint).reply(200, JSON.stringify(RECEIVER_ACCOUNT_RES));
          restMock.onGet(networkExchangeRateEndpoint).reply(200, JSON.stringify(mockedExchangeRate));

          // Simulate successful lock acquisition
          lockServiceStub.acquireLock.resolves('test-session-key-123');

          // Simulate lock release failure
          lockServiceStub.releaseLock.resolves();

          await expect(ethImpl.sendRawTransaction(signed, requestDetails)).to.be.rejectedWith(
            "Value can't be non-zero and less than 10_000_000_000 wei which is 1 tinybar",
          );

          // Verify lock was acquired
          sinon.assert.calledOnce(lockServiceStub.acquireLock);
          sinon.assert.calledWith(lockServiceStub.acquireLock, accountAddress);

          // Verify lock release was attempted
          sinon.assert.calledOnce(lockServiceStub.releaseLock);
          sinon.assert.calledWith(lockServiceStub.releaseLock, accountAddress, 'test-session-key-123');
        });

        it('should preserve original precheck error when lock release fails', async function () {
          const transaction = {
            chainId: Number(ConfigService.get('CHAIN_ID')),
            to: ACCOUNT_ADDRESS_1,
            from: accountAddress,
            value: '0x2386f26fc10000', // Large value
            gasPrice,
            gasLimit: MAX_GAS_LIMIT_HEX,
            nonce: 0,
          };
          const signed = await signTransaction(transaction);

          // Mock insufficient balance
          const poorAccount = {
            ...ACCOUNT_RES,
            balance: { balance: 1000 }, // Very low balance
          };
          restMock.onGet(accountEndpoint).reply(200, JSON.stringify(poorAccount));
          restMock.onGet(receiverAccountEndpoint).reply(200, JSON.stringify(RECEIVER_ACCOUNT_RES));
          restMock.onGet(networkExchangeRateEndpoint).reply(200, JSON.stringify(mockedExchangeRate));

          lockServiceStub.acquireLock.resolves('test-session-key-456');
          lockServiceStub.releaseLock.resolves();

          await expect(ethImpl.sendRawTransaction(signed, requestDetails)).to.be.rejectedWith(
            JsonRpcError,
            'Insufficient funds',
          );

          // Verify lock was acquired
          sinon.assert.calledOnce(lockServiceStub.acquireLock);
          sinon.assert.calledWith(lockServiceStub.acquireLock, accountAddress);

          // Verify lock release was attempted despite failure
          sinon.assert.calledOnce(lockServiceStub.releaseLock);
        });

        it('should successfully release lock when validation fails and lock service works', async function () {
          const transaction = {
            chainId: Number(ConfigService.get('CHAIN_ID')),
            to: ACCOUNT_ADDRESS_1,
            from: accountAddress,
            value: '0x1',
            gasPrice: '0x1', // Too low
            gasLimit: MAX_GAS_LIMIT_HEX,
            nonce: 0,
          };
          const signed = await signTransaction(transaction);

          restMock.onGet(accountEndpoint).reply(200, JSON.stringify(ACCOUNT_RES));
          restMock.onGet(receiverAccountEndpoint).reply(200, JSON.stringify(RECEIVER_ACCOUNT_RES));
          restMock.onGet(networkExchangeRateEndpoint).reply(200, JSON.stringify(mockedExchangeRate));

          lockServiceStub.acquireLock.resolves('test-session-key-success');
          lockServiceStub.releaseLock.resolves(); // Successful release

          await expect(ethImpl.sendRawTransaction(signed, requestDetails)).to.be.rejectedWith(
            JsonRpcError,
            "Value can't be non-zero and less than 10_000_000_000 wei which is 1 tinybar",
          );
          // Verify lock was properly released
          sinon.assert.calledOnce(lockServiceStub.releaseLock);
          sinon.assert.calledWith(lockServiceStub.releaseLock, accountAddress, 'test-session-key-success');
        });
      });

      describe('Successful Transaction Path', () => {
        it('should acquire lock and pass lockSessionKey to processor without releasing', async function () {
          const signed = await signTransaction(transaction);

          // Mock successful flow
          restMock.onGet(accountEndpoint).reply(200, JSON.stringify(ACCOUNT_RES));
          restMock.onGet(receiverAccountEndpoint).reply(200, JSON.stringify(RECEIVER_ACCOUNT_RES));
          restMock.onGet(networkExchangeRateEndpoint).reply(200, JSON.stringify(mockedExchangeRate));
          restMock.onGet(contractResultEndpoint).reply(200, JSON.stringify({ hash: ethereumHash }));

          lockServiceStub.acquireLock.resolves('test-session-key-success');
          lockServiceStub.releaseLock.resolves(); // Won't be called in sendRawTransaction

          sdkClientStub.submitEthereumTransaction.resolves({
            txResponse: {
              transactionId: TransactionId.fromString(transactionIdServicesFormat),
            } as unknown as TransactionResponse,
            fileId: null,
          });

          const result = await ethImpl.sendRawTransaction(signed, requestDetails);

          expect(result).to.equal(ethereumHash);

          // Verify lock was acquired
          sinon.assert.calledOnce(lockServiceStub.acquireLock);
          sinon.assert.calledWith(lockServiceStub.acquireLock, accountAddress);

          // Verify lock was NOT released in sendRawTransaction
          // (it should be released later in the chain, in sdkClient.executeTransaction)
          sinon.assert.notCalled(lockServiceStub.releaseLock);

          // Verify no error logs
          sinon.assert.notCalled(loggerErrorStub);
        });

        withOverriddenEnvsInMochaTest({ ENABLE_NONCE_ORDERING: false }, () => {
          it('should not get session key when ENABLE_NONCE_ORDERING is disabled', async function () {
            const signed = await signTransaction(transaction);

            // Mock successful flow
            restMock.onGet(accountEndpoint).reply(200, JSON.stringify(ACCOUNT_RES));
            restMock.onGet(receiverAccountEndpoint).reply(200, JSON.stringify(RECEIVER_ACCOUNT_RES));
            restMock.onGet(networkExchangeRateEndpoint).reply(200, JSON.stringify(mockedExchangeRate));
            restMock.onGet(contractResultEndpoint).reply(200, JSON.stringify({ hash: ethereumHash }));

            sdkClientStub.submitEthereumTransaction.resolves({
              txResponse: {
                transactionId: TransactionId.fromString(transactionIdServicesFormat),
              } as unknown as TransactionResponse,
              fileId: null,
            });

            const result = await ethImpl.sendRawTransaction(signed, requestDetails);

            expect(result).to.equal(ethereumHash);

            // Verify lock was NOT acquired when feature is disabled
            sinon.assert.calledOnce(lockServiceStub.acquireLock);
            const returnValue = await lockServiceStub.acquireLock.getCall(0).returnValue;
            expect(returnValue).to.equal(undefined);
            sinon.assert.notCalled(lockServiceStub.releaseLock);
          });
        });
      });
    });

    describe('Consensus Submission Lock Release', () => {
      overrideEnvsInMochaDescribe({ ENABLE_NONCE_ORDERING: true });

      let lockServiceStub: sinon.SinonStubbedInstance<LockService>;
      let sendRawTransactionProcessorSpy: sinon.SinonSpy;

      beforeEach(() => {
        lockServiceStub = sinon.createStubInstance(LockService);
        ethImpl['transactionService']['lockService'] = lockServiceStub;
        sendRawTransactionProcessorSpy = sinon.spy(ethImpl['transactionService'], 'sendRawTransactionProcessor');
      });

      afterEach(() => {
        sendRawTransactionProcessorSpy.restore();
      });

      it('should release lock immediately after consensus submission succeeds', async function () {
        const signed = await signTransaction(transaction);
        const computeHashSpy = sinon.spy(Utils, 'computeTransactionHash');

        try {
          // Mock successful flow
          restMock.onGet(accountEndpoint).reply(200, JSON.stringify(ACCOUNT_RES));
          restMock.onGet(receiverAccountEndpoint).reply(200, JSON.stringify(RECEIVER_ACCOUNT_RES));
          restMock.onGet(networkExchangeRateEndpoint).reply(200, JSON.stringify(mockedExchangeRate));
          restMock.onGet(contractResultEndpoint).reply(200, JSON.stringify({ hash: ethereumHash }));

          lockServiceStub.acquireLock.resolves('session-after-consensus-1');
          lockServiceStub.releaseLock.resolves();

          sdkClientStub.submitEthereumTransaction.resolves({
            txResponse: {
              transactionId: TransactionId.fromString(transactionIdServicesFormat),
            } as unknown as TransactionResponse,
            fileId: null,
          });

          const result = await ethImpl.sendRawTransaction(signed, requestDetails);

          // In async mode, wait for background processing to complete
          if (useAsyncTxProcessing) {
            await clock.tickAsync(1);
          }

          expect(result).to.equal(ethereumHash);

          // Verify lock was released after submitEthereumTransaction
          sinon.assert.calledOnce(lockServiceStub.releaseLock);
          sinon.assert.calledWith(lockServiceStub.releaseLock, accountAddress, 'session-after-consensus-1');

          expect(sdkClientStub.submitEthereumTransaction.calledBefore(lockServiceStub.releaseLock)).to.be.true;

          // In async mode, verify computeHash was called before lock release
          if (useAsyncTxProcessing) {
            sinon.assert.calledOnce(computeHashSpy);
            expect(sendRawTransactionProcessorSpy.calledBefore(computeHashSpy)).to.be.true;
            expect(computeHashSpy.calledBefore(lockServiceStub.releaseLock)).to.be.true;
          }
        } finally {
          computeHashSpy.restore();
        }
      });

      it('should release lock even when mirror node polling fails after consensus', async function () {
        const signed = await signTransaction(transaction);

        // Mock successful consensus but failed mirror node polling
        restMock.onGet(accountEndpoint).reply(200, JSON.stringify(ACCOUNT_RES));
        restMock.onGet(receiverAccountEndpoint).reply(200, JSON.stringify(RECEIVER_ACCOUNT_RES));
        restMock.onGet(networkExchangeRateEndpoint).reply(200, JSON.stringify(mockedExchangeRate));
        restMock.onGet(contractResultEndpoint).reply(404, JSON.stringify(mockData.notFound));

        lockServiceStub.acquireLock.resolves('session-mn-fail');
        lockServiceStub.releaseLock.resolves();

        sdkClientStub.submitEthereumTransaction.resolves({
          txResponse: {
            transactionId: TransactionId.fromString(transactionIdServicesFormat),
          } as unknown as TransactionResponse,
          fileId: null,
        });

        const result = await ethImpl.sendRawTransaction(signed, requestDetails);
        if (useAsyncTxProcessing) await clock.tickAsync(1);
        // Should return txHash because of async processing
        expect(result).to.equal(ethereumHash);

        // Verify lock was released despite MN polling failure
        sinon.assert.calledOnce(lockServiceStub.releaseLock);
        sinon.assert.calledWith(lockServiceStub.releaseLock, accountAddress, 'session-mn-fail');
      });

      it('should not release lock when lockSessionKey is undefined', async function () {
        const signed = await signTransaction(transaction);

        // Mock successful flow
        restMock.onGet(accountEndpoint).reply(200, JSON.stringify(ACCOUNT_RES));
        restMock.onGet(receiverAccountEndpoint).reply(200, JSON.stringify(RECEIVER_ACCOUNT_RES));
        restMock.onGet(networkExchangeRateEndpoint).reply(200, JSON.stringify(mockedExchangeRate));
        restMock.onGet(contractResultEndpoint).reply(200, JSON.stringify({ hash: ethereumHash }));

        // Lock acquisition returns undefined (lock not acquired)
        lockServiceStub.acquireLock.resolves(undefined as any);
        lockServiceStub.releaseLock.resolves();

        sdkClientStub.submitEthereumTransaction.resolves({
          txResponse: {
            transactionId: TransactionId.fromString(transactionIdServicesFormat),
          } as unknown as TransactionResponse,
          fileId: null,
        });

        const result = await ethImpl.sendRawTransaction(signed, requestDetails);

        expect(result).to.equal(ethereumHash);

        // Verify lock release was NOT attempted
        sinon.assert.notCalled(lockServiceStub.releaseLock);
      });

      withOverriddenEnvsInMochaTest({ USE_ASYNC_TX_PROCESSING: false }, () => {
        it('should release lock during synchronous processing when async mode is disabled', async function () {
          const signed = await signTransaction(transaction);
          const computeHashSpy = sinon.spy(Utils, 'computeTransactionHash');

          try {
            // Mock successful flow
            restMock.onGet(accountEndpoint).reply(200, JSON.stringify(ACCOUNT_RES));
            restMock.onGet(receiverAccountEndpoint).reply(200, JSON.stringify(RECEIVER_ACCOUNT_RES));
            restMock.onGet(networkExchangeRateEndpoint).reply(200, JSON.stringify(mockedExchangeRate));
            restMock.onGet(contractResultEndpoint).reply(200, JSON.stringify({ hash: ethereumHash }));

            lockServiceStub.acquireLock.resolves('session-sync');
            lockServiceStub.releaseLock.resolves();

            sdkClientStub.submitEthereumTransaction.resolves({
              txResponse: {
                transactionId: TransactionId.fromString(transactionIdServicesFormat),
              } as unknown as TransactionResponse,
              fileId: null,
            });

            const result = await ethImpl.sendRawTransaction(signed, requestDetails);

            // Should return hash from mirror node (not computed)
            expect(result).to.equal(ethereumHash);
            sinon.assert.notCalled(computeHashSpy);
            // Verify lock was released during synchronous execution (no need to tick clock)
            sinon.assert.calledOnce(lockServiceStub.releaseLock);
            sinon.assert.calledWith(lockServiceStub.releaseLock, accountAddress, 'session-sync');

            expect(sdkClientStub.submitEthereumTransaction.calledBefore(lockServiceStub.releaseLock)).to.be.true;
          } finally {
            computeHashSpy.restore();
          }
        });
      });
    });
  });
});
