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
import constants from '../../../src/lib/constants';
import { SDKClientError } from '../../../src/lib/errors/SDKClientError';
import { CacheService } from '../../../src/lib/services/cacheService/cacheService';
import HAPIService from '../../../src/lib/services/hapiService/hapiService';
import { HbarLimitService } from '../../../src/lib/services/hbarLimitService';
import { RequestDetails } from '../../../src/lib/types';
import { Utils } from '../../../src/utils';
import RelayAssertions from '../../assertions';
import {
  getRequestId,
  mockData,
  overrideEnvsInMochaDescribe,
  signTransaction,
  withOverriddenEnvsInMochaTest,
} from '../../helpers';
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
  }: {
    restMock: MockAdapter;
    hapiServiceInstance: HAPIService;
    ethImpl: Eth;
    cacheService: CacheService;
  } = generateEthTestEnv();

  const requestDetails = new RequestDetails({ requestId: 'eth_sendRawTransactionTest', ipAddress: '0.0.0.0' });

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
    };
    const RECEIVER_ACCOUNT_RES = {
      account: ACCOUNT_ADDRESS_1,
      balance: {
        balance: Hbar.from(1, HbarUnit.Hbar).to(HbarUnit.Tinybar),
      },
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
    });

    afterEach(() => {
      sinon.restore();
      clock.restore();
    });

    it('should emit tracking event (limiter and metrics) only for successful tx responses from FileAppend transaction', async function () {
      const signed = await signTransaction({
        ...transaction,
        data: '0x' + '22'.repeat(13000),
      });
      const expectedTxHash = Utils.computeTransactionHash(Buffer.from(signed.replace('0x', ''), 'hex'));

      const FILE_ID = new FileId(0, 0, 5644);
      sdkClientStub.submitEthereumTransaction.restore();
      sdkClientStub.createFile.restore();
      sdkClientStub.executeAllTransaction.restore();

      sdkClientStub.fileAppendChunkSize = 2048;
      sdkClientStub.clientMain = { operatorAccountId: '', operatorKey: null };

      const fileInfoMock = sinon.stub(FileInfo);
      fileInfoMock.size = new Long(26000);
      sdkClientStub.executeQuery.resolves(fileInfoMock);

      // simulates error after first append by returning only one transaction response
      sinon.stub(FileAppendTransaction.prototype, 'executeAll').resolves([{ transactionId: transactionId }]);

      const eventEmitterMock = sinon.createStubInstance(EventEmitter);
      sdkClientStub.eventEmitter = eventEmitterMock;

      const hbarLimiterMock = sinon.createStubInstance(HbarLimitService);
      sdkClientStub.hbarLimitService = hbarLimiterMock;

      const txResponseMock = sinon.createStubInstance(TransactionResponse);
      sdkClientStub.executeTransaction.resolves(txResponseMock);

      txResponseMock.getReceipt.restore();
      sinon.stub(txResponseMock, 'getReceipt').onFirstCall().resolves({ fileId: FILE_ID });
      txResponseMock.transactionId = TransactionId.fromString(transactionIdServicesFormat);

      sdkClientStub.logger = pino({ level: 'silent' });
      sdkClientStub.deleteFile.resolves();

      restMock.onGet(contractResultEndpoint).reply(200, JSON.stringify({ hash: expectedTxHash }));

      const resultingHash = await ethImpl.sendRawTransaction(signed, requestDetails);
      if (useAsyncTxProcessing) await clock.tickAsync(1);

      expect(eventEmitterMock.emit.callCount).to.equal(1);
      expect(hbarLimiterMock.shouldLimit.callCount).to.equal(1);
      expect(resultingHash).to.equal(expectedTxHash);
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
      const repeatedRequestSpy = sinon.spy(ethImpl['transactionService']['mirrorNodeClient'], 'repeatedRequest');
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
        requestDetails,
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
        predefined.UNSUPPORTED_TRANSACTION_TYPE,
        ethImpl.sendRawTransaction,
        false,
        ethImpl,
        [signed, getRequestId()],
      );
    });

    withOverriddenEnvsInMochaTest({ USE_ASYNC_TX_PROCESSING: false }, () => {
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
  });
});
