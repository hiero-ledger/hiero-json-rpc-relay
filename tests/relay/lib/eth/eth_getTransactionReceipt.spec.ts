// SPDX-License-Identifier: Apache-2.0

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import type sinon from 'sinon';
import { createSandbox } from 'sinon';

import { JsonRpcError } from '../../../../src/relay';
import constants from '../../../../src/relay/lib/constants';
import { RequestDetails } from '../../../../src/relay/lib/types';
import RelayAssertions from '../../assertions';
import { defaultErrorMessageHex, withOverriddenEnvsInMochaTest } from '../../helpers';
import {
  BLOCK_HASH,
  BLOCK_NUMBER,
  DEFAULT_BLOCK,
  DEFAULT_LOGS_3,
  EMPTY_LOGS_RESPONSE,
  GAS_USED_1,
  GAS_USED_2,
} from './eth-config';
import { generateEthTestEnv } from './eth-helpers';

use(chaiAsPromised);

describe('@ethGetTransactionReceipt eth_getTransactionReceipt tests', async function () {
  this.timeout(10000);
  const { restMock, ethImpl, mirrorNodeInstance, cacheService } = generateEthTestEnv();
  let sandbox: sinon.SinonSandbox;
  const emptyBloom = constants.EMPTY_BLOOM;

  const requestDetails = new RequestDetails({ requestId: 'eth_getTransactionReceiptTest', ipAddress: '0.0.0.0' });

  this.beforeAll(() => {
    // @ts-ignore
    sandbox = createSandbox();
  });

  const contractEvmAddress = '0xd8db0b1dbf8ba6721ef5256ad5fe07d72d1d04b9';
  const defaultTxHash = '0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6392';

  const defaultDetailedContractResultByHash = {
    address: '0xd8db0b1dbf8ba6721ef5256ad5fe07d72d1d04b9',
    amount: 2000000000,
    bloom: emptyBloom,
    call_result: '0x0606',
    contract_id: '0.0.5001',
    created_contract_ids: ['0.0.7001'],
    error_message: null,
    from: '0x0000000000000000000000000000000000001f41',
    function_parameters: '0x0707',
    gas_limit: 1000000,
    gas_used: 123,
    timestamp: '167654.000123456',
    to: '0x0000000000000000000000000000000000001389',
    block_hash: '0xd693b532a80fed6392b428604171fb32fdbf953728a3a7ecc7d4062b1652c042000102030405060708090a0b0c0d0e0f',
    block_number: 17,
    logs: [
      {
        address: '0x0000000000000000000000000000000000001389',
        bloom: emptyBloom,
        contract_id: '0.0.5001',
        data: '0x0123',
        index: 0,
        topics: ['0x97c1fc0a6ed5551bc831571325e9bdb365d06803100dc20648640ba24ce69750'],
      },
    ],
    result: 'SUCCESS',
    transaction_index: 0,
    hash: '0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6392',
    state_changes: [
      {
        address: '0x0000000000000000000000000000000000001389',
        contract_id: '0.0.5001',
        slot: '0x0000000000000000000000000000000000000000000000000000000000000101',
        value_read: '0x97c1fc0a6ed5551bc831571325e9bdb365d06803100dc20648640ba24ce69750',
        value_written: '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
      },
    ],
    status: '0x1',
    access_list: [],
    block_gas_used: 50000000,
    chain_id: '0x12a',
    gas_price: '0x4a817c80',
    max_fee_per_gas: '0x',
    max_priority_fee_per_gas: '0x',
    r: '0xd693b532a80fed6392b428604171fb32fdbf953728a3a7ecc7d4062b1652c042',
    s: '0x24e9c602ac800b983b035700a14b23f78a253ab762deab5dc27e3555a750b354',
    type: 2,
    v: 1,
    nonce: 1,
  };

  const defaultReceipt = {
    blockHash: '0xd693b532a80fed6392b428604171fb32fdbf953728a3a7ecc7d4062b1652c042',
    blockNumber: '0x11',
    cumulativeGasUsed: '0x7b', //assuming this is the first transaction in the block
    effectiveGasPrice: '0xad78ebc5ac620000',
    from: '0x0000000000000000000000000000000000001f41',
    to: '0x0000000000000000000000000000000000001389',
    gasUsed: '0x7b',
    logs: [
      {
        address: '0x0000000000000000000000000000000000001389',
        blockHash: '0xd693b532a80fed6392b428604171fb32fdbf953728a3a7ecc7d4062b1652c042',
        blockNumber: '0x11',
        blockTimestamp: '0x28ee6',
        data: '0x0123',
        logIndex: '0x0',
        removed: false,
        topics: ['0x97c1fc0a6ed5551bc831571325e9bdb365d06803100dc20648640ba24ce69750'],
        transactionHash: '0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6392',
        transactionIndex: '0x0',
      },
    ],
    logsBloom: emptyBloom,
    status: '0x1',
    transactionHash: '0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6392',
    transactionIndex: '0x0',
    contractAddress: '0xd8db0b1dbf8ba6721ef5256ad5fe07d72d1d04b9',
    root: undefined,
  };

  const stubBlockAndFeesFunc = (sandbox: sinon.SinonSandbox) => {
    const gasPrice = 12500000000000000000;
    sandbox.stub(ethImpl['common'], <any>'getCurrentGasPriceForBlock').resolves('0xad78ebc5ac620000');
    sandbox.stub(ethImpl, <any>'getBlockByHash').resolves(DEFAULT_BLOCK);
    sandbox.stub(ethImpl['common'], <any>'getGasPriceInWeibars').resolves(gasPrice);
  };

  this.afterEach(async () => {
    restMock.resetHandlers();
    sandbox.restore();
    await cacheService.clear();
  });

  it('returns `null` for non-existent hash', async function () {
    const txHash = '0x0000000000000000000000000000000000000000000000000000000000000001';
    restMock.onGet(`contracts/results/${txHash}?hbar=false`).reply(
      404,
      JSON.stringify({
        _status: {
          messages: [
            {
              message: 'No correlating transaction',
            },
          ],
        },
      }),
    );
    restMock
      .onGet(`contracts/results/logs?transaction.hash=${txHash}&limit=100&order=asc`)
      .reply(200, JSON.stringify(EMPTY_LOGS_RESPONSE));
    const receipt = await ethImpl.getTransactionReceipt(txHash, requestDetails);
    expect(receipt).to.be.null;
  });

  // Mirror Node has no contract result for the hash, but synthetic logs exist: a synthetic receipt is
  // returned rather than falling through to the tracing fallback / null.
  it('returns a synthetic receipt when no contract result exists but synthetic logs do', async function () {
    const txHash = '0x0000000000000000000000000000000000000000000000000000000000000002';
    restMock
      .onGet(`contracts/results/${txHash}?hbar=false`)
      .reply(404, JSON.stringify({ _status: { messages: [{ message: 'No correlating transaction' }] } }));
    restMock
      .onGet(`contracts/results/logs?transaction.hash=${txHash}&limit=100&order=asc`)
      .reply(200, JSON.stringify({ logs: DEFAULT_LOGS_3 }));
    sandbox.stub(ethImpl['common'], <any>'getCurrentGasPriceForBlock').resolves('0xad78ebc5ac620000');

    const receipt = await ethImpl.getTransactionReceipt(txHash, requestDetails);

    expect(receipt).to.not.be.null;
    expect(receipt.logs).to.be.an('array').with.lengthOf(DEFAULT_LOGS_3.length);
    expect(receipt.transactionHash).to.equal(DEFAULT_LOGS_3[0].transaction_hash);
    expect(receipt.effectiveGasPrice).to.equal('0xad78ebc5ac620000');
    expect(receipt.status).to.equal(constants.ONE_HEX);
  });

  it('valid receipt on match', async function () {
    restMock.onGet(`accounts/${defaultDetailedContractResultByHash.from}?transactions=false`).reply(200);
    restMock.onGet(`accounts/${defaultDetailedContractResultByHash.from}?transactions=false`).reply(200);
    restMock.onGet(`accounts/${defaultDetailedContractResultByHash.to}?transactions=false`).reply(200);
    restMock.onGet(`accounts/${defaultDetailedContractResultByHash.to}?transactions=false`).reply(200);
    restMock.onGet(`contracts/${defaultDetailedContractResultByHash.to}`).reply(200);
    restMock.onGet(`contracts/${defaultDetailedContractResultByHash.to}`).reply(200);
    restMock.onGet(`tokens/${defaultDetailedContractResultByHash.contract_id}`).reply(200);
    restMock.onGet(`tokens/${defaultDetailedContractResultByHash.contract_id}`).reply(200);
    // mirror node request mocks
    restMock
      .onGet(`contracts/results/${defaultTxHash}?hbar=false`)
      .reply(200, JSON.stringify(defaultDetailedContractResultByHash));
    restMock.onGet(`contracts/results?block.number=${BLOCK_NUMBER}&hbar=false`).reply(
      200,
      JSON.stringify({
        results: [defaultDetailedContractResultByHash],
        links: { next: null },
      }),
    );
    restMock.onGet(`contracts/${defaultDetailedContractResultByHash.created_contract_ids[0]}`).reply(404);
    stubBlockAndFeesFunc(sandbox);
    const receipt = await ethImpl.getTransactionReceipt(defaultTxHash, requestDetails);

    const currentGasPrice = await ethImpl.gasPrice(requestDetails);

    // Assert the data format
    RelayAssertions.assertTransactionReceipt(receipt, defaultReceipt, {
      effectiveGasPrice: currentGasPrice,
    });
  });

  it('valid receipt on match should hit cache', async function () {
    restMock
      .onGet(`contracts/results/${defaultTxHash}?hbar=false`)
      .replyOnce(200, JSON.stringify(defaultDetailedContractResultByHash));
    restMock.onGet(`contracts/${defaultDetailedContractResultByHash.created_contract_ids[0]}`).replyOnce(404);
    stubBlockAndFeesFunc(sandbox);
    for (let i = 0; i < 3; i++) {
      const receipt = await ethImpl.getTransactionReceipt(defaultTxHash, requestDetails);
      expect(receipt).to.exist;
      if (receipt == null) return;
      expect(RelayAssertions.validateHash(receipt.transactionHash, 64)).to.eq(true);
      expect(receipt.transactionHash).to.exist;
      expect(receipt.to).to.eq(defaultReceipt.to);
      expect(receipt.contractAddress).to.eq(defaultReceipt.contractAddress);
      expect(receipt.logs).to.deep.eq(defaultReceipt.logs);
    }
  });

  it('valid receipt with evm address on match', async function () {
    // mirror node request mocks
    restMock
      .onGet(`contracts/results/${defaultTxHash}?hbar=false`)
      .reply(200, JSON.stringify(defaultDetailedContractResultByHash));
    restMock.onGet(`contracts/${defaultDetailedContractResultByHash.created_contract_ids[0]}`).reply(
      200,
      JSON.stringify({
        evm_address: contractEvmAddress,
      }),
    );
    stubBlockAndFeesFunc(sandbox);
    const receipt = await ethImpl.getTransactionReceipt(defaultTxHash, requestDetails);

    expect(receipt).to.exist;
    if (receipt == null) return;

    expect(RelayAssertions.validateHash(receipt.from, 40)).to.eq(true);
    if (receipt.contractAddress) {
      expect(RelayAssertions.validateHash(receipt.contractAddress, 40)).to.eq(true);
    }
    expect(receipt.contractAddress).to.eq(contractEvmAddress);
  });

  it('Handles null type', async function () {
    const contractResult = {
      ...defaultDetailedContractResultByHash,
      type: null,
    };

    const uniqueTxHash = '0x07cdd7b820375d10d73af57a6a3e84353645fdb1305ea58ff52daa53ec640533';

    restMock.onGet(`contracts/results/${uniqueTxHash}?hbar=false`).reply(200, JSON.stringify(contractResult));
    restMock.onGet(`contracts/${defaultDetailedContractResultByHash.created_contract_ids[0]}`).reply(404);
    stubBlockAndFeesFunc(sandbox);
    const receipt = await ethImpl.getTransactionReceipt(uniqueTxHash, requestDetails);

    expect(receipt).to.exist;
    if (receipt == null) return;

    expect(receipt.type).to.be.eq(constants.ZERO_HEX);
  });

  it('handles empty bloom', async function () {
    const receiptWith0xBloom = {
      ...defaultDetailedContractResultByHash,
      bloom: '0x',
    };

    restMock.onGet(`contracts/results/${defaultTxHash}?hbar=false`).reply(200, JSON.stringify(receiptWith0xBloom));
    restMock.onGet(`contracts/${defaultDetailedContractResultByHash.created_contract_ids[0]}`).reply(404);
    stubBlockAndFeesFunc(sandbox);
    const receipt = await ethImpl.getTransactionReceipt(defaultTxHash, requestDetails);

    expect(receipt).to.exist;
    if (receipt == null) return;

    expect(receipt.logsBloom).to.eq(emptyBloom);
  });

  it('handles bloom for transaction with multiple synthetic transaction logs', async function () {
    const receiptWith0xBloom = {
      ...defaultDetailedContractResultByHash,
      logs: [
        ...defaultDetailedContractResultByHash.logs,
        {
          ...defaultDetailedContractResultByHash.logs[0],
          address: '0x0000000000000000000000000000000000001390',
          topics: ['0x97c1fc0a6ed5551bc831571325e9bdb365d06803100dc20648640ba24ce69750'],
        },
      ],
    };

    restMock.onGet(`contracts/results/${defaultTxHash}?hbar=false`).reply(200, JSON.stringify(receiptWith0xBloom));
    restMock.onGet(`contracts/${defaultDetailedContractResultByHash.created_contract_ids[0]}`).reply(404);
    stubBlockAndFeesFunc(sandbox);
    const receipt = await ethImpl.getTransactionReceipt(defaultTxHash, requestDetails);

    expect(receipt).to.have.property('logs').that.is.an('array').with.lengthOf(receiptWith0xBloom.logs.length);
  });

  it('Adds a revertReason field for receipts with errorMessage', async function () {
    const receiptWithErrorMessage = {
      ...defaultDetailedContractResultByHash,
      error_message: defaultErrorMessageHex,
    };

    // fake unique hash so request dont re-use the cached value but the mock defined
    const uniqueTxHash = '0x04cad7b827375d10d73af57b6a3e843536457d31305ea58ff52dda53ec640533';

    restMock.onGet(`contracts/results/${uniqueTxHash}?hbar=false`).reply(200, JSON.stringify(receiptWithErrorMessage));
    restMock.onGet(`contracts/${defaultDetailedContractResultByHash.created_contract_ids[0]}`).reply(404);
    stubBlockAndFeesFunc(sandbox);
    const receipt = await ethImpl.getTransactionReceipt(uniqueTxHash, requestDetails);

    expect(receipt).to.exist;
    expect(receipt.revertReason).to.eq(defaultErrorMessageHex);
  });

  it('handles empty gas_used', async function () {
    const receiptWithNullGasUsed = {
      ...defaultDetailedContractResultByHash,
      gas_used: null,
    };

    // fake unique hash so request dont re-use the cached value but the mock defined
    const uniqueTxHash = '0x08cad7b827375d12d73af57b6a3e84353645fd31305ea59ff52dda53ec640533';
    restMock.onGet(`contracts/results/${uniqueTxHash}?hbar=false`).reply(200, JSON.stringify(receiptWithNullGasUsed));
    restMock.onGet(`contracts/${defaultDetailedContractResultByHash.created_contract_ids[0]}`).reply(404);
    stubBlockAndFeesFunc(sandbox);
    const receipt = await ethImpl.getTransactionReceipt(uniqueTxHash, requestDetails);

    expect(receipt).to.exist;
    if (receipt == null) return;
    expect(receipt.gasUsed).to.eq('0x0');
  });

  const immatureCases: { title: string; overrides: Record<string, unknown>; uniqueTxHash: string }[] = [
    {
      title: 'transaction index is falsy',
      overrides: { transaction_index: undefined },
      uniqueTxHash: '0x17cad7b827375d12d73af57b6a3e84353645fd31305ea58ff52dda53ec640533',
    },
    {
      title: 'block number is falsy',
      overrides: { block_number: undefined },
      uniqueTxHash: '0x17cad7b827375d12d73af57b6a3e84353645fd31305ea58ff52dda53ec640534',
    },
    {
      title: 'block hash is an empty hex',
      overrides: { block_hash: '0x' },
      uniqueTxHash: '0x17cad7b827375d12d73af57b6a3e84353645fd31305ea58ff52dda53ec640535',
    },
  ];

  immatureCases.forEach(({ title, overrides, uniqueTxHash }) => {
    it(`should throw a -32003 rejection error if ${title}`, async function () {
      // mirror node request mocks
      restMock.onGet(`contracts/results/${uniqueTxHash}?hbar=false`).reply(
        200,
        JSON.stringify({
          ...defaultDetailedContractResultByHash,
          ...overrides,
          result: 'WRONG_NONCE',
          error_message: null,
        }),
      );
      restMock.onGet(`contracts/${defaultDetailedContractResultByHash.created_contract_ids[0]}`).reply(
        200,
        JSON.stringify({
          evm_address: contractEvmAddress,
        }),
      );
      stubBlockAndFeesFunc(sandbox);

      try {
        await ethImpl.getTransactionReceipt(uniqueTxHash, requestDetails);
        expect.fail('should have thrown an error');
      } catch (error) {
        expect(error).to.be.instanceOf(JsonRpcError);
        const jsonRpcError = error as JsonRpcError;
        expect(jsonRpcError.code).to.eq(-32003);
        expect(jsonRpcError.message).to.eq('Transaction rejected: WRONG_NONCE');
        const data = jsonRpcError.data as Record<string, unknown>;
        expect(data.txHash).to.eq(uniqueTxHash);
        expect(data.hederaStatus).to.eq('WRONG_NONCE');
        expect(data.detail).to.eq(
          'The transaction was rejected before execution and will never be included in a block.',
        );
      }
    });
  });

  describe('records without a transaction index', function () {
    const childTxHash = '0x51149a73c4094b5915457449f82eae9b0e45f705d24f6aeb33a858dfe0e765a5';
    const rejectedParentTxHash = '0xf355f575abacc4c8b5493041b27247f957db285a91f25ad0d531abd831007850';

    const childRecord = {
      address: '0x0000000000000000000000000000000000000167',
      amount: 0,
      bloom: emptyBloom,
      call_result: '0x0000000000000000000000000000000000000000000000000000000000000124',
      contract_id: '0.0.359',
      created_contract_ids: [],
      error_message: 'SPENDER_DOES_NOT_HAVE_ALLOWANCE',
      from: '0x0000000000000000000000000000000000893485',
      function_parameters: '0x15dacbea',
      gas_consumed: 15284,
      gas_limit: 4577742,
      gas_used: 15284,
      timestamp: '1787298614.746518110',
      to: '0x0000000000000000000000000000000000000167',
      hash: childTxHash,
      block_hash: '0xf299dce3f4b2a137c932dc476d566833e8061d7df9779ce12b69772a5cc6090f640ea131cbb346e04e441512d0045ea5',
      block_number: 39523147,
      logs: [],
      result: 'SPENDER_DOES_NOT_HAVE_ALLOWANCE',
      transaction_index: null,
      state_changes: [],
      status: '0x0',
      failed_initcode: null,
      access_list: [],
      block_gas_used: 1482946,
      chain_id: '0x128',
      gas_price: '0x71',
      max_fee_per_gas: null,
      max_priority_fee_per_gas: null,
      r: null,
      s: null,
      type: 0,
      v: null,
      nonce: null,
    };

    const rejectedParentRecord = {
      ...childRecord,
      address: '0xe8bf85ee602cb26402b73b3d0bb5b7442a2c3543',
      call_result: '0x',
      contract_id: '0.0.5508307',
      error_message: '0x57524f4e475f4e4f4e4345', // WRONG_NONCE
      from: '0x0000000000000000000000000000000000540d93',
      function_parameters: '0xb1dc65a4',
      gas_consumed: 0,
      gas_used: 0,
      gas_limit: 8000000,
      timestamp: '1787298426.993500843',
      to: '0xe8bf85ee602cb26402b73b3d0bb5b7442a2c3543',
      hash: rejectedParentTxHash,
      block_hash: '0xe4c45ec72408fa6a8b7ac221003c8ecd0bf24bf165786c871391018ac85f67861714e71718d89107e0caa710c71eb0f6',
      block_number: 39523059,
      result: 'WRONG_NONCE',
      block_gas_used: 0,
      gas_price: '0x87',
      max_fee_per_gas: '0x',
      max_priority_fee_per_gas: '0x',
      r: '0x19ca0217817b3744f6bc22fe951ee4a84ae031242b31abf547c51a337d03bff1',
      s: '0x3e38da1f058db712e57c37a779c229c0807909c03332f12a4f062bfd6bf71ea7',
      v: 628,
      nonce: 3019,
    };

    const collapseImmatureRecordPolling = () => {
      sandbox.stub(mirrorNodeInstance, 'getMirrorNodeRequestRetryCount').returns(1);
      sandbox.stub(mirrorNodeInstance, 'getMirrorNodeRetryDelay').returns(0);
    };

    it('should report a child (synthetic) record as not found rather than as a rejected transaction', async function () {
      restMock.onGet(`contracts/results/${childTxHash}?hbar=false`).reply(200, JSON.stringify(childRecord));
      collapseImmatureRecordPolling();

      const receipt = await ethImpl.getTransactionReceipt(childTxHash, requestDetails);

      expect(receipt).to.be.null;
    });

    it('should throw a -32003 rejection error for a rejected top-level transaction', async function () {
      restMock
        .onGet(`contracts/results/${rejectedParentTxHash}?hbar=false`)
        .reply(200, JSON.stringify(rejectedParentRecord));
      collapseImmatureRecordPolling();

      const error = await ethImpl.getTransactionReceipt(rejectedParentTxHash, requestDetails).catch((e) => e);

      expect(error).to.be.instanceOf(JsonRpcError);
      const jsonRpcError = error as JsonRpcError;
      expect(jsonRpcError.code).to.eq(-32003);
      expect(jsonRpcError.message).to.eq('Transaction rejected: WRONG_NONCE');
      const data = jsonRpcError.data as Record<string, unknown>;
      expect(data.txHash).to.eq(rejectedParentTxHash);
      expect(data.hederaStatus).to.eq('WRONG_NONCE');
    });
  });

  it('should carry the mirror node error_message as the rejection detail', async function () {
    const uniqueTxHash = '0x17cad7b827375d12d73af57b6a3e84353645fd31305ea58ff52dda53ec640536';

    restMock.onGet(`contracts/results/${uniqueTxHash}?hbar=false`).reply(
      200,
      JSON.stringify({
        ...defaultDetailedContractResultByHash,
        block_number: undefined,
        transaction_index: undefined,
        result: 'INSUFFICIENT_PAYER_BALANCE',
        error_message: 'payer cannot cover the fee',
      }),
    );
    stubBlockAndFeesFunc(sandbox);

    try {
      await ethImpl.getTransactionReceipt(uniqueTxHash, requestDetails);
      expect.fail('should have thrown an error');
    } catch (error) {
      const jsonRpcError = error as JsonRpcError;
      expect(jsonRpcError.code).to.eq(-32003);
      expect(jsonRpcError.message).to.eq('Transaction rejected: INSUFFICIENT_PAYER_BALANCE');
      expect((jsonRpcError.data as Record<string, unknown>).detail).to.eq('payer cannot cover the fee');
    }
  });

  it('valid receipt on cache match', async function () {
    const cacheKey = `${constants.CACHE_KEY.ETH_GET_TRANSACTION_RECEIPT.replace('eth_', '')}_${
      defaultDetailedContractResultByHash.hash
    }`;
    const cacheReceipt = {
      blockHash: defaultDetailedContractResultByHash.block_hash,
      blockNumber: defaultDetailedContractResultByHash.block_number,
      from: defaultDetailedContractResultByHash.from,
      to: defaultDetailedContractResultByHash.to,
      cumulativeGasUsed: defaultDetailedContractResultByHash.block_gas_used,
      gasUsed: defaultDetailedContractResultByHash.gas_used,
      contractAddress: defaultDetailedContractResultByHash.address,
      logs: defaultDetailedContractResultByHash.logs,
      logsBloom: defaultDetailedContractResultByHash.bloom,
      transactionHash: defaultDetailedContractResultByHash.hash,
      transactionIndex: defaultDetailedContractResultByHash.transaction_index,
      status: defaultDetailedContractResultByHash.status,
      type: defaultDetailedContractResultByHash.type,
    };

    await cacheService.set(cacheKey, cacheReceipt, constants.ETH_GET_TRANSACTION_RECEIPT);

    // w no mirror node requests
    const receipt = await ethImpl.getTransactionReceipt(defaultTxHash, requestDetails);

    // Assert the matching reciept
    expect(receipt.blockHash).to.eq(cacheReceipt.blockHash);
    expect(receipt.blockNumber).to.eq(cacheReceipt.blockNumber);
    expect(receipt.contractAddress).to.eq(cacheReceipt.contractAddress);
    expect(receipt.cumulativeGasUsed).to.eq(cacheReceipt.cumulativeGasUsed);
    expect(receipt.from).to.eq(cacheReceipt.from);
    expect(receipt.gasUsed).to.eq(cacheReceipt.gasUsed);
    expect(receipt.logs).to.deep.eq(cacheReceipt.logs);
    expect(receipt.logsBloom).to.be.eq(cacheReceipt.logsBloom);
    expect(receipt.status).to.eq(cacheReceipt.status);
    expect(receipt.to).to.eq(cacheReceipt.to);
    expect(receipt.transactionHash).to.eq(cacheReceipt.transactionHash);
    expect(receipt.transactionIndex).to.eq(cacheReceipt.transactionIndex);
  });

  it('should handle receipt with null "to" field', async function () {
    const contractResultWithNullTo = {
      ...defaultDetailedContractResultByHash,
      to: null,
    };

    const uniqueTxHash = '0x17cad7b827375d12d73af57b6a3e84353645fd31305ea58ff52dda53ec640533';

    restMock.onGet(`contracts/results/${uniqueTxHash}?hbar=false`).reply(200, JSON.stringify(contractResultWithNullTo));
    restMock.onGet(`contracts/${defaultDetailedContractResultByHash.created_contract_ids[0]}`).reply(404);
    stubBlockAndFeesFunc(sandbox);

    const receipt = await ethImpl.getTransactionReceipt(uniqueTxHash, requestDetails);
    expect(receipt).to.exist;
    expect(receipt?.to).to.be.null;
  });

  withOverriddenEnvsInMochaTest({ HEDERA_SPECIFIC_REVERT_STATUSES: ['WRONG_NONCE'] }, () => {
    it('should handle cumulative gas used for receipt with multiple transactions in the block', async function () {
      const tx1GasUsed = GAS_USED_1;
      const tx2GasUsed = GAS_USED_2;
      const blockGasUsed = tx1GasUsed + tx2GasUsed;

      const secondTxHash = '0xbcfc47c474ebcf39f71f47414713325b37b81df00b5d0eed6703dd7bf6a80a7e';

      const secondTxContractResult = {
        ...defaultDetailedContractResultByHash,
        hash: secondTxHash,
        block_hash: BLOCK_HASH,
        block_number: BLOCK_NUMBER,
        gas_used: tx2GasUsed,
        block_gas_used: blockGasUsed,
        transaction_index: 1,
        result: 'WRONG_NONCE',
      };

      restMock.onGet(`accounts/${secondTxContractResult.from}?transactions=false`).reply(200);
      restMock.onGet(`accounts/${secondTxContractResult.from}?transactions=false`).reply(200);
      restMock.onGet(`accounts/${secondTxContractResult.to}?transactions=false`).reply(200);
      restMock.onGet(`accounts/${secondTxContractResult.to}?transactions=false`).reply(200);
      restMock.onGet(`contracts/${secondTxContractResult.to}`).reply(200);
      restMock.onGet(`contracts/${secondTxContractResult.to}`).reply(200);
      restMock.onGet(`tokens/${secondTxContractResult.contract_id}`).reply(200);
      restMock.onGet(`tokens/${secondTxContractResult.contract_id}`).reply(200);
      restMock.onGet(`contracts/${secondTxContractResult.created_contract_ids[0]}`).reply(404);

      stubBlockAndFeesFunc(sandbox);

      restMock.onGet(`contracts/results/${secondTxHash}?hbar=false`).reply(200, JSON.stringify(secondTxContractResult));

      restMock.onGet(`contracts/results?block.number=${BLOCK_NUMBER}&limit=100&order=asc&hbar=false`).reply(
        200,
        JSON.stringify({
          results: [
            {
              ...defaultDetailedContractResultByHash,
              block_hash: BLOCK_HASH,
              block_number: BLOCK_NUMBER,
              block_gas_used: blockGasUsed,
              gas_used: tx1GasUsed,
              transaction_index: 0,
            },
            secondTxContractResult, // tx2
          ],
          links: { next: null },
        }),
      );

      const receipt = await ethImpl.getTransactionReceipt(secondTxHash, requestDetails);

      expect(receipt).to.exist;
      if (!receipt) return;

      const expectedGasUsedHex = '0x' + tx2GasUsed.toString(16);
      expect(receipt.gasUsed).to.equal(expectedGasUsedHex);

      const expectedCumulativeHex = '0x' + blockGasUsed.toString(16);
      expect(receipt.cumulativeGasUsed).to.equal(expectedCumulativeHex);
    });
  });
});
