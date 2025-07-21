// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import {
  AccountId,
  Client,
  EthereumTransaction,
  ExchangeRate,
  FileAppendTransaction,
  FileCreateTransaction,
  FileDeleteTransaction,
  FileId,
  FileInfoQuery,
  Hbar,
  Query,
  Status,
  TransactionId,
  TransactionRecordQuery,
  TransactionResponse,
} from '@hashgraph/sdk';
import axios, { AxiosInstance } from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { expect } from 'chai';
import EventEmitter from 'events';
import Long from 'long';
import pino from 'pino';
import { register, Registry } from 'prom-client';
import * as sinon from 'sinon';

import { formatTransactionId } from '../../src/formatters';
import { MirrorNodeClient, SDKClient } from '../../src/lib/clients';
import constants from '../../src/lib/constants';
import { EvmAddressHbarSpendingPlanRepository } from '../../src/lib/db/repositories/hbarLimiter/evmAddressHbarSpendingPlanRepository';
import { HbarSpendingPlanRepository } from '../../src/lib/db/repositories/hbarLimiter/hbarSpendingPlanRepository';
import { IPAddressHbarSpendingPlanRepository } from '../../src/lib/db/repositories/hbarLimiter/ipAddressHbarSpendingPlanRepository';
import { SDKClientError } from '../../src/lib/errors/SDKClientError';
import { CACHE_LEVEL, CacheService } from '../../src/lib/services/cacheService/cacheService';
import HAPIService from '../../src/lib/services/hapiService/hapiService';
import { HbarLimitService } from '../../src/lib/services/hbarLimitService';
import MetricService from '../../src/lib/services/metricService/metricService';
import { RequestDetails } from '../../src/lib/types';
import { Utils } from '../../src/utils';
import {
  calculateTxRecordChargeAmount,
  overrideEnvsInMochaDescribe,
  random20BytesAddress,
  signTransaction,
  withOverriddenEnvsInMochaTest,
} from '../helpers';
import { transactionBuffer } from './fixtures/transactionBufferFixture';

const registry = new Registry();
const logger = pino({ level: 'silent' });

