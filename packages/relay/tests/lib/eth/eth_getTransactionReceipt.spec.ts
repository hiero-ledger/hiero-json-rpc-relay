// SPDX-License-Identifier: Apache-2.0

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon, { createSandbox } from 'sinon';

import { predefined } from '../../../src';
import constants from '../../../src/lib/constants';
import { RequestDetails } from '../../../src/lib/types';
import RelayAssertions from '../../assertions';
import { defaultErrorMessageHex } from '../../helpers';
import { BLOCK_HASH, BLOCK_NUMBER, DEFAULT_BLOCK, EMPTY_LOGS_RESPONSE, GAS_USED_1, GAS_USED_2 } from './eth-config';
import { generateEthTestEnv } from './eth-helpers';

use(chaiAsPromised);

describe('@ethGetTransactionReceipt eth_getTransactionReceipt tests', async function () {
  this.timeout(10000);
  const { restMock, ethImpl, cacheService } = generateEthTestEnv();
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
    access_list: '0x',
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
    restMock.onGet(`contracts/results/${txHash}`).reply(
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
      .onGet(`contracts/results/${defaultTxHash}`)
      .reply(200, JSON.stringify(defaultDetailedContractResultByHash));
    restMock.onGet(`contracts/results?block.number=${BLOCK_NUMBER}`).reply(
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
      .onGet(`contracts/results/${defaultTxHash}`)
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
      .onGet(`contracts/results/${defaultTxHash}`)
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

    restMock.onGet(`contracts/results/${uniqueTxHash}`).reply(200, JSON.stringify(contractResult));
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

    restMock.onGet(`contracts/results/${defaultTxHash}`).reply(200, JSON.stringify(receiptWith0xBloom));
    restMock.onGet(`contracts/${defaultDetailedContractResultByHash.created_contract_ids[0]}`).reply(404);
    stubBlockAndFeesFunc(sandbox);
    const receipt = await ethImpl.getTransactionReceipt(defaultTxHash, requestDetails);

    expect(receipt).to.exist;
    if (receipt == null) return;

    expect(receipt.logsBloom).to.eq(emptyBloom);
  });

  it('Adds a revertReason field for receipts with errorMessage', async function () {
    const receiptWithErrorMessage = {
      ...defaultDetailedContractResultByHash,
      error_message: defaultErrorMessageHex,
    };

    // fake unique hash so request dont re-use the cached value but the mock defined
    const uniqueTxHash = '0x04cad7b827375d10d73af57b6a3e843536457d31305ea58ff52dda53ec640533';

    restMock.onGet(`contracts/results/${uniqueTxHash}`).reply(200, JSON.stringify(receiptWithErrorMessage));
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
    restMock.onGet(`contracts/results/${uniqueTxHash}`).reply(200, JSON.stringify(receiptWithNullGasUsed));
    restMock.onGet(`contracts/${defaultDetailedContractResultByHash.created_contract_ids[0]}`).reply(404);
    stubBlockAndFeesFunc(sandbox);
    const receipt = await ethImpl.getTransactionReceipt(uniqueTxHash, requestDetails);

    expect(receipt).to.exist;
    if (receipt == null) return;
    expect(receipt.gasUsed).to.eq('0x0');
  });

  it('should throw an error if transaction index is falsy', async function () {
    // fake unique hash so request dont re-use the cached value but the mock defined
    const uniqueTxHash = '0x17cad7b827375d12d73af57b6a3e84353645fd31305ea58ff52dda53ec640533';

    // mirror node request mocks
    restMock.onGet(`contracts/results/${uniqueTxHash}`).reply(
      200,
      JSON.stringify({
        ...defaultDetailedContractResultByHash,
        ...{
          transaction_index: undefined,
        },
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
      expect(error).to.exist;
      expect(error).to.eq(predefined.DEPENDENT_SERVICE_IMMATURE_RECORDS);
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

    restMock.onGet(`contracts/results/${uniqueTxHash}`).reply(200, JSON.stringify(contractResultWithNullTo));
    restMock.onGet(`contracts/${defaultDetailedContractResultByHash.created_contract_ids[0]}`).reply(404);
    stubBlockAndFeesFunc(sandbox);

    const receipt = await ethImpl.getTransactionReceipt(uniqueTxHash, requestDetails);
    expect(receipt).to.exist;
    expect(receipt?.to).to.be.null;
  });

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

    restMock.onGet(`contracts/results/${secondTxHash}`).reply(200, JSON.stringify(secondTxContractResult));

    restMock.onGet(`contracts/results?block.number=${BLOCK_NUMBER}&limit=100&order=asc`).reply(
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
