// SPDX-License-Identifier: Apache-2.0
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
use(chaiAsPromised);

import { MirrorNodeClient } from '../../../../../src/lib/clients';
import { Log } from '../../../../../src/lib/model';
import { BlockService } from '../../../../../src/lib/services';
import { CommonService } from '../../../../../src/lib/services';
import { CacheService } from '../../../../../src/lib/services/cacheService/cacheService';
import { RequestDetails } from '../../../../../src/lib/types';

describe('BlockService', () => {
  let blockService: BlockService;
  let commonService: CommonService;
  let mirrorNodeClient: MirrorNodeClient;
  let cacheService: CacheService;
  let logger: any;
  let sandbox: sinon.SinonSandbox;
  let requestDetails: RequestDetails;

  // Fixtures
  const blockHashOrNumber = '0x1234';
  const mockBlock = {
    number: 123,
    timestamp: {
      from: '1622567324.000000000',
      to: '1622567325.000000000',
    },
  };

  const createMockContractResult = (overrides = {}) => ({
    hash: '0xabc123',
    from: '0xoriginalFromAddress',
    to: '0xoriginalToAddress',
    result: 'SUCCESS',
    address: '0xcontractAddress',
    block_hash: '0xblockHash',
    block_number: 123,
    block_gas_used: 100000,
    gas_used: 50000,
    transaction_index: 0,
    status: '0x1',
    function_parameters: '0x608060405234801561001057600080fd5b50',
    call_result: '0x',
    created_contract_ids: [],
    ...overrides,
  });

  const createMockLogs = () => [
    new Log({
      address: '0xlogsAddress',
      blockHash: '0xblockHash',
      blockNumber: '0x123',
      data: '0xdata',
      logIndex: '0x0',
      removed: false,
      topics: ['0xtopic1'],
      transactionHash: '0xabc123',
      transactionIndex: '0x0',
    }),
  ];

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    logger = {
      trace: sandbox.stub(),
      debug: sandbox.stub(),
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      fatal: sandbox.stub(),
      isLevelEnabled: sandbox.stub().returns(true),
    };

    mirrorNodeClient = {
      getContractResults: sandbox.stub(),
      getHistoricalBlockResponse: sandbox.stub(),
      getLatestBlock: sandbox.stub(),
    } as unknown as MirrorNodeClient;

    commonService = {
      getHistoricalBlockResponse: sinon.stub(),
      getLogsWithParams: sinon.stub(),
      resolveEvmAddress: sinon.stub(),
      getGasPriceInWeibars: sinon.stub(),
      genericErrorHandler: sinon.stub(),
    } as unknown as CommonService;

    cacheService = {
      getAsync: sandbox.stub().resolves(null),
      set: sandbox.stub().resolves(),
    } as unknown as CacheService;

    blockService = new BlockService(
      cacheService as any,
      '0x12a',
      commonService as any,
      mirrorNodeClient as any,
      logger,
    );

    requestDetails = new RequestDetails({
      requestId: 'test-request-id',
      ipAddress: '127.0.0.1',
    });

    // Common stubs for all tests
    (commonService.getHistoricalBlockResponse as sinon.SinonStub).resolves(mockBlock);
    (commonService.getLogsWithParams as sinon.SinonStub).resolves(createMockLogs());
    (commonService.getGasPriceInWeibars as sinon.SinonStub).resolves(100000000);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getBlockReceipts', () => {
    it('should resolve from and to addresses correctly', async () => {
      // Setup
      const mockContractResults = [createMockContractResult()];
      (mirrorNodeClient.getContractResults as sinon.SinonStub).resolves(mockContractResults);

      const resolvedFromAddress = '0xresolvedFromAddress';
      const resolvedToAddress = '0xresolvedToAddress';

      (commonService.resolveEvmAddress as sinon.SinonStub)
        .withArgs('0xoriginalFromAddress', requestDetails)
        .resolves(resolvedFromAddress);

      (commonService.resolveEvmAddress as sinon.SinonStub)
        .withArgs('0xoriginalToAddress', requestDetails)
        .resolves(resolvedToAddress);

      // Execute
      const receipts = await blockService.getBlockReceipts(blockHashOrNumber, requestDetails);

      // Verify
      expect(receipts).to.have.length(1);
      expect(receipts[0].from).to.equal(resolvedFromAddress);
      expect(receipts[0].to).to.equal(resolvedToAddress);
      expect((commonService.resolveEvmAddress as sinon.SinonStub).calledWith('0xoriginalFromAddress', requestDetails))
        .to.be.true;
      expect((commonService.resolveEvmAddress as sinon.SinonStub).calledWith('0xoriginalToAddress', requestDetails)).to
        .be.true;
    });

    it('should throw error when from address cannot be resolved', async () => {
      // Setup
      const mockContractResults = [createMockContractResult()];
      (mirrorNodeClient.getContractResults as sinon.SinonStub).resolves(mockContractResults);

      (commonService.resolveEvmAddress as sinon.SinonStub)
        .withArgs('0xoriginalFromAddress', requestDetails, undefined)
        .resolves(null);

      (commonService.resolveEvmAddress as sinon.SinonStub)
        .withArgs('0xoriginalToAddress', requestDetails, undefined)
        .resolves('0xresolvedToAddress');

      // Execute & Verify
      await expect(blockService.getBlockReceipts(blockHashOrNumber, requestDetails)).to.be.rejectedWith(
        `Failed to resolve from address: 0xoriginalFromAddress`,
      );
    });

    it('should handle null to field for contract creation transactions', async () => {
      // Setup
      const mockContractResults = [
        createMockContractResult({
          to: null,
          address: '0xnewlyCreatedContractAddress',
        }),
      ];

      (mirrorNodeClient.getContractResults as sinon.SinonStub).resolves(mockContractResults);

      (commonService.resolveEvmAddress as sinon.SinonStub)
        .withArgs('0xoriginalFromAddress', requestDetails)
        .resolves('0xresolvedFromAddress');

      (commonService.resolveEvmAddress as sinon.SinonStub).withArgs(null, requestDetails).resolves(null);

      // Execute
      const receipts = await blockService.getBlockReceipts(blockHashOrNumber, requestDetails);

      // Verify
      expect(receipts).to.have.length(1);
      expect(receipts[0].from).to.equal('0xresolvedFromAddress');
      expect(receipts[0].to).to.equal(null);
      expect(receipts[0].contractAddress).to.not.be.null;

      expect((commonService.resolveEvmAddress as sinon.SinonStub).calledWith('0xoriginalFromAddress', requestDetails))
        .to.be.true;
      expect((commonService.resolveEvmAddress as sinon.SinonStub).calledWith(null, requestDetails)).to.be.true;
    });

    it('should set to field to null when contract is in created_contract_ids', async () => {
      // Setup
      const contractId = '0.0.1234';
      const mockContractResults = [
        createMockContractResult({
          to: '0xoriginalToAddress',
          contract_id: contractId,
          created_contract_ids: [contractId],
        }),
      ];

      (mirrorNodeClient.getContractResults as sinon.SinonStub).resolves(mockContractResults);

      (commonService.resolveEvmAddress as sinon.SinonStub)
        .withArgs('0xoriginalFromAddress', requestDetails)
        .resolves('0xresolvedFromAddress');

      (commonService.resolveEvmAddress as sinon.SinonStub).withArgs(null, requestDetails).resolves(null);

      // Execute
      const receipts = await blockService.getBlockReceipts(blockHashOrNumber, requestDetails);

      // Verify
      expect(receipts).to.have.length(1);
      expect(receipts[0].from).to.equal('0xresolvedFromAddress');
      expect(receipts[0].to).to.equal(null);
    });

    it('should keep original to field when contract is not in created_contract_ids', async () => {
      // Setup
      const contractId = '0.0.1234';
      const mockContractResults = [
        createMockContractResult({
          to: '0xoriginalToAddress',
          contract_id: contractId,
          created_contract_ids: ['0.0.5678'], // Different contract ID
        }),
      ];

      (mirrorNodeClient.getContractResults as sinon.SinonStub).resolves(mockContractResults);

      (commonService.resolveEvmAddress as sinon.SinonStub)
        .withArgs('0xoriginalFromAddress', requestDetails)
        .resolves('0xresolvedFromAddress');

      (commonService.resolveEvmAddress as sinon.SinonStub)
        .withArgs('0xoriginalToAddress', requestDetails)
        .resolves('0xresolvedToAddress');

      // Execute
      const receipts = await blockService.getBlockReceipts(blockHashOrNumber, requestDetails);

      // Verify
      expect(receipts).to.have.length(1);
      expect(receipts[0].from).to.equal('0xresolvedFromAddress');
      expect(receipts[0].to).to.equal('0xresolvedToAddress');
    });
  });
});