describe('SdkClient', async function () {
  this.timeout(20000);

  let client: Client;
  let mock: MockAdapter;
  let sdkClient: SDKClient;
  let instance: AxiosInstance;
  let eventEmitter: EventEmitter;
  let cacheService: CacheService;
  let mirrorNodeClient: MirrorNodeClient;
  let hbarLimitService: HbarLimitService;

  const requestDetails = new RequestDetails({ requestId: 'sdkClientTest', ipAddress: '0.0.0.0' });

  overrideEnvsInMochaDescribe({ GET_RECORD_DEFAULT_TO_CONSENSUS_NODE: true });

  before(() => {
    const hederaNetwork = ConfigService.get('HEDERA_NETWORK')!;
    if (hederaNetwork in constants.CHAIN_IDS) {
      client = Client.forName(hederaNetwork);
    } else {
      client = Client.forNetwork(JSON.parse(hederaNetwork));
    }

    client = client.setOperator(
      AccountId.fromString(ConfigService.get('OPERATOR_ID_MAIN')!),
      Utils.createPrivateKeyBasedOnFormat(ConfigService.get('OPERATOR_KEY_MAIN')!),
    );
    const duration = constants.HBAR_RATE_LIMIT_DURATION;
    eventEmitter = new EventEmitter();

    cacheService = CacheService.getInstance(CACHE_LEVEL.L1, registry);
    const hbarSpendingPlanRepository = new HbarSpendingPlanRepository(cacheService, logger);
    const evmAddressHbarSpendingPlanRepository = new EvmAddressHbarSpendingPlanRepository(cacheService, logger);
    const ipAddressHbarSpendingPlanRepository = new IPAddressHbarSpendingPlanRepository(cacheService, logger);
    hbarLimitService = new HbarLimitService(
      hbarSpendingPlanRepository,
      evmAddressHbarSpendingPlanRepository,
      ipAddressHbarSpendingPlanRepository,
      logger,
      register,
      duration,
    );

    sdkClient = new SDKClient(client, logger, eventEmitter, hbarLimitService);

    instance = axios.create({
      baseURL: 'https://localhost:5551/api/v1',
      responseType: 'json' as const,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 20 * 1000,
    });

    // mirror node client
    mirrorNodeClient = new MirrorNodeClient(
      ConfigService.get('MIRROR_NODE_URL'),
      logger.child({ name: `mirror-node` }),
      registry,
      CacheService.getInstance(CACHE_LEVEL.L1, registry),
      instance,
    );

    // Note: Since the main capturing metric logic of the `MetricService` class works by listening to specific events,
    //       this class does not need an instance but must still be initiated.
    new MetricService(logger, sdkClient, mirrorNodeClient, registry, eventEmitter, hbarLimitService);
  });

  beforeEach(() => {
    mock = new MockAdapter(instance);
  });

  describe('HAPIService', async () => {
    let hapiService: HAPIService;

    const OPERATOR_KEY_ED25519 = {
      DER: '302e020100300506032b65700422042091132178e72057a1d7528025956fe39b0b847f200ab59b2fdd367017f3087137',
      HEX_ED25519: '0x91132178e72057a1d7528025956fe39b0b847f200ab59b2fdd367017f3087137',
    };

    const OPERATOR_KEY_ECDSA = {
      DER: '3030020100300706052b8104000a0422042008e926c84220295b5db5df25be107ce905b41e237ac748dd04d479c23dcdf2d5',
      HEX_ECDSA: '0x08e926c84220295b5db5df25be107ce905b41e237ac748dd04d479c23dcdf2d5',
    };

    this.beforeEach(() => {
      if (ConfigService.get('OPERATOR_KEY_FORMAT') !== 'BAD_FORMAT') {
        hapiService = new HAPIService(logger, registry, eventEmitter, hbarLimitService);
      }
    });

    it('Initialize the privateKey for default which is DER', async () => {
      const privateKey = Utils.createPrivateKeyBasedOnFormat.call(hapiService, OPERATOR_KEY_ED25519.DER);
      expect(privateKey.toString()).to.eq(OPERATOR_KEY_ED25519.DER);
    });

    withOverriddenEnvsInMochaTest({ OPERATOR_KEY_FORMAT: undefined }, () => {
      it('Initialize the privateKey for default which is DER when OPERATOR_KEY_FORMAT is undefined', async () => {
        const privateKey = Utils.createPrivateKeyBasedOnFormat.call(hapiService, OPERATOR_KEY_ED25519.DER);
        expect(privateKey.toString()).to.eq(OPERATOR_KEY_ED25519.DER);
      });
    });

    withOverriddenEnvsInMochaTest({ OPERATOR_KEY_FORMAT: 'DER' }, () => {
      it('Initialize the privateKey for OPERATOR_KEY_FORMAT set to DER', async () => {
        const privateKey = Utils.createPrivateKeyBasedOnFormat.call(hapiService, OPERATOR_KEY_ECDSA.DER);
        expect(privateKey.toString()).to.eq(OPERATOR_KEY_ECDSA.DER);
      });
    });

    withOverriddenEnvsInMochaTest({ OPERATOR_KEY_FORMAT: 'HEX_ED25519' }, () => {
      it('Initialize the privateKey for OPERATOR_KEY_FORMAT set to HEX_ED25519', async () => {
        const privateKey = Utils.createPrivateKeyBasedOnFormat.call(hapiService, OPERATOR_KEY_ED25519.HEX_ED25519);
        expect(privateKey.toString()).to.eq(OPERATOR_KEY_ED25519.DER);
      });
    });

    withOverriddenEnvsInMochaTest({ OPERATOR_KEY_FORMAT: 'HEX_ECDSA' }, () => {
      it('Initialize the privateKey for OPERATOR_KEY_FORMAT set to HEX_ECDSA', async () => {
        const privateKey = Utils.createPrivateKeyBasedOnFormat.call(hapiService, OPERATOR_KEY_ECDSA.HEX_ECDSA);
        expect(privateKey.toString()).to.eq(OPERATOR_KEY_ECDSA.DER);
      });
    });

    withOverriddenEnvsInMochaTest({ OPERATOR_KEY_FORMAT: 'BAD_FORMAT' }, () => {
      it('It should throw an Error when an unexpected string is set', async () => {
        try {
          new HAPIService(logger, registry, eventEmitter, hbarLimitService);
          expect.fail(`Expected an error but nothing was thrown`);
        } catch (e: any) {
          expect(e.message).to.eq('Invalid OPERATOR_KEY_FORMAT provided: BAD_FORMAT');
        }
      });
    });
  });

  describe('submitEthereumTransaction', () => {
    const accountId = AccountId.fromString('0.0.1234');
    const chunkSize = ConfigService.get('FILE_APPEND_CHUNK_SIZE');
    const FILE_APPEND_CHUNK_SIZE = ConfigService.get('FILE_APPEND_CHUNK_SIZE');
    const fileId = FileId.fromString('0.0.1234');
    const mockedCallerName = 'caller_name';
    const mockedExchangeRateIncents = 12;
    const mockedNetworkGasPrice = 710000;
    const randomAccountAddress = random20BytesAddress();
    const transactionId = TransactionId.generate(accountId);
    const transactionReceipt = { fileId, status: Status.Success };

    // Base transaction properties
    const defaultTx = {
      value: '0x5',
      gasPrice: '0x3b9aca00',
      gasLimit: '0x100000',
      chainId: 0x12a,
      nonce: 5,
      to: '0x0000000000000000000000000000000000001f41',
    };

    const callSubmit = (buffer: Buffer) => {
      return sdkClient.submitEthereumTransaction(
        buffer,
        mockedCallerName,
        requestDetails,
        randomAccountAddress,
        mockedNetworkGasPrice,
        mockedExchangeRateIncents,
      );
    };

    const createTransactionBuffer = async (size: number) => {
      const tx = {
        ...defaultTx,
        data: '0x' + '00'.repeat(size),
      };
      const signedTx = await signTransaction(tx);
      return Buffer.from(signedTx.substring(2), 'hex');
    };

    const getMockedTransactionResponse = () =>
      ({
        nodeId: accountId,
        transactionHash: Uint8Array.from([1, 2, 3, 4]),
        transactionId,
        getReceipt: () => Promise.resolve(transactionReceipt),
        getRecord: () =>
          Promise.resolve({
            receipt: transactionReceipt,
            contractFunctionResult: { gasUsed: Long.fromNumber(10000) },
          }),
      }) as unknown as TransactionResponse;

    let hbarLimitServiceMock: sinon.SinonMock;
    let setEthereumDataStub: sinon.SinonSpy;
    let setCallDataFileIdStub: sinon.SinonSpy;
    let smallBuffer: Buffer;
    let largeBuffer: Buffer;

    beforeEach(async () => {
      sinon.restore();
      hbarLimitServiceMock = sinon.mock(hbarLimitService);
      setEthereumDataStub = sinon.spy(EthereumTransaction.prototype, 'setEthereumData');
      setCallDataFileIdStub = sinon.spy(EthereumTransaction.prototype, 'setCallDataFileId');
      smallBuffer = await createTransactionBuffer(FILE_APPEND_CHUNK_SIZE - 500);
      largeBuffer = await createTransactionBuffer(FILE_APPEND_CHUNK_SIZE + 500);
    });

    withOverriddenEnvsInMochaTest({ JUMBO_TX_ENABLED: true }, () => {
      it('should not create a file when JUMBO_TX_ENABLED is true, regardless of transaction size', async () => {
        const createFileStub = sinon.stub(sdkClient, 'createFile');
        const transactionStub = sinon
          .stub(EthereumTransaction.prototype, 'execute')
          .resolves(getMockedTransactionResponse());

        hbarLimitServiceMock.expects('shouldLimit').once().returns(false);

        const sendRawTransactionResult = await callSubmit(largeBuffer);

        expect(createFileStub.called).to.be.false;
        expect(setEthereumDataStub.called).to.be.true;
        expect(setCallDataFileIdStub.called).to.be.false;
        expect(transactionStub.called).to.be.true;
        expect(sendRawTransactionResult.fileId).to.be.null;
        expect(sendRawTransactionResult.txResponse).to.exist;
      });
    });

    withOverriddenEnvsInMochaTest({ JUMBO_TX_ENABLED: false }, () => {
      it('should not create a file when size <= fileAppendChunkSize', async () => {
        const createFileStub = sinon.stub(sdkClient as any, 'createFile');
        const transactionStub = sinon
          .stub(EthereumTransaction.prototype, 'execute')
          .resolves(getMockedTransactionResponse());

        hbarLimitServiceMock.expects('shouldLimit').once().returns(false);

        const sendRawTransactionResult = await callSubmit(smallBuffer);

        expect(createFileStub.called).to.be.false;
        expect(setEthereumDataStub.called).to.be.true;
        expect(setCallDataFileIdStub.called).to.be.false;
        expect(transactionStub.called).to.be.true;
        expect(sendRawTransactionResult.fileId).to.be.null;
        expect(sendRawTransactionResult.txResponse).to.exist;
      });

      it('should create a file when size > fileAppendChunkSize', async () => {
        const createFileStub = sinon.stub(sdkClient as any, 'createFile').resolves(fileId);
        const executeTransactionStub = sinon
          .stub(sdkClient as any, 'executeTransaction')
          .resolves(getMockedTransactionResponse());

        hbarLimitServiceMock.expects('shouldLimit').once().returns(false);

        const sendRawTransactionResult = await callSubmit(largeBuffer);

        expect(
          createFileStub.calledOnceWithExactly(
            sinon.match.instanceOf(Uint8Array),
            sdkClient.getMainClientInstance(),
            requestDetails,
            mockedCallerName,
            sinon.match.string,
            randomAccountAddress,
            mockedExchangeRateIncents,
          ),
        ).to.be.true;

        expect(
          executeTransactionStub.calledOnceWithExactly(
            sinon.match.instanceOf(EthereumTransaction),
            mockedCallerName,
            sinon.match.string,
            requestDetails,
            true,
            randomAccountAddress,
          ),
        ).to.be.true;

        // Verify Ethereum transaction setup
        expect(setEthereumDataStub.called).to.be.true;
        expect(setCallDataFileIdStub.called).to.be.true;
        expect(setCallDataFileIdStub.firstCall.args[0]).to.equal(fileId);

        // Verify results
        expect(sendRawTransactionResult.fileId).to.equal(fileId);
        expect(sendRawTransactionResult.txResponse).to.exist;

        // Note: createFile internally calls executeTransaction, executeAllTransaction, and executeQuery
        // but we're stubbing createFile itself, so those won't be called in this test.
      });

      it('should test full integration flow when creating a file with size > fileAppendChunkSize', async () => {
        // Mock the receipt response for file creation
        const mockReceipt = { fileId, status: Status.Success };
        const mockTransactionResponse = {
          ...getMockedTransactionResponse(),
          getReceipt: sinon.stub().resolves(mockReceipt),
        };

        // Setup stubs for internal methods called by createFile
        const executeTransactionStub = sinon
          .stub(sdkClient as any, 'executeTransaction')
          .resolves(mockTransactionResponse);
        const executeAllTransactionStub = sinon.stub(sdkClient as any, 'executeAllTransaction').resolves();
        const executeQueryStub = sinon.stub(sdkClient as any, 'executeQuery').resolves({
          size: { isZero: () => false, toString: () => '1000' },
        });

        // Mock HBAR limit service
        hbarLimitServiceMock.expects('shouldLimit').twice().returns(false);

        // Execute with large buffer
        const sendRawTransactionResult = await callSubmit(largeBuffer);

        // Verify executeTransaction was called multiple times:
        // 1. For FileCreateTransaction (in createFile)
        // 2. For the main EthereumTransaction
        expect(executeTransactionStub.callCount).to.equal(2);

        // Verify first call is for FileCreateTransaction (in createFile)
        const firstExecuteCall = executeTransactionStub.firstCall.args;
        expect(firstExecuteCall[0]).to.be.instanceOf(FileCreateTransaction);
        expect(firstExecuteCall[1]).to.equal(mockedCallerName);
        expect(firstExecuteCall[4]).to.be.false; // shouldThrowHbarLimit is false in createFile

        // Verify second call is for EthereumTransaction (main flow)
        const secondExecuteCall = executeTransactionStub.secondCall.args;
        expect(secondExecuteCall[0]).to.be.instanceOf(EthereumTransaction);
        expect(secondExecuteCall[1]).to.equal(mockedCallerName);
        expect(secondExecuteCall[4]).to.be.true; // shouldThrowHbarLimit is true in main flow

        // Verify executeAllTransaction was called for FileAppendTransaction
        expect(executeAllTransactionStub.calledOnce).to.be.true;
        const executeAllArgs = executeAllTransactionStub.firstCall.args;
        expect(executeAllArgs[0]).to.be.instanceOf(FileAppendTransaction);
        expect(executeAllArgs[1]).to.equal(mockedCallerName);
        expect(executeAllArgs[4]).to.be.false; // shouldThrowHbarLimit is false

        // Verify executeQuery was called for FileInfoQuery
        expect(executeQueryStub.calledOnce).to.be.true;
        const executeQueryArgs = executeQueryStub.firstCall.args;
        expect(executeQueryArgs[0]).to.be.instanceOf(FileInfoQuery);
        expect(executeQueryArgs[2]).to.equal(mockedCallerName);

        // Verify Ethereum transaction setup
        expect(setEthereumDataStub.called).to.be.true;
        expect(setCallDataFileIdStub.called).to.be.true;
        expect(setCallDataFileIdStub.firstCall.args[0]).to.equal(fileId);

        // Verify results
        expect(sendRawTransactionResult.fileId).to.equal(fileId);
        expect(sendRawTransactionResult.txResponse).to.exist;
      });

      it('should fail when file info query size is zero', async () => {
        const mockReceipt = { fileId, status: Status.Success };
        const mockTransactionResponse = {
          ...getMockedTransactionResponse(),
          getReceipt: sinon.stub().resolves(mockReceipt),
        };

        sinon.stub(sdkClient as any, 'executeTransaction').resolves(mockTransactionResponse);
        sinon.stub(sdkClient as any, 'executeAllTransaction').resolves();
        const executeQueryStub = sinon.stub(sdkClient as any, 'executeQuery');
        executeQueryStub.resolves({ size: { isZero: () => true, toString: () => '0' } });
        hbarLimitServiceMock.expects('shouldLimit').twice().returns(false);

        // Execute and expect failure
        await expect(callSubmit(largeBuffer)).to.be.rejectedWith(SDKClientError, 'Created file is empty.');
      });

      it('throws an error when createFile returns null', async () => {
        sinon.stub(sdkClient as any, 'createFile').resolves(null);
        const buffer = await createTransactionBuffer(chunkSize + 1);
        await expect(callSubmit(buffer)).to.be.rejectedWith(SDKClientError, 'No fileId created for transaction.');
      });
    });
  });

  describe('HBAR Limiter', async () => {
    const FILE_APPEND_CHUNK_SIZE = ConfigService.get('FILE_APPEND_CHUNK_SIZE');
    const MAX_CHUNKS = ConfigService.get('FILE_APPEND_MAX_CHUNKS');

    const fileCreateFee = 100000000; // 1 hbar
    const fileDeleteFee = 11000000; // 0.11 hbar
    const fileAppendFee = 120000000; // 1.2 hbar
    const mockedExchangeRateIncents = 12;
    const mockedTransactionRecordFee = calculateTxRecordChargeAmount(mockedExchangeRateIncents);
    const defaultTransactionFee = 1000;
    const createFileConstructorName = 'createFile';

    const accountId = AccountId.fromString('0.0.1234');
    const transactionId = TransactionId.generate(accountId);
    const fileId = FileId.fromString('0.0.1234');
    const transactionReceipt = { fileId, status: Status.Success };
    const gasUsed = Long.fromNumber(10000);
    const mockedNetworkGasPrice = 710000;

    const randomAccountAddress = random20BytesAddress();

    const getMockedTransaction = (transactionType: string, toHbar: boolean) => {
      let transactionFee: any;
      let transfers: any;
      switch (transactionType) {
        case FileCreateTransaction.name:
          transactionFee = toHbar ? new Hbar(fileCreateFee / 10 ** 8) : fileCreateFee;
          transfers = [
            {
              accountId: ConfigService.get('OPERATOR_ID_MAIN'),
              amount: Hbar.fromTinybars(-1 * fileCreateFee),
              is_approval: false,
            },
          ];
          break;
        case FileAppendTransaction.name:
          transactionFee = toHbar ? new Hbar(fileAppendFee / 10 ** 8) : fileAppendFee;
          transfers = [
            {
              accountId: ConfigService.get('OPERATOR_ID_MAIN'),
              amount: Hbar.fromTinybars(-1 * fileAppendFee),
              is_approval: false,
            },
          ];
          break;
        case FileDeleteTransaction.name:
          transactionFee = toHbar ? new Hbar(fileDeleteFee / 10 ** 8) : fileDeleteFee;
          transfers = [
            {
              accountId: ConfigService.get('OPERATOR_ID_MAIN'),
              amount: Hbar.fromTinybars(-1 * fileDeleteFee),
              is_approval: false,
            },
          ];
          break;
        default:
          transactionFee = toHbar ? new Hbar(defaultTransactionFee / 10 ** 8) : defaultTransactionFee;
          transfers = [
            {
              accountId: '0.0.800',
              amount: Hbar.fromTinybars(defaultTransactionFee),
              is_approval: false,
            },
            {
              accountId: ConfigService.get('OPERATOR_ID_MAIN'),
              amount: Hbar.fromTinybars(-1 * defaultTransactionFee),
              is_approval: false,
            },
            {
              accountId: ConfigService.get('OPERATOR_ID_MAIN'),
              amount: Hbar.fromTinybars(defaultTransactionFee),
              is_approval: false,
            },
            {
              accountId: accountId.toString(),
              amount: Hbar.fromTinybars(-1 * defaultTransactionFee),
              is_approval: false,
            },
          ];
          break;
      }
      return { transactionFee, transfers };
    };

    const getMockedTransactionResponse = (transactionType: string) =>
      ({
        nodeId: accountId,
        transactionHash: Uint8Array.from([1, 2, 3, 4]),
        transactionId,
        getReceipt: (_client: Client) => Promise.resolve(transactionReceipt),
        getRecord: (_client: Client) => {
          const transactionFee = getMockedTransaction(transactionType, false).transactionFee;
          const transfers = getMockedTransaction(transactionType, false).transfers;
          return Promise.resolve({
            receipt: transactionReceipt,
            transactionFee: Hbar.fromTinybars(transactionFee),
            contractFunctionResult: {
              gasUsed,
            },
            transfers,
          });
        },
      }) as unknown as TransactionResponse;

    const getMockedTransactionRecord: any = (transactionType: string, toHbar: boolean = false) => ({
      receipt: {
        status: Status.Success,
        exchangeRate: { exchangeRateInCents: 12 },
      },
      transactionFee: getMockedTransaction(transactionType, true).transactionFee,
      contractFunctionResult: {
        gasUsed,
      },
      transfers: getMockedTransaction(transactionType, toHbar).transfers,
    });

    const fileInfo = {
      fileId,
      isDeleted: true,
      size: Long.fromNumber(FILE_APPEND_CHUNK_SIZE),
    };
    const mockedCallerName = 'caller_name';
    const mockedConstructorName = 'constructor_name';
    const mockedInteractingEntity = 'interacting_entity';

    let hbarLimitServiceMock: sinon.SinonMock;
    let sdkClientMock: sinon.SinonMock;

    beforeEach(() => {
      hbarLimitServiceMock = sinon.mock(hbarLimitService);
      sdkClientMock = sinon.mock(sdkClient);
      mock = new MockAdapter(instance);
    });

    afterEach(() => {
      hbarLimitServiceMock.verify();
      sinon.restore();
      sdkClientMock.restore();
      hbarLimitServiceMock.restore();
    });

    it('should execute executeAllTransaction with 3 file appends and add expenses to limiter only for the successful ones (2)', async () => {
      const fileAppendTxStub = sinon
        .stub(FileAppendTransaction.prototype, 'executeAll')
        .resolves([
          getMockedTransactionResponse(FileAppendTransaction.name),
          getMockedTransactionResponse(FileAppendTransaction.name),
        ]);

      const txRecordStub = sinon
        .stub(TransactionRecordQuery.prototype, 'execute')
        .resolves(getMockedTransactionRecord(FileAppendTransaction.name));

      hbarLimitServiceMock.expects('addExpense').withArgs(fileAppendFee).exactly(2);
      hbarLimitServiceMock.expects('addExpense').withArgs(mockedTransactionRecordFee).exactly(2);
      hbarLimitServiceMock.expects('shouldLimit').once().returns(false);

      await sdkClient.executeAllTransaction(
        new FileAppendTransaction(),
        mockedCallerName,
        mockedInteractingEntity,
        requestDetails,
        true,
        randomAccountAddress,
      );

      expect(fileAppendTxStub.called).to.be.true;
      expect(txRecordStub.called).to.be.true;
    });

    it('should rate limit before creating file', async () => {
      const transactionStub = sinon
        .stub(EthereumTransaction.prototype, 'execute')
        .resolves(getMockedTransactionResponse(EthereumTransaction.name));

      hbarLimitServiceMock
        .expects('shouldLimit')
        .withArgs(
          constants.EXECUTION_MODE.TRANSACTION,
          mockedCallerName,
          createFileConstructorName,
          randomAccountAddress,
          sinon.match.any,
        )
        .once()
        .returns(true);

      try {
        await sdkClient.submitEthereumTransaction(
          transactionBuffer,
          mockedCallerName,
          requestDetails,
          randomAccountAddress,
          mockedNetworkGasPrice,
          mockedExchangeRateIncents,
        );
        expect.fail(`Expected an error but nothing was thrown`);
      } catch (error: any) {
        expect(error.message).to.equal('HBAR Rate limit exceeded');
      }

      expect(transactionStub.called).to.be.false;
    });

    it('should execute submitEthereumTransaction add expenses to limiter for large transaction data', async () => {
      const fileAppendChunks = Math.min(MAX_CHUNKS, Math.ceil(transactionBuffer.length / FILE_APPEND_CHUNK_SIZE));
      const queryStub = sinon.stub(FileInfoQuery.prototype, 'execute').resolves(fileInfo as any);

      const transactionStub = sinon
        .stub(EthereumTransaction.prototype, 'execute')
        .resolves(getMockedTransactionResponse(EthereumTransaction.name));
      const createFileStub = sinon
        .stub(FileCreateTransaction.prototype, 'execute')
        .resolves(getMockedTransactionResponse(FileCreateTransaction.name));
      const appendFileStub = sinon
        .stub(FileAppendTransaction.prototype, 'executeAll')
        .resolves(
          Array.from({ length: fileAppendChunks }, () => getMockedTransactionResponse(FileAppendTransaction.name)),
        );

      const transactionRecordStub = sinon.stub(TransactionRecordQuery.prototype, 'execute');
      // first transactionRecordStub call for FileCreate
      transactionRecordStub.onCall(0).resolves(getMockedTransactionRecord(FileCreateTransaction.name));

      // next fileAppendChunks transactionRecordStub calls for FileAppend
      let i = 1;
      for (i; i <= fileAppendChunks; i++) {
        transactionRecordStub.onCall(i).resolves(getMockedTransactionRecord(FileAppendTransaction.name));
      }

      // last transactionRecordStub call for EthereumTransaction
      transactionRecordStub.onCall(i).resolves(getMockedTransactionRecord(EthereumTransaction.name));

      hbarLimitServiceMock.expects('shouldLimit').twice().returns(false);
      hbarLimitServiceMock.expects('addExpense').withArgs(fileCreateFee).once();
      hbarLimitServiceMock.expects('addExpense').withArgs(defaultTransactionFee).once();
      hbarLimitServiceMock.expects('addExpense').withArgs(fileAppendFee).exactly(fileAppendChunks);

      // addExpense for mockedTransactionRecordFee will be called for a total of:
      //   - fileAppendChunks times for fileAppend transactions
      //   - 1 time for fileCreate transaction
      //   - 1 time for defaultTransaction Ethereum transaction
      hbarLimitServiceMock
        .expects('addExpense')
        .withArgs(mockedTransactionRecordFee)
        .exactly(fileAppendChunks + 2);

      await sdkClient.submitEthereumTransaction(
        transactionBuffer,
        mockedCallerName,
        requestDetails,
        randomAccountAddress,
        mockedNetworkGasPrice,
        mockedExchangeRateIncents,
      );

      expect(queryStub.called).to.be.true;
      expect(transactionStub.called).to.be.true;
      expect(createFileStub.called).to.be.true;
      expect(appendFileStub.called).to.be.true;
    });

    it('should execute FileCreateTransaction with callData.length > fileAppendChunkSize and add expenses to limiter', async () => {
      const callData = new Uint8Array(FILE_APPEND_CHUNK_SIZE * 2 + 1);
      const fileAppendChunks = Math.min(MAX_CHUNKS, Math.ceil(callData.length / FILE_APPEND_CHUNK_SIZE));

      const fileInfoQueryStub = sinon.stub(FileInfoQuery.prototype, 'execute').resolves(fileInfo as any);
      const createFileStub = sinon
        .stub(FileCreateTransaction.prototype, 'execute')
        .resolves(getMockedTransactionResponse(FileCreateTransaction.name));
      const appendFileStub = sinon
        .stub(FileAppendTransaction.prototype, 'executeAll')
        .resolves(
          Array.from({ length: fileAppendChunks }, () => getMockedTransactionResponse(FileAppendTransaction.name)),
        );
      const transactionRecordStub = sinon.stub(TransactionRecordQuery.prototype, 'execute');

      transactionRecordStub.onCall(0).resolves(getMockedTransactionRecord(FileCreateTransaction.name));
      for (let i = 1; i <= fileAppendChunks; i++) {
        transactionRecordStub.onCall(i).resolves(getMockedTransactionRecord(FileAppendTransaction.name));
      }

      hbarLimitServiceMock.expects('shouldLimit').once().returns(false);
      hbarLimitServiceMock.expects('addExpense').withArgs(fileCreateFee).once();
      hbarLimitServiceMock.expects('addExpense').withArgs(fileAppendFee).exactly(fileAppendChunks);
      // addExpense for mockedTransactionRecordFee will be called for a total of:
      //   - fileAppendChunks times for fileAppend transactions
      //   - 1 time for fileCreate transaction
      hbarLimitServiceMock
        .expects('addExpense')
        .withArgs(mockedTransactionRecordFee)
        .exactly(fileAppendChunks + 1);

      const response = await sdkClient.createFile(
        callData,
        client,
        requestDetails,
        mockedCallerName,
        mockedInteractingEntity,
        randomAccountAddress,
        mockedExchangeRateIncents,
      );

      expect(response).to.eq(fileId);
      expect(fileInfoQueryStub.called).to.be.true;
      expect(createFileStub.called).to.be.true;
      expect(appendFileStub.called).to.be.true;
      expect(transactionRecordStub.called).to.be.true;
    });

    it('should execute executeAllTransaction and add expenses to limiter', async () => {
      const callData = new Uint8Array(FILE_APPEND_CHUNK_SIZE * 2 + 1);
      const fileAppendChunks = Math.min(MAX_CHUNKS, Math.ceil(callData.length / FILE_APPEND_CHUNK_SIZE));
      const estimatedFileAppendTxFee = mockedTransactionRecordFee * fileAppendChunks;

      const appendFileStub = sinon
        .stub(FileAppendTransaction.prototype, 'executeAll')
        .resolves(
          Array.from({ length: fileAppendChunks }, () => getMockedTransactionResponse(FileAppendTransaction.name)),
        );

      const transactionRecordStub = sinon
        .stub(TransactionRecordQuery.prototype, 'execute')
        .resolves(getMockedTransactionRecord(FileAppendTransaction.name));

      hbarLimitServiceMock.expects('shouldLimit').once().returns(false);
      hbarLimitServiceMock.expects('addExpense').withArgs(fileAppendFee).exactly(fileAppendChunks);
      // addExpense for mockedTransactionRecordFee will be called for a total of:
      //   - fileAppendChunks times for fileAppend transactions
      hbarLimitServiceMock.expects('addExpense').withArgs(mockedTransactionRecordFee).exactly(fileAppendChunks);

      await sdkClient.executeAllTransaction(
        new FileAppendTransaction(),
        mockedCallerName,
        mockedInteractingEntity,
        requestDetails,
        true,
        randomAccountAddress,
        estimatedFileAppendTxFee,
      );

      expect(appendFileStub.called).to.be.true;
      expect(transactionRecordStub.called).to.be.true;
    });

    it('should rate limit before executing executeAllTransaction', async () => {
      const callData = new Uint8Array(FILE_APPEND_CHUNK_SIZE * 2 + 1);
      const fileAppendChunks = Math.min(MAX_CHUNKS, Math.ceil(callData.length / FILE_APPEND_CHUNK_SIZE));
      const estimatedFileAppendTxFee = mockedTransactionRecordFee * fileAppendChunks;

      const appendFileStub = sinon
        .stub(FileAppendTransaction.prototype, 'executeAll')
        .resolves(
          Array.from({ length: fileAppendChunks }, () => getMockedTransactionResponse(FileAppendTransaction.name)),
        );

      hbarLimitServiceMock.expects('shouldLimit').once().returns(true);

      try {
        await sdkClient.executeAllTransaction(
          new FileAppendTransaction(),
          mockedCallerName,
          mockedInteractingEntity,
          requestDetails,
          true,
          randomAccountAddress,
          estimatedFileAppendTxFee,
        );
        expect.fail(`Expected an error but nothing was thrown`);
      } catch (error: any) {
        expect(error.message).to.equal('HBAR Rate limit exceeded');
      }

      expect(appendFileStub.called).to.be.false;
    });

    it('should execute FileCreateTransaction with callData.length <= fileAppendChunkSize and add expenses to limiter', async () => {
      const callData = new Uint8Array(FILE_APPEND_CHUNK_SIZE);

      const createFileStub = sinon
        .stub(FileCreateTransaction.prototype, 'execute')
        .resolves(getMockedTransactionResponse(FileCreateTransaction.name));
      const fileInfoQueryStub = sinon.stub(FileInfoQuery.prototype, 'execute').resolves(fileInfo as any);
      const transactionRecordStub = sinon
        .stub(TransactionRecordQuery.prototype, 'execute')
        .resolves(getMockedTransactionRecord(FileCreateTransaction.name));

      hbarLimitServiceMock
        .expects('shouldLimit')
        .withArgs(
          constants.EXECUTION_MODE.TRANSACTION,
          mockedCallerName,
          createFileConstructorName,
          randomAccountAddress,
          sinon.match.any,
        )
        .once()
        .returns(false);

      hbarLimitServiceMock.expects('addExpense').withArgs(fileCreateFee).once();
      hbarLimitServiceMock.expects('addExpense').withArgs(mockedTransactionRecordFee).once();

      const response = await sdkClient.createFile(
        callData,
        client,
        requestDetails,
        mockedCallerName,
        mockedInteractingEntity,
        randomAccountAddress,
        mockedExchangeRateIncents,
      );

      expect(response).to.eq(fileId);
      expect(createFileStub.called).to.be.true;
      expect(fileInfoQueryStub.called).to.be.true;
      expect(transactionRecordStub.called).to.be.true;
    });

    it('should execute FileDeleteTransaction and add expenses to limiter', async () => {
      const deleteFileStub = sinon
        .stub(FileDeleteTransaction.prototype, 'execute')
        .resolves(getMockedTransactionResponse(FileDeleteTransaction.name));
      const fileInfoQueryStub = sinon.stub(FileInfoQuery.prototype, 'execute').resolves(fileInfo as any);
      const transactionRecordStub = sinon
        .stub(TransactionRecordQuery.prototype, 'execute')
        .resolves(getMockedTransactionRecord(FileDeleteTransaction.name));

      hbarLimitServiceMock.expects('addExpense').withArgs(fileDeleteFee).once();
      hbarLimitServiceMock.expects('addExpense').withArgs(mockedTransactionRecordFee).once();
      hbarLimitServiceMock.expects('shouldLimit').never();

      await sdkClient.deleteFile(
        fileId,
        requestDetails,
        mockedCallerName,
        mockedInteractingEntity,
        randomAccountAddress,
      );

      expect(deleteFileStub.called).to.be.true;
      expect(fileInfoQueryStub.called).to.be.true;
      expect(transactionRecordStub.called).to.be.true;
    });

    it('should execute FileInfoQuery (without paymentTransactionId) and add expenses to limiter', async () => {
      const queryStub = sinon.stub(Query.prototype, 'execute').resolves(fileInfo);
      const queryCostStub = sinon.stub(Query.prototype, 'getCost');

      hbarLimitServiceMock.expects('addExpense').withArgs(defaultTransactionFee).once();

      const result = await sdkClient.executeQuery(
        new FileInfoQuery().setFileId(fileId).setQueryPayment(Hbar.fromTinybars(defaultTransactionFee)),
        client,
        mockedCallerName,
        requestDetails,
      );

      expect(result).to.equal(fileInfo);
      expect(queryStub.called).to.be.true;
      expect(queryCostStub.called).to.be.false;
    });

    it('should execute EthereumTransaction and add expenses to limiter', async () => {
      const transactionResponse = getMockedTransactionResponse(EthereumTransaction.name);
      const transactionStub = sinon.stub(EthereumTransaction.prototype, 'execute').resolves(transactionResponse);
      const transactionRecordStub = sinon
        .stub(TransactionRecordQuery.prototype, 'execute')
        .resolves(getMockedTransactionRecord(EthereumTransaction.name));

      hbarLimitServiceMock
        .expects('shouldLimit')
        .withArgs(
          constants.EXECUTION_MODE.TRANSACTION,
          mockedCallerName,
          EthereumTransaction.name,
          randomAccountAddress,
          sinon.match.any,
        )
        .once()
        .returns(false);

      hbarLimitServiceMock.expects('addExpense').withArgs(defaultTransactionFee).once();
      hbarLimitServiceMock.expects('addExpense').withArgs(mockedTransactionRecordFee).once();

      const response = await sdkClient.executeTransaction(
        new EthereumTransaction().setCallDataFileId(fileId).setEthereumData(transactionBuffer),
        mockedCallerName,
        mockedInteractingEntity,
        requestDetails,
        true,
        randomAccountAddress,
      );

      expect(response).to.eq(transactionResponse);
      expect(transactionStub.called).to.be.true;
      expect(transactionRecordStub.called).to.be.true;
    });

    withOverriddenEnvsInMochaTest({ GET_RECORD_DEFAULT_TO_CONSENSUS_NODE: false }, () => {
      it('should execute EthereumTransaction, retrieve transactionStatus and expenses via MIRROR NODE', async () => {
        const mockedTransactionId = transactionId.toString();
        const mockedTransactionIdFormatted = formatTransactionId(mockedTransactionId);
        const mockedMirrorNodeTransactionRecord = {
          transactions: [
            {
              charged_tx_fee: defaultTransactionFee,
              result: 'SUCCESS',
              transaction_id: mockedTransactionIdFormatted,
              transfers: [
                {
                  account: '0.0.800',
                  amount: defaultTransactionFee,
                  is_approval: false,
                },
                {
                  account: ConfigService.get('OPERATOR_ID_MAIN'),
                  amount: -1 * defaultTransactionFee,
                  is_approval: false,
                },
              ],
            },
          ],
        };
        mock
          .onGet(`transactions/${mockedTransactionIdFormatted}?nonce=0`)
          .reply(200, JSON.stringify(mockedMirrorNodeTransactionRecord));
        const transactionResponse = getMockedTransactionResponse(EthereumTransaction.name);
        const transactionStub = sinon.stub(EthereumTransaction.prototype, 'execute').resolves(transactionResponse);

        hbarLimitServiceMock.expects('addExpense').withArgs(defaultTransactionFee).once();
        hbarLimitServiceMock
          .expects('shouldLimit')
          .withArgs(
            constants.EXECUTION_MODE.TRANSACTION,
            mockedCallerName,
            EthereumTransaction.name,
            randomAccountAddress,
            sinon.match.any,
          )
          .once()
          .returns(false);

        const response = await sdkClient.executeTransaction(
          new EthereumTransaction().setCallDataFileId(fileId).setEthereumData(transactionBuffer),
          mockedCallerName,
          mockedInteractingEntity,
          requestDetails,
          true,
          randomAccountAddress,
        );

        expect(response).to.eq(transactionResponse);
        expect(transactionStub.called).to.be.true;
      });
    });

    it('Should execute calculateTxRecordChargeAmount() to get the charge amount of transaction record', () => {
      const mockedExchangeRate = {
        hbars: 30000,
        cents: 164330,
        expirationTime: new Date(),
        exchangeRateInCents: mockedExchangeRateIncents,
      } as ExchangeRate;

      const txRecordChargedAmount = sdkClient.calculateTxRecordChargeAmount(mockedExchangeRate);

      expect(txRecordChargedAmount).to.eq(mockedTransactionRecordFee);
    });

    it('should execute getTransactionRecordMetrics to get transaction record metrics', async () => {
      const mockedTxRecord = getMockedTransactionRecord();

      const transactionRecordStub = sinon.stub(TransactionRecordQuery.prototype, 'execute').resolves(mockedTxRecord);

      const transactionRecordMetrics = await sdkClient.getTransactionRecordMetrics(
        transactionId.toString(),
        mockedConstructorName,
        accountId.toString(),
        requestDetails,
      );

      expect(transactionRecordStub.called).to.be.true;
      expect(transactionRecordMetrics?.gasUsed).to.eq(gasUsed.toNumber());
      expect(transactionRecordMetrics?.transactionFee).to.eq(defaultTransactionFee);
      expect(transactionRecordMetrics?.txRecordChargeAmount).to.eq(mockedTransactionRecordFee);
    });

    it('should throw an SDKCLientError if transaction record is not found when execute getTransactionRecordMetrics', async () => {
      const expectedError = { status: { _code: 404 }, message: 'Transaction Record Not Found' };
      sinon.stub(TransactionRecordQuery.prototype, 'execute').throws(expectedError);

      try {
        await sdkClient.getTransactionRecordMetrics(
          transactionId.toString(),
          mockedConstructorName,
          accountId.toString(),
          requestDetails,
        );
        expect.fail('should have thrown an error');
      } catch (error: any) {
        expect(error.status).to.eq(expectedError.status);
        expect(error.message).to.eq(expectedError.message);
      }
    });

    it('Should execute getTransferAmountSumForAccount() to calculate transactionFee by only transfers that are paid by the specify accountId', () => {
      const accountId = ConfigService.get('OPERATOR_ID_MAIN');
      const mockedTxRecord = getMockedTransactionRecord(EthereumTransaction.name, true);

      const transactionFee = sdkClient.getTransferAmountSumForAccount(mockedTxRecord, accountId);
      expect(transactionFee).to.eq(defaultTransactionFee);
    });
  });

  describe('deleteFile', () => {
    const fileId = FileId.fromString('0.0.1234');
    const mockedCallerName = 'deleteFileTest';
    const mockedInteractingEntity = '0.0.5678';
    const randomAccountAddress = random20BytesAddress();
    const accountId = AccountId.fromString('0.0.1234');
    const transactionId = TransactionId.generate(accountId);
    const transactionReceipt = { fileId, status: Status.Success };

    // Mock function to create a transaction response
    const getMockedTransactionResponse = () =>
      ({
        nodeId: accountId,
        transactionHash: Uint8Array.from([1, 2, 3, 4]),
        transactionId,
        getReceipt: () => Promise.resolve(transactionReceipt),
        getRecord: () =>
          Promise.resolve({
            receipt: transactionReceipt,
            contractFunctionResult: { gasUsed: Long.fromNumber(10000) },
          }),
      }) as unknown as TransactionResponse;

    let executeTransactionStub: sinon.SinonStub;
    let executeQueryStub: sinon.SinonStub;
    let loggerWarnStub: sinon.SinonStub;
    let loggerTraceStub: sinon.SinonStub;

    beforeEach(() => {
      executeTransactionStub = sinon.stub(sdkClient as any, 'executeTransaction');
      executeQueryStub = sinon.stub(sdkClient as any, 'executeQuery');
      loggerWarnStub = sinon.stub(logger, 'warn');
      loggerTraceStub = sinon.stub(logger, 'trace');
      sinon.stub(logger, 'isLevelEnabled').returns(true);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should successfully delete a file and verify deletion', async () => {
      const mockTransactionResponse = getMockedTransactionResponse();
      const mockFileInfo = { isDeleted: true };

      executeTransactionStub.resolves(mockTransactionResponse);
      executeQueryStub.resolves(mockFileInfo);

      await sdkClient.deleteFile(
        fileId,
        requestDetails,
        mockedCallerName,
        mockedInteractingEntity,
        randomAccountAddress,
      );

      expect(
        executeTransactionStub.calledOnceWithExactly(
          sinon.match.instanceOf(FileDeleteTransaction),
          mockedCallerName,
          mockedInteractingEntity,
          requestDetails,
          false,
          randomAccountAddress,
        ),
      ).to.be.true;

      expect(
        executeQueryStub.calledOnceWithExactly(
          sinon.match.instanceOf(FileInfoQuery),
          sdkClient.getMainClientInstance(),
          mockedCallerName,
          requestDetails,
          randomAccountAddress,
        ),
      ).to.be.true;

      expect(loggerTraceStub.calledOnce).to.be.true;
      expect(loggerTraceStub.firstCall.args[0]).to.include(`Deleted file with fileId: ${fileId}`);
      expect(loggerWarnStub.called).to.be.false;
    });

    it('should warn when file deletion verification fails', async () => {
      const mockTransactionResponse = getMockedTransactionResponse();
      const mockFileInfo = { isDeleted: false };

      executeTransactionStub.resolves(mockTransactionResponse);
      executeQueryStub.resolves(mockFileInfo);

      await sdkClient.deleteFile(
        fileId,
        requestDetails,
        mockedCallerName,
        mockedInteractingEntity,
        randomAccountAddress,
      );

      // Assert - Verify warning is logged when file is not deleted
      expect(loggerWarnStub.calledOnce, 'logger.warn should be called when deletion fails').to.be.true;
      expect(loggerWarnStub.firstCall.args[0]).to.include(`Fail to delete file with fileId: ${fileId}`);
      expect(loggerTraceStub.called, 'logger.trace should not be called on failure').to.be.false;
    });

    it('should handle and log errors during file deletion', async () => {
      const errorMessage = 'Transaction execution failed';
      const error = new Error(errorMessage);

      executeTransactionStub.rejects(error);

      await sdkClient.deleteFile(
        fileId,
        requestDetails,
        mockedCallerName,
        mockedInteractingEntity,
        randomAccountAddress,
      );

      // Assert - Verify error handling
      expect(executeTransactionStub.calledOnce, 'executeTransaction should be called once').to.be.true;
      expect(executeQueryStub.called, 'executeQuery should not be called when transaction fails').to.be.false;
      expect(loggerWarnStub.calledOnce, 'logger.warn should be called for error').to.be.true;
      expect(loggerWarnStub.firstCall.args[0]).to.include(errorMessage);
    });

    it('should handle errors during file info query', async () => {
      const mockTransactionResponse = getMockedTransactionResponse();
      const queryError = new Error('Query execution failed');

      executeTransactionStub.resolves(mockTransactionResponse);
      executeQueryStub.rejects(queryError);

      await sdkClient.deleteFile(
        fileId,
        requestDetails,
        mockedCallerName,
        mockedInteractingEntity,
        randomAccountAddress,
      );

      // Assert - Verify both methods were called and error was logged
      expect(executeTransactionStub.calledOnce, 'executeTransaction should be called').to.be.true;
      expect(executeQueryStub.calledOnce, 'executeQuery should be called').to.be.true;
      expect(loggerWarnStub.calledOnce, 'logger.warn should be called for query error').to.be.true;
      expect(loggerWarnStub.firstCall.args[0]).to.include('Query execution failed');
    });

    it('should configure FileDeleteTransaction correctly', async () => {
      const mockTransactionResponse = getMockedTransactionResponse();
      const mockFileInfo = { isDeleted: true };
      const setFileIdSpy = sinon.spy(FileDeleteTransaction.prototype, 'setFileId');
      const setMaxTransactionFeeSpy = sinon.spy(FileDeleteTransaction.prototype, 'setMaxTransactionFee');
      const freezeWithSpy = sinon.spy(FileDeleteTransaction.prototype, 'freezeWith');

      executeTransactionStub.resolves(mockTransactionResponse);
      executeQueryStub.resolves(mockFileInfo);

      await sdkClient.deleteFile(
        fileId,
        requestDetails,
        mockedCallerName,
        mockedInteractingEntity,
        randomAccountAddress,
      );

      expect(setFileIdSpy.calledWith(fileId), 'setFileId should be called with correct fileId').to.be.true;
      expect(setMaxTransactionFeeSpy.calledOnce, 'setMaxTransactionFee should be called').to.be.true;
      expect(setMaxTransactionFeeSpy.firstCall.args[0].toTinybars().toNumber(), 'Max fee should be 2 HBAR').to.equal(
        200000000,
      );
      expect(freezeWithSpy.calledWith(sdkClient.getMainClientInstance()), 'freezeWith should be called with client').to
        .be.true;
    });

    it('should configure FileInfoQuery correctly', async () => {
      const setFileIdSpy = sinon.spy(FileInfoQuery.prototype, 'setFileId');

      await sdkClient.deleteFile(
        fileId,
        requestDetails,
        mockedCallerName,
        mockedInteractingEntity,
        randomAccountAddress,
      );

      expect(setFileIdSpy.calledWith(fileId)).to.be.true;
    });

    it('should thrown an error on grpcTimeout', async () => {
      executeQueryStub.restore();
      const mockTransactionResponse = getMockedTransactionResponse();
      const deleteFileStub = sinon.stub(FileInfoQuery.prototype, 'execute');

      executeTransactionStub.resolves(mockTransactionResponse);
      deleteFileStub.rejects({ status: { _code: 17 }, message: 'Transaction Record Not Found' });

      try {
        await sdkClient.deleteFile(
          fileId,
          requestDetails,
          mockedCallerName,
          mockedInteractingEntity,
          randomAccountAddress,
        );
      } catch (error: any) {
        expect(error.code).to.equal(-32010);
        expect(error.message).to.equal('Request timeout. Please try again.');
      }
    });
  });

  describe('getTransactionRecordMetrics', () => {
    const operatorAccountId = '0.0.1234';
    const txId = '0.0.34776@1753096664.508922388';
    const txConstructorName = 'TestTx';
    const fakeGasUsed = Long.fromNumber(999);

    beforeEach(() => {
      sinon.restore();
    });

    describe('getTransactionRecordMetrics', () => {
      it('returns correct metrics for a successful record', async () => {
        const fakeReceipt = { status: Status.Success, exchangeRate: { exchangeRateInCents: 10 } } as any;
        const fakeRecord: any = {
          receipt: fakeReceipt,
          contractFunctionResult: { gasUsed: fakeGasUsed },
          transfers: [
            { accountId: operatorAccountId, amount: Hbar.fromTinybars(-100), is_approval: false },
            { accountId: operatorAccountId, amount: Hbar.fromTinybars(-200), is_approval: false },
          ],
        };
        sinon.stub(TransactionRecordQuery.prototype, 'execute').resolves(fakeRecord);
        sinon.stub(sdkClient as any, 'calculateTxRecordChargeAmount').returns(1234);
        sinon.stub(sdkClient as any, 'getTransferAmountSumForAccount').returns(300);

        const metrics = await sdkClient.getTransactionRecordMetrics(
          txId,
          txConstructorName,
          operatorAccountId,
          requestDetails,
        );

        expect(metrics.gasUsed).to.eq(fakeGasUsed.toNumber());
        expect(metrics.transactionFee).to.eq(300);
        expect(metrics.txRecordChargeAmount).to.eq(1234);
        expect(metrics.status).to.eq(fakeReceipt.status.toString());
      });

      it('throws SDKClientError when TransactionRecordQuery fails', async () => {
        const error = { status: { _code: 404 }, message: 'Not Found' };
        sinon.stub(TransactionRecordQuery.prototype, 'execute').throws(error);
        try {
          await sdkClient.getTransactionRecordMetrics(txId, txConstructorName, operatorAccountId, requestDetails);
          expect.fail('should have thrown');
        } catch (err: any) {
          expect(err).to.be.instanceOf(SDKClientError);
          expect(err.status).to.eql(error.status);
          expect(err.message).to.eq(error.message);
        }
      });
    });
  });
});
