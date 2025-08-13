// SPDX-License-Identifier: Apache-2.0

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { predefined } from '../../../src';
import { Transaction, Transaction1559, Transaction2930 } from '../../../src/lib/model';
import { RequestDetails } from '../../../src/lib/types';
import RelayAssertions from '../../assertions';
import { defaultDetailedContractResultByHash, defaultFromLongZeroAddress } from '../../helpers';
import {
  DEFAULT_DETAILED_CONTRACT_RESULT_BY_HASH_REVERTED,
  DEFAULT_TRANSACTION,
  DEFAULT_TX_HASH,
  DETAILD_CONTRACT_RESULT_NOT_FOUND,
  EMPTY_LOGS_RESPONSE,
  NO_TRANSACTIONS,
} from './eth-config';
import { generateEthTestEnv } from './eth-helpers';

use(chaiAsPromised);

describe('@ethGetTransactionByHash eth_getTransactionByHash tests', async function () {
  this.timeout(100000);
  const { restMock, ethImpl } = generateEthTestEnv();
  const from = '0x00000000000000000000000000000000000003f7';
  const evm_address = '0xc37f417fa09933335240fca72dd257bfbde9c275';
  const contractResultMock = {
    address: '0x67d8d32e9bf1a9968a5ff53b87d777aa8ebbee69',
    amount: 20,
    bloom:
      '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    call_result: '0x',
    contract_id: '0.0.1012',
    created_contract_ids: [],
    error_message: null,
    from: '0x00000000000000000000000000000000000003f7',
    function_parameters: '0x',
    gas_limit: 250000,
    gas_used: 200000,
    timestamp: '1692959189.214316721',
    to: '0x00000000000000000000000000000000000003f4',
    hash: '0x7e8a09541c80ccda1f5f40a1975e031ed46de5ad7f24cd4c37be9bac65149b9e',
    block_hash: '0xa414a76539f84ae1c797fa10d00e49d5e7a1adae556dcd43084551e671623d2eba825bcb7bbfd5b7e3fe59d63d8a167f',
    block_number: 61033,
    logs: [],
    result: 'SUCCESS',
    transaction_index: 2,
    state_changes: [],
    status: '0x1',
    failed_initcode: null,
    block_gas_used: 200000,
    chain_id: '0x12a',
    gas_price: '0x',
    r: '0x85b423416d0164d0b2464d880bccb0679587c00673af8e016c8f0ce573be69b2',
    s: '0x3897a5ce2ace1f242d9c989cd9c163d79760af4266f3bf2e69ee288bcffb211a',
    v: 1,
    nonce: 9,
  };

  const requestDetails = new RequestDetails({ requestId: 'eth_getTransactionByHashTest', ipAddress: '0.0.0.0' });

  this.beforeEach(function () {
    restMock.reset();
    restMock.onGet(`accounts/${defaultFromLongZeroAddress}${NO_TRANSACTIONS}`).reply(
      200,
      JSON.stringify({
        evm_address: `${DEFAULT_TRANSACTION.from}`,
      }),
    );
    restMock.onGet(`accounts/${from}?transactions=false`).reply(
      200,
      JSON.stringify({
        evm_address: evm_address,
      }),
    );
  });

  it('returns 155 transaction for type 0', async function () {
    const uniqueTxHash = '0x27cad7b827375d12d73af57b6a3e84353645fd31305ea58ff52dda53ec640533';
    restMock.onGet(`contracts/results/${uniqueTxHash}`).reply(
      200,
      JSON.stringify({
        ...contractResultMock,
        type: 0,
      }),
    );

    const result = await ethImpl.getTransactionByHash(uniqueTxHash, requestDetails);
    expect(result).to.be.an.instanceOf(Transaction);
  });

  it('returns 2930 transaction for type 1', async function () {
    const uniqueTxHash = '0x28cad7b827375d12d73af57b6a3e84353645fd31305ea58ff52dda53ec640533';
    restMock.onGet(`contracts/results/${uniqueTxHash}`).reply(
      200,
      JSON.stringify({
        ...contractResultMock,
        type: 1,
        access_list: [],
      }),
    );

    const result = await ethImpl.getTransactionByHash(uniqueTxHash, requestDetails);
    expect(result).to.be.an.instanceOf(Transaction2930);
  });

  it('returns 1559 transaction for type 2', async function () {
    const uniqueTxHash = '0x27cad7b827375d12d73af57b7a3e84353645fd31305ea58ff52dda53ec640533';
    restMock.onGet(`contracts/results/${uniqueTxHash}`).reply(
      200,
      JSON.stringify({
        ...contractResultMock,
        type: 2,
        access_list: [],
        max_fee_per_gas: '0x47',
        max_priority_fee_per_gas: '0x47',
      }),
    );

    const result = await ethImpl.getTransactionByHash(uniqueTxHash, requestDetails);
    expect(result).to.be.an.instanceOf(Transaction1559);
  });

  it('returns `null` for non-existing hash', async function () {
    const uniqueTxHash = '0x27cAd7b838375d12d73af57b6a3e84353645fd31305ea58ff52dda53ec640533';
    restMock.onGet(`contracts/results/${uniqueTxHash}`).reply(404, JSON.stringify(DETAILD_CONTRACT_RESULT_NOT_FOUND));
    restMock
      .onGet(`contracts/results/logs?transaction.hash=${uniqueTxHash}&limit=100&order=asc`)
      .reply(200, JSON.stringify(EMPTY_LOGS_RESPONSE));

    const result = await ethImpl.getTransactionByHash(uniqueTxHash, requestDetails);
    expect(result).to.equal(null);
  });

  it('returns a valid transaction for synthetic transactions', async function () {
    const uniqueTxHash = '0x1b1aaac9ee7b1ad9f95651aeec8d3beb80bb0197d01234a85a643e2ea02a55a5';
    const logs = {
      logs: [
        {
          address: '0x00000000000000000000000000000000006390e6',
          bloom: '0x00',
          contract_id: '0.0.6525158',
          data: '0x000000000000000000000000000000000000000000000000000000000000000a',
          index: 0,
          topics: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
            '0x000000000000000000000000b562f7740eb5b7a2177994765f76c7b964437e85',
            '0x00000000000000000000000025639d1a6b4d3ace699d541d15b898bd6a7fd5bb',
          ],
          block_hash:
            '0x730c1d0263e78303b189d778a75451113162547b4b466cb8c1796deef3a8a5e486aef01c205e42af0f1abc3c1cb2378c',
          block_number: 23279896,
          root_contract_id: '0.0.6525158',
          timestamp: '1754605000.616067461',
          transaction_hash: '0x1b1aaac9ee7b1ad9f95651aeec8d3beb80bb0197d01234a85a643e2ea02a55a5',
          transaction_index: 7,
        },
      ],
      links: { next: null },
    };
    restMock.onGet(`contracts/results/${uniqueTxHash}`).reply(404, JSON.stringify(DETAILD_CONTRACT_RESULT_NOT_FOUND));
    restMock
      .onGet(`contracts/results/logs?transaction.hash=${uniqueTxHash}&limit=100&order=asc`)
      .reply(200, JSON.stringify(logs));

    const result = await ethImpl.getTransactionByHash(uniqueTxHash, requestDetails);
    expect(result).to.be.deep.equal({
      blockHash: '0x730c1d0263e78303b189d778a75451113162547b4b466cb8c1796deef3a8a5e4',
      blockNumber: '0x1633918',
      chainId: '0x12a',
      from: '0x00000000000000000000000000000000006390e6',
      gas: '0x61a80',
      gasPrice: '0xfe',
      hash: '0x1b1aaac9ee7b1ad9f95651aeec8d3beb80bb0197d01234a85a643e2ea02a55a5',
      input: '0x0000000000000000',
      nonce: '0x0',
      r: '0x',
      s: '0x',
      to: '0x00000000000000000000000000000000006390e6',
      transactionIndex: '0x7',
      type: '0x2',
      v: '0x0',
      yParity: '0x0',
      accessList: [],
      maxPriorityFeePerGas: '0x0',
      maxFeePerGas: '0x0',
      value: '0x0',
    });
  });

  it('account should be cached', async function () {
    restMock
      .onGet(`contracts/results/${DEFAULT_TX_HASH}`)
      .reply(200, JSON.stringify(defaultDetailedContractResultByHash));
    const resBeforeCache = await ethImpl.getTransactionByHash(DEFAULT_TX_HASH, requestDetails);
    restMock.onGet(`accounts/${defaultFromLongZeroAddress}${NO_TRANSACTIONS}`).reply(404);
    const resAfterCache = await ethImpl.getTransactionByHash(DEFAULT_TX_HASH, requestDetails);
    expect(resBeforeCache).to.deep.equal(resAfterCache);
  });

  it('returns correct transaction for existing hash', async function () {
    restMock
      .onGet(`contracts/results/${DEFAULT_TX_HASH}`)
      .reply(200, JSON.stringify(defaultDetailedContractResultByHash));
    const result = await ethImpl.getTransactionByHash(DEFAULT_TX_HASH, requestDetails);
    RelayAssertions.assertTransaction(result, {
      ...DEFAULT_TRANSACTION,
      maxFeePerGas: '0x55',
      maxPriorityFeePerGas: '0x43',
    });
  });

  it('returns correct transaction for existing hash w no sigs', async function () {
    const detailedResultsWithZeroXZeroValues = {
      ...defaultDetailedContractResultByHash,
      r: null,
      s: null,
    };

    const uniqueTxHash = '0x97cad7b827375d12d73af57b6a3f84353645fd31305ea58ff52dda53ec640533';

    restMock.onGet(`contracts/results/${uniqueTxHash}`).reply(200, JSON.stringify(detailedResultsWithZeroXZeroValues));
    const result = await ethImpl.getTransactionByHash(uniqueTxHash, requestDetails);
    RelayAssertions.assertTransaction(result, {
      ...DEFAULT_TRANSACTION,
      maxFeePerGas: '0x55',
      maxPriorityFeePerGas: '0x43',
      r: '0x0',
      s: '0x0',
    });
  });

  it('handles transactions with null gas_used', async function () {
    const detailedResultsWithNullNullableValues = {
      ...defaultDetailedContractResultByHash,
      gas_used: null,
    };
    const uniqueTxHash = '0x14aad7b827375d12d73af57b6a3e84353645fd31305ea58ff52dda53ec640533';

    restMock
      .onGet(`contracts/results/${uniqueTxHash}`)
      .reply(200, JSON.stringify(detailedResultsWithNullNullableValues));
    const result = await ethImpl.getTransactionByHash(uniqueTxHash, requestDetails);
    expect(result).to.not.be.null;

    expect(result).to.exist;
    if (result) expect(result.gas).to.eq('0x0');
  });

  it('handles transactions with null amount', async function () {
    const detailedResultsWithNullNullableValues = {
      ...defaultDetailedContractResultByHash,
      amount: null,
    };
    const uniqueTxHash = '0x0aaad7b827375d12d73af57b6a3e84353645fd31305ea58ff52dda53ec640533';

    restMock
      .onGet(`contracts/results/${uniqueTxHash}`)
      .reply(200, JSON.stringify(detailedResultsWithNullNullableValues));
    const result = await ethImpl.getTransactionByHash(uniqueTxHash, requestDetails);
    expect(result).to.not.be.null;

    expect(result).to.exist;
    if (result) expect(result.value).to.eq('0x0');
  });

  it('handles transactions with v as null', async function () {
    const detailedResultsWithNullNullableValues = {
      ...defaultDetailedContractResultByHash,
      v: null,
      type: 0,
    };
    const uniqueTxHash = '0xb4cad7b827375d12d73af57b6a3e84353645fd31305ea58ff52dda53ec640533';

    restMock
      .onGet(`contracts/results/${uniqueTxHash}`)
      .reply(200, JSON.stringify(detailedResultsWithNullNullableValues));
    const result = await ethImpl.getTransactionByHash(uniqueTxHash, requestDetails);
    expect(result).to.not.be.null;

    expect(result).to.exist;
    if (result) expect(result.v).to.eq('0x0');
  });

  it('should throw an error if transaction_index is falsy', async function () {
    const detailedResultsWithNullNullableValues = {
      ...defaultDetailedContractResultByHash,
      transaction_index: undefined,
    };
    const uniqueTxHash = '0x14aad7b827375d12d73af57b6a3e84353645fd31305ea58ff52dda53ec640534';

    restMock
      .onGet(`contracts/results/${uniqueTxHash}`)
      .reply(200, JSON.stringify(detailedResultsWithNullNullableValues));

    try {
      await ethImpl.getTransactionByHash(uniqueTxHash, requestDetails);
      expect.fail('should have thrown an error');
    } catch (error) {
      expect(error).to.exist;
      expect(error).to.eq(predefined.DEPENDENT_SERVICE_IMMATURE_RECORDS);
    }
  });

  it('should throw an error if block_number is falsy', async function () {
    const detailedResultsWithNullNullableValues = {
      ...defaultDetailedContractResultByHash,
      block_number: undefined,
    };
    const uniqueTxHash = '0x14aad7b827375d12d73af57b6a3e84353645fd31305ea58ff52dda53ec640511';

    restMock
      .onGet(`contracts/results/${uniqueTxHash}`)
      .reply(200, JSON.stringify(detailedResultsWithNullNullableValues));
    try {
      await ethImpl.getTransactionByHash(uniqueTxHash, requestDetails);
      expect.fail('should have thrown an error');
    } catch (error) {
      expect(error).to.exist;
      expect(error).to.eq(predefined.DEPENDENT_SERVICE_IMMATURE_RECORDS);
    }
  });

  it('should throw an error if transaction_index and block_number are falsy', async function () {
    const detailedResultsWithNullNullableValues = {
      ...defaultDetailedContractResultByHash,
      block_number: undefined,
      transaction_index: undefined,
    };

    const uniqueTxHash = '0x14aad7b827375d12d73af57b6a3e84353645fd31305ea58ff52d1a53ec640511';

    restMock
      .onGet(`contracts/results/${uniqueTxHash}`)
      .reply(200, JSON.stringify(detailedResultsWithNullNullableValues));
    try {
      await ethImpl.getTransactionByHash(uniqueTxHash, requestDetails);
      expect.fail('should have thrown an error');
    } catch (error) {
      expect(error).to.exist;
      expect(error).to.eq(predefined.DEPENDENT_SERVICE_IMMATURE_RECORDS);
    }
  });

  it('returns reverted transactions', async function () {
    restMock
      .onGet(`contracts/results/${DEFAULT_TX_HASH}`)
      .reply(200, JSON.stringify(DEFAULT_DETAILED_CONTRACT_RESULT_BY_HASH_REVERTED));

    const result = await ethImpl.getTransactionByHash(DEFAULT_TX_HASH, requestDetails);
    RelayAssertions.assertTransaction(result, {
      ...DEFAULT_TRANSACTION,
      maxFeePerGas: '0x55',
      maxPriorityFeePerGas: '0x43',
    });
  });
});
