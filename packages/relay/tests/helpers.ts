// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { ConfigKey } from '@hashgraph/json-rpc-config-service/dist/services/globalConfig';
import { Hbar, HbarUnit } from '@hashgraph/sdk';
import { expect } from 'chai';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { Logger } from 'pino';
import { v4 as uuid } from 'uuid';

import { ConfigServiceTestHelper } from '../../config-service/tests/configServiceTestHelper';
import { formatRequestIdMessage, numberTo0x, toHash32 } from '../src/formatters';
import constants from '../src/lib/constants';
import { RedisInMemoryServer } from './redisInMemoryServer';

// Randomly generated key
const defaultPrivateKey = '8841e004c6f47af679c91d9282adc62aeb9fabd19cdff6a9da5a358d0613c30a';

const getQueryParams = (params: object) => {
  if (!Object.keys(params).length) {
    return '';
  }

  return '?'.concat(
    Object.entries(params)
      .map(([key, value]) => `${key}=${value}`)
      .join('&'),
  );
};

const expectUnsupportedMethod = (result) => {
  expect(result).to.have.property('code');
  expect(result.code).to.be.equal(-32601);
  expect(result).to.have.property('name');
  expect(result.name).to.be.equal('Method not found');
  expect(result).to.have.property('message');
  expect(result.message).to.be.equal('Unsupported JSON-RPC method');
};

const expectedError = () => {
  expect(true).to.eq(false);
};

const signTransaction = async (transaction, key = defaultPrivateKey) => {
  const wallet = new ethers.Wallet(key);
  return wallet.signTransaction(transaction);
};

const random20BytesAddress = (addHexPrefix = true) => {
  return (addHexPrefix ? '0x' : '') + crypto.randomBytes(20).toString('hex');
};

export const toHex = (num) => {
  return `0x${Number(num).toString(16)}`;
};

const getRequestId = () => {
  return formatRequestIdMessage(uuid());
};

export const ethCallFailing = async (ethImpl, args, block, requestDetails, assertFunc) => {
  let hasError = false;
  try {
    await ethImpl.call(args, block, requestDetails);
  } catch (error: any) {
    hasError = true;
    assertFunc(error);
  }
  expect(hasError).to.eq(true);
};

export async function ethGetLogsFailing(ethImpl, args, assertFunc) {
  let hasError = false;
  try {
    await ethImpl.getLogs(...args);
    expect(true).to.eq(false);
  } catch (error: any) {
    hasError = true;
    assertFunc(error);
  }
  expect(hasError).to.eq(true);
}

export const expectLogData = (res, log, tx) => {
  expect(res.address).to.eq(log.address);
  expect(res.blockHash).to.eq(toHash32(tx.block_hash));
  expect(res.blockHash.length).to.eq(66);
  expect(res.blockNumber).to.eq(numberTo0x(tx.block_number));
  expect(res.data).to.eq(log.data);
  expect(res.logIndex).to.eq(numberTo0x(log.index));
  expect(res.removed).to.eq(false);
  expect(res.topics).to.exist;
  expect(res.topics).to.deep.eq(log.topics);
  expect(res.transactionHash).to.eq(tx.hash);
  expect(res.transactionHash.length).to.eq(66);
  expect(res.transactionIndex).to.eq(numberTo0x(tx.transaction_index));
};

export const expectLogData1 = (res) => {
  expectLogData(res, defaultLogs.logs[0], defaultDetailedContractResults);
};

export const expectLogData2 = (res) => {
  expectLogData(res, defaultLogs.logs[1], defaultDetailedContractResults);
};

export const expectLogData3 = (res) => {
  expectLogData(res, defaultLogs.logs[2], defaultDetailedContractResults2);
};

export const expectLogData4 = (res) => {
  expectLogData(res, defaultLogs.logs[3], defaultDetailedContractResults3);
};

const mockData = {
  accountEvmAddress: '0x00000000000000000000000000000000000003f6',
  account: {
    account: '0.0.1014',
    alias: null,
    auto_renew_period: 7776000,
    balance: {
      balance: 0,
      timestamp: '1654168500.007651338',
      tokens: [],
    },
    deleted: false,
    ethereum_nonce: 7,
    evm_address: '0x00000000000000000000000000000000000003f6',
    expiry_timestamp: null,
    key: {
      _type: 'ED25519',
      key: '0aa8e21064c61eab86e2a9c164565b4e7a9a4146106e0a6cd03a8c395a110e92',
    },
    max_automatic_token_associations: 0,
    memo: '',
    receiver_sig_required: null,
    transactions: [],
    links: {
      next: null,
    },
  },

  blocks: {
    blocks: [
      {
        count: 17,
        hapi_version: '0.38.10',
        hash: '0xa1bff58c8980be6f08e357d78a2eeea35f57408907695d0a4e9f6bdc5ad361be717e0a89f4d4eab7c79da926d466f184',
        name: '2023-06-06T03_26_52.041881845Z.rcd.gz',
        number: 0,
        previous_hash:
          '0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
        size: 5496,
        timestamp: { from: '1686022012.041881845', to: '1686022013.882529003' },
        gas_used: 0,
        logs_bloom: '0x',
      },
      {
        count: 33,
        hapi_version: '0.38.10',
        hash: '0x88fbc1805d2193f45de7974259d5bde32e5a9afb071dbc9c325d4635fee1bbba3e7f99e3c3ce866dfbca7379b4535813',
        name: '2023-06-06T03_26_50.010262867Z.rcd.gz',
        number: 1,
        previous_hash:
          '0xa1bff58c8980be6f08e357d78a2eeea35f57408907695d0a4e9f6bdc5ad361be717e0a89f4d4eab7c79da926d466f184',
        size: 7068,
        timestamp: { from: '1686022010.010262867', to: '1686022011.869509167' },
        gas_used: 0,
        logs_bloom: '0x',
      },
      {
        count: 33,
        hapi_version: '0.38.10',
        hash: '0xdbc8c72721c30cfcec44a82d8c0b7ab841b36b2f8601a503fc89abed0af3747e',
        name: '2023-06-06T03_26_55.010262867Z.rcd.gz',
        number: 2,
        previous_hash:
          '0x88fbc1805d2193f45de7974259d5bde32e5a9afb071dbc9c325d4635fee1bbba3e7f99e3c3ce866dfbca7379b4535813',
        size: 7068,
        timestamp: { from: '1686022010.010262867', to: '1686022011.869509167' },
        gas_used: 0,
        logs_bloom: '0x',
      },
    ],
    links: { next: null },
  },

  contractEvmAddress: '0000000000000000000000000000000000001f41',
  contract: {
    contract_id: '0.0.2000',
    evm_address: '0000000000000000000000000000000000001f41',
    file_id: '0.0.1000',
    obtainer_id: '0.0.3000',
    timestamp: {
      from: '1651560386.060890949',
      to: null,
    },
  },

  tokenId: '0.0.13312',
  tokenLongZero: '0x0000000000000000000000000000000000003400',
  token: {
    admin_key: {
      _type: 'ProtobufEncoded',
      key: 10101,
    },
    auto_renew_account: '0.1.2',
    auto_renew_period: null,
    created_timestamp: '1234567890.000000001',
    deleted: false,
    decimals: 1000,
    expiry_timestamp: null,
    freeze_default: false,
    freeze_key: {
      _type: 'ProtobufEncoded',
      key: 10101,
    },
    initial_supply: 1000000,
    kyc_key: {
      _type: 'ProtobufEncoded',
      key: 10101,
    },
    max_supply: 9223372036854776000,
    memo: 'token memo',
    modified_timestamp: '1234567890.000000001',
    name: 'Token name',
    pause_key: {
      _type: 'ProtobufEncoded',
      key: 10101,
    },
    pause_status: 'UNPAUSED',
    supply_key: {
      _type: 'ProtobufEncoded',
      key: 10101,
    },
    supply_type: 'INFINITE',
    symbol: 'ORIGINALRDKSE',
    token_id: '0.0.13312',
    total_supply: 1000000,
    treasury_account_id: '0.1.2',
    type: 'FUNGIBLE_COMMON',
    wipe_key: {
      _type: 'ProtobufEncoded',
      key: 10101,
    },
    custom_fees: {
      created_timestamp: '1234567890.000000001',
      fixed_fees: [
        {
          amount: 100,
          collector_account_id: '0.1.5',
          denominating_token_id: '0.10.8',
        },
      ],
      fractional_fees: [
        {
          amount: {
            numerator: 12,
            denominator: 29,
          },
          collector_account_id: '0.1.6',
          denominating_token_id: '0.10.9',
          maximum: 120,
          minimum: 30,
          net_of_transfers: true,
        },
      ],
    },
  },

  notFound: {
    _status: {
      messages: [
        {
          message: 'Not found',
        },
      ],
    },
  },

  tooManyRequests: {
    _status: {
      messages: [
        {
          message: 'Too Many Requests',
        },
      ],
    },
  },

  contractReverted: {
    _status: {
      messages: [
        {
          message: 'CONTRACT_REVERT_EXECUTED',
          detail: '',
          data: '',
        },
      ],
    },
  },

  invalidTransaction: {
    _status: {
      messages: [
        {
          message: 'INVALID_TRANSACTION',
          detail: '',
          data: '',
        },
      ],
    },
  },

  failInvalid: {
    _status: {
      messages: [
        {
          message: 'FAIL_INVALID',
          detail: '',
          data: '',
        },
      ],
    },
  },

  notSuported: {
    _status: {
      messages: [
        {
          message: 'Auto account creation is not supported.',
          detail: '',
          data: '',
        },
      ],
    },
  },
};

export {
  expectUnsupportedMethod,
  expectedError,
  signTransaction,
  mockData,
  random20BytesAddress,
  getRequestId,
  getQueryParams,
};

export const bytecode =
  '0x608060405234801561001057600080fd5b5060405161078938038061078983398181016040528101906100329190';
export const blockHashTrimmed = '0x3c08bbbee74d287b1dcd3f0ca6d1d2cb92c90883c4acf9747de9f3f3162ad25b';
export const blobVersionedHash = '0x3c08bbbee74d287b1dcd3f0ca6d1d2cb92c90883c4acf9747de9f3f3162ad25b';
export const blockHash = `${blockHashTrimmed}999fc7e86699f60f2a3fb3ed9a646c6b`;
export const blockHash2 = `${blockHashTrimmed}999fc7e86699f60f2a3fb3ed9a646c6c`;
export const blockHash3 = `${blockHashTrimmed}999fc7e86699f60f2a3fb3ed9a646c6d`;
export const blockNumber = 3;
export const blockNumber2 = 4;
export const blockNumber3 = 5;
export const blockTransactionCount = 77;
export const gasUsed1 = 200000;
export const gasUsed2 = 800000;
export const maxGasLimit = 250000;
export const firstTransactionTimestampSeconds = '1653077541';
export const contractAddress1 = '0x000000000000000000000000000000000000055f';
export const contractTimestamp1 = `${firstTransactionTimestampSeconds}.983983199`;
export const contractHash1 = '0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6392';
export const contractHash2 = '0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6393';
export const contractHash3 = '0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6394';
export const contractAddress2 = '0x000000000000000000000000000000000000055e';
export const contractAddress3 = '0x44FDFC794FFFF9Ef010672DfC483b6DDb1950989';
export const contractTimestamp2 = '1653077542.701408897';
export const contractTimestamp3 = '1653088542.123456789';
export const contractId1 = '0.0.5001';
export const contractId2 = '0.0.5002';
export const signedTransactionHash =
  '0x02f87482012a0485a7a358200085a7a3582000832dc6c09400000000000000000000000000000000000003f78502540be40080c001a006f4cd8e6f84b76a05a5c1542a08682c928108ef7163d9c1bf1f3b636b1cd1fba032097cbf2dda17a2dcc40f62c97964d9d930cdce2e8a9df9a8ba023cda28e4ad';
export const LONG_ZERO_ADDRESS = '0x0000000000000000000000000000000000000557';

export const defaultBlock = {
  count: blockTransactionCount,
  hapi_version: '0.27.0',
  hash: blockHash,
  name: '2022-05-03T06_46_26.060890949Z.rcd',
  number: blockNumber,
  previous_hash: '0xf7d6481f659c866c35391ee230c374f163642ebf13a5e604e04a95a9ca48a298dc2dfa10f51bcbaab8ae23bc6d662a0b',
  size: null,
  timestamp: {
    from: '1651560386.060890949',
    to: '1651560389.060890949',
  },
  gas_used: gasUsed1 + gasUsed2,
  logs_bloom: '0x',
};
export const defaultContract = {
  admin_key: null,
  auto_renew_account: null,
  auto_renew_period: 7776000,
  contract_id: '0.0.1052',
  created_timestamp: '1659622477.294172233',
  deleted: false,
  evm_address: null,
  expiration_timestamp: null,
  file_id: '0.0.1051',
  max_automatic_token_associations: 0,
  memo: '',
  obtainer_id: null,
  permanent_removal: null,
  proxy_account_id: null,
  timestamp: {
    from: '1659622477.294172233',
    to: null,
  },
  bytecode: '0x123456',
  runtime_bytecode: '0x608060405234801561001057600080fd5b5060405161078938038061078983398181016040528101906100321234',
};
export const defaultContractResults = {
  results: [
    {
      amount: 1,
      bloom:
        '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      call_result:
        '0x6080604052600436106100385760003560e01c80632b6adf431461003c5780633d99e80d1461010f5780634bfdab701461015257610038565b5b5b005b61010d600480360360408110156100535760006000fd5b81019080803563ffffffff169060200190929190803590602001906401000000008111156100815760006000fd5b8201836020820111156100945760006000fd5b803590602001918460018302840111640100000000831117156100b75760006000fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f8201169050808301925050505050505090909192909091929050505061018a565b005b34801561011c5760006000fd5b50610150600480360360208110156101345760006000fd5b81019080803563ffffffff169060200190929190505050610292565b005b34801561015f5760006000fd5b506101686102b7565b604051808263ffffffff1663ffffffff16815260200191505060405180910390f35b60008263ffffffff166effffffffffffffffffffffffffffff1690508073ffffffffffffffffffffffffffffffffffffffff166108fc60019081150290604051600060405180830381858888f193505050501580156101ee573d600060003e3d6000fd5b507f930f628a0950173c55b8f7d31636aa82e481f09d70191adc38b8c8cd186a0ad7826040518080602001828103825283818151815260200191508051906020019080838360005b838110156102525780820151818401525b602081019050610236565b50505050905090810190601f16801561027f5780820380516001836020036101000a031916815260200191505b509250505060405180910390a1505b5050565b80600060006101000a81548163ffffffff021916908363ffffffff1602179055505b50565b6000600060009054906101000a900463ffffffff1690506102d3565b9056fea265627a7a723158201b51cf608b8b7e2c5d36bd8733f2213b669e5d1cfa53b67f52a7e878d1d7bb0164736f6c634300050b0032',
      contract_id: '0.0.1375',
      created_contract_ids: ['0.0.1375'],
      error_message: null,
      from: LONG_ZERO_ADDRESS,
      function_parameters: '0x',
      gas_limit: maxGasLimit,
      gas_used: gasUsed1,
      hash: contractHash1,
      timestamp: `${contractTimestamp1}`,
      to: `${contractAddress1}`,
      block_gas_used: 400000,
      block_hash: `${blockHash}`,
      block_number: `${blockNumber}`,
      chain_id: '0x12a',
      failed_initcode: null,
      gas_price: '0x4a817c80',
      max_fee_per_gas: '0x59',
      max_priority_fee_per_gas: '0x33',
      nonce: 5,
      r: '0xb5c21ab4dfd336e30ac2106cad4aa8888b1873a99bce35d50f64d2ec2cc5f6d9',
      result: 'SUCCESS',
      s: '0x1092806a99727a20c31836959133301b65a2bfa980f9795522d21a254e629110',
      status: '0x1',
      transaction_index: 1,
      type: 2,
      v: 1,
    },
    {
      amount: 0,
      bloom:
        '0x00000000000000000000000000000000000000000000000000000000000000040000000000000000000001000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000',
      call_result: '0x',
      contract_id: '0.0.1374',
      created_contract_ids: [],
      error_message: null,
      from: LONG_ZERO_ADDRESS,
      function_parameters:
        '0x2b6adf430000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000084865792c204d6121000000000000000000000000000000000000000000000000',
      gas_limit: maxGasLimit - 1000,
      gas_used: gasUsed2,
      hash: contractHash2,
      timestamp: `${contractTimestamp2}`,
      to: `${contractAddress2}`,
      block_gas_used: 400000,
      block_hash: `${blockHash}`,
      block_number: `${blockNumber}`,
      chain_id: '0x12a',
      failed_initcode: null,
      gas_price: '0x4a817c80',
      max_fee_per_gas: '0x59',
      max_priority_fee_per_gas: '0x33',
      nonce: 6,
      r: '0xb5c21ab4dfd336e30ac2106cad4aa8888b1873a99bce35d50f64d2ec2cc5f6d9',
      result: 'SUCCESS',
      s: '0x1092806a99727a20c31836959133301b65a2bfa980f9795522d21a254e629110',
      status: '0x1',
      transaction_index: 2,
      type: 2,
      v: 1,
    },
  ],
  links: {
    next: null,
  },
};

export const defaultContractResultsOnlyHash2 = {
  results: [
    {
      amount: 1,
      bloom:
        '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      call_result:
        '0x6080604052600436106100385760003560e01c80632b6adf431461003c5780633d99e80d1461010f5780634bfdab701461015257610038565b5b5b005b61010d600480360360408110156100535760006000fd5b81019080803563ffffffff169060200190929190803590602001906401000000008111156100815760006000fd5b8201836020820111156100945760006000fd5b803590602001918460018302840111640100000000831117156100b75760006000fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f8201169050808301925050505050505090909192909091929050505061018a565b005b34801561011c5760006000fd5b50610150600480360360208110156101345760006000fd5b81019080803563ffffffff169060200190929190505050610292565b005b34801561015f5760006000fd5b506101686102b7565b604051808263ffffffff1663ffffffff16815260200191505060405180910390f35b60008263ffffffff166effffffffffffffffffffffffffffff1690508073ffffffffffffffffffffffffffffffffffffffff166108fc60019081150290604051600060405180830381858888f193505050501580156101ee573d600060003e3d6000fd5b507f930f628a0950173c55b8f7d31636aa82e481f09d70191adc38b8c8cd186a0ad7826040518080602001828103825283818151815260200191508051906020019080838360005b838110156102525780820151818401525b602081019050610236565b50505050905090810190601f16801561027f5780820380516001836020036101000a031916815260200191505b509250505060405180910390a1505b5050565b80600060006101000a81548163ffffffff021916908363ffffffff1602179055505b50565b6000600060009054906101000a900463ffffffff1690506102d3565b9056fea265627a7a723158201b51cf608b8b7e2c5d36bd8733f2213b669e5d1cfa53b67f52a7e878d1d7bb0164736f6c634300050b0032',
      contract_id: '0.0.1375',
      created_contract_ids: ['0.0.1375'],
      error_message: null,
      from: LONG_ZERO_ADDRESS,
      function_parameters: '0x',
      gas_limit: maxGasLimit,
      gas_used: gasUsed1,
      hash: contractHash2,
      timestamp: `${contractTimestamp1}`,
      to: `${contractAddress1}`,
      block_gas_used: 400000,
      block_hash: `${blockHash}`,
      block_number: `${blockNumber}`,
      chain_id: '0x12a',
      failed_initcode: null,
      gas_price: '0x4a817c80',
      max_fee_per_gas: '0x59',
      max_priority_fee_per_gas: '0x33',
      nonce: 5,
      r: '0xb5c21ab4dfd336e30ac2106cad4aa8888b1873a99bce35d50f64d2ec2cc5f6d9',
      result: 'SUCCESS',
      s: '0x1092806a99727a20c31836959133301b65a2bfa980f9795522d21a254e629110',
      status: '0x1',
      transaction_index: 1,
      type: 2,
      v: 1,
    },
  ],
  links: {
    next: null,
  },
};

export const defaultEvmAddress = '0x67D8d32E9Bf1a9968a5ff53B87d777Aa8EBBEe69';
export const defaultFromLongZeroAddress = '0x0000000000000000000000000000000000001f41';

export const defaultLogTopics = [
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  '0x0000000000000000000000000000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000000000000000000000000208fa13',
  '0x0000000000000000000000000000000000000000000000000000000000000005',
];

export const blockLogsBloom =
  '0x00000000000000000000000000000000000000000000000080010000000000100000000000080000000000000000000000000000000000000000000000000000000000000000000000000080008000000000000000000000000000000000000000000080000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000480000040000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000';
export const logBloom1 = '0x1111';
export const logBloom2 = '0x2222';
export const logBloom3 = '0x3333';
export const logBloom4 = '0x4444';

export const defaultLogs1 = [
  {
    address: '0x0000000000000000000000000000000002131951',
    bloom: logBloom1,
    contract_id: contractId1,
    data: '0x',
    index: 0,
    topics: defaultLogTopics,
    root_contract_id: '0.0.34806097',
    timestamp: contractTimestamp1,
    block_hash: blockHash,
    block_number: blockNumber,
    transaction_hash: contractHash1,
    transaction_index: 1,
  },
  {
    address: '0x0000000000000000000000000000000002131951',
    bloom: logBloom2,
    contract_id: contractId1,
    data: '0x',
    index: 1,
    topics: defaultLogTopics,
    root_contract_id: '0.0.34806097',
    timestamp: contractTimestamp1,
    block_hash: blockHash,
    block_number: blockNumber,
    transaction_hash: contractHash1,
    transaction_index: 1,
  },
];

export const defaultLogs2 = [
  {
    address: '0x0000000000000000000000000000000002131951',
    bloom: logBloom3,
    contract_id: contractId1,
    data: '0x',
    index: 0,
    topics: [],
    root_contract_id: '0.0.34806097',
    timestamp: contractTimestamp2,
    block_hash: blockHash2,
    block_number: blockNumber2,
    transaction_hash: contractHash2,
    transaction_index: 1,
  },
];

export const defaultLogs3 = [
  {
    address: '0x0000000000000000000000000000000002131951',
    bloom: logBloom4,
    contract_id: contractId2,
    data: '0x',
    index: 0,
    topics: [],
    root_contract_id: '0.0.34806097',
    timestamp: contractTimestamp3,
    block_hash: blockHash3,
    block_number: blockNumber3,
    transaction_hash: contractHash3,
    transaction_index: 1,
  },
];

export const defaultLogsList = defaultLogs1.concat(defaultLogs2).concat(defaultLogs3);
export const defaultLogs = {
  logs: defaultLogsList,
};

export const defaultDetailedContractResults = {
  access_list: '0x',
  amount: 2000000000,
  block_gas_used: 50000000,
  block_hash: blockHash,
  block_number: blockNumber,
  bloom: '0x0505',
  call_result: '0x0606',
  chain_id: '0x12a',
  contract_id: contractId1,
  created_contract_ids: ['0.0.7001'],
  error_message: null,
  from: '0x0000000000000000000000000000000000001f41',
  function_parameters: '0x0707',
  gas_limit: 1000000,
  gas_price: '0x4a817c80',
  gas_used: 123,
  hash: contractHash1,
  logs: defaultLogs1,
  max_fee_per_gas: '0x',
  max_priority_fee_per_gas: '0x',
  nonce: 1,
  r: '0xd693b532a80fed6392b428604171fb32fdbf953728a3a7ecc7d4062b1652c042',
  result: 'SUCCESS',
  s: '0x24e9c602ac800b983b035700a14b23f78a253ab762deab5dc27e3555a750b354',
  state_changes: [
    {
      address: contractAddress1,
      contract_id: contractId1,
      slot: '0x0000000000000000000000000000000000000000000000000000000000000101',
      value_read: '0x97c1fc0a6ed5551bc831571325e9bdb365d06803100dc20648640ba24ce69750',
      value_written: '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
    },
  ],
  status: '0x1',
  timestamp: contractTimestamp1,
  to: contractAddress1,
  transaction_index: 1,
  type: 2,
  v: 1,
};

export const defaultDetailedContractResults2 = {
  ...defaultDetailedContractResults,
  ...{
    timestamp: contractTimestamp2,
    block_hash: blockHash2,
    block_number: blockNumber2,
    hash: contractHash2,
    logs: defaultLogs2,
  },
};

export const defaultDetailedContractResults3 = {
  ...defaultDetailedContractResults,
  ...{
    timestamp: contractTimestamp3,
    block_hash: blockHash3,
    block_number: blockNumber3,
    hash: contractHash3,
    contract_id: contractId2,
    logs: defaultLogs3,
  },
};
export const defaultNetworkFees = {
  fees: [
    {
      gas: 77,
      transaction_type: 'ContractCall',
    },
    {
      gas: 771,
      transaction_type: 'ContractCreate',
    },
    {
      gas: 57,
      transaction_type: 'EthereumTransaction',
    },
  ],
  timestamp: '1653644164.591111113',
};

export const defaultTxHash = '0x4a563af33c4871b51a8b108aa2fe1dd5280a30dfb7236170ae5e5e7957eb6392';
export const expectedTx = {
  accessList: undefined,
  blockHash: '0xd693b532a80fed6392b428604171fb32fdbf953728a3a7ecc7d4062b1652c042',
  blockNumber: '0x11',
  chainId: '0x12a',
  from: '0x0000000000000000000000000000000000001f41',
  gas: '0x7b',
  gasPrice: '0x4a817c80',
  hash: defaultTxHash,
  input: '0x0707',
  maxFeePerGas: undefined,
  maxPriorityFeePerGas: undefined,
  nonce: 1,
  r: '0xd693b532a80fed6392b428604171fb32fdbf953728a3a7ecc7d4062b1652c042',
  s: '0x24e9c602ac800b983b035700a14b23f78a253ab762deab5dc27e3555a750b354',
  to: '0x0000000000000000000000000000000000001389',
  transactionIndex: '0x1',
  type: 2,
  v: 1,
  value: '0x77359400',
};

export const defaultDetailedContractResultByHash = {
  amount: 2000000000,
  bloom:
    '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
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
      bloom:
        '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      contract_id: '0.0.5001',
      data: '0x0123',
      index: 0,
      topics: ['0x97c1fc0a6ed5551bc831571325e9bdb365d06803100dc20648640ba24ce69750'],
    },
  ],
  result: 'SUCCESS',
  transaction_index: 1,
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
  max_fee_per_gas: '0x55',
  max_priority_fee_per_gas: '0x43',
  r: '0xd693b532a80fed6392b428604171fb32fdbf953728a3a7ecc7d4062b1652c042',
  s: '0x24e9c602ac800b983b035700a14b23f78a253ab762deab5dc27e3555a750b354',
  type: 2,
  v: 1,
  nonce: 1,
};

export const buildCryptoTransferTransaction = (from, to, amount, args: any = {}) => {
  return {
    bytes: null,
    charged_tx_fee: 2116872,
    consensus_timestamp: args.timestamp || '1669207658.365113311',
    entity_id: null,
    max_fee: '100000000',
    memo_base64: 'UmVsYXkgdGVzdCB0b2tlbiB0cmFuc2Zlcg==',
    name: 'CRYPTOTRANSFER',
    node: '0.0.8',
    nonce: 0,
    parent_consensus_timestamp: null,
    result: 'SUCCESS',
    scheduled: false,
    token_transfers: [],
    transaction_hash: args.transactionHash || 'OpCU4upAgJEBv2bjaoIurl4UYI4tuNA44ChtlKj+l0g0EvKbBpVI7lmnzeswVibQ',
    transaction_id: args.transactionId || '0.0.28527683-1669207645-620109637',
    transfers: [
      {
        account: '0.0.8',
        amount: 99202,
        is_approval: false,
      },
      {
        account: from,
        amount: -1 * amount,
        is_approval: false,
      },
      {
        account: to,
        amount: amount,
        is_approval: false,
      },
    ],
    valid_duration_seconds: '120',
    valid_start_timestamp: '1669207645.620109637',
  };
};

export const defaultEthereumTransactions = [
  {
    bytes: null,
    charged_tx_fee: 0,
    consensus_timestamp: '1689672910.529610346',
    entity_id: null,
    max_fee: '100000000',
    memo_base64: '',
    name: 'ETHEREUMTRANSACTION',
    nft_transfers: [],
    node: '0.0.7',
    nonce: 0,
    parent_consensus_timestamp: null,
    result: 'SUCCESS',
    scheduled: false,
    staking_reward_transfers: [],
    token_transfers: [],
    transaction_hash: '9VjM48D6NNaaY49C3MybTGNJkN0PwegeablbJgQeruHs6K+qXMwCNz/jQo0f1HE8',
    transaction_id: '0.0.1078@1686183420.196506746',
    transfers: [
      {
        account: '0.0.2',
        amount: -681600000,
        is_approval: false,
      },
      {
        account: '0.0.36516',
        amount: 681600000,
        is_approval: false,
      },
    ],
    valid_duration_seconds: '120',
    valid_start_timestamp: '1689672901.525163476',
  },
  {
    bytes: null,
    charged_tx_fee: 108530272,
    consensus_timestamp: '1689669806.068075774',
    entity_id: '0.0.58263',
    max_fee: '1065000000',
    memo_base64: '',
    name: 'ETHEREUMTRANSACTION',
    nft_transfers: [],
    node: '0.0.4',
    nonce: 0,
    parent_consensus_timestamp: null,
    result: 'SUCCESS',
    scheduled: false,
    staking_reward_transfers: [],
    token_transfers: [],
    transaction_hash: '3rfGmWnoGQaDgnvI9u4YVTDBE7qBByL11fzK4mvGs/SOZ8myENbo7z9Pf7nVrHN6',
    transaction_id: '0.0.1078@1686183420.196506747',
    transfers: [
      {
        account: '0.0.4',
        amount: 1998730,
        is_approval: false,
      },
      {
        account: '0.0.98',
        amount: 106531542,
        is_approval: false,
      },
      {
        account: '0.0.902',
        amount: -51730272,
        is_approval: false,
      },
      {
        account: '0.0.36516',
        amount: -56800000,
        is_approval: false,
      },
    ],
    valid_duration_seconds: '120',
    valid_start_timestamp: '1689669792.798100892',
  },
];

export const defaultCallData = {
  from: '0x0000000000000000000000000000000000001f41',
  to: '0x0000000000000000000000000000000000001f42',
  data: '0x0606',
  gas: 1000000,
  value: null,
};

export const defaultErrorMessageText = 'Set to revert';
export const defaultErrorMessageHex =
  '0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d53657420746f2072657665727400000000000000000000000000000000000000';

export const calculateTxRecordChargeAmount = (exchangeRateIncents: number) => {
  const txQueryCostInCents = constants.NETWORK_FEES_IN_CENTS.TRANSACTION_GET_RECORD;
  const hbarToTinybar = Hbar.from(1, HbarUnit.Hbar).toTinybars().toNumber();
  return Math.round((txQueryCostInCents / exchangeRateIncents) * hbarToTinybar);
};

export const useInMemoryRedisServer = (logger: Logger, port: number) => {
  overrideEnvsInMochaDescribe({ TEST: false, REDIS_ENABLED: true, REDIS_URL: `redis://127.0.0.1:${port}` });

  let redisInMemoryServer: RedisInMemoryServer;

  before(async () => {
    redisInMemoryServer = await startRedisInMemoryServer(logger, port);
  });

  after(async () => {
    await stopRedisInMemoryServer(redisInMemoryServer);
  });
};

export const startRedisInMemoryServer = async (logger: Logger, port: number) => {
  const redisInMemoryServer = new RedisInMemoryServer(logger.child({ name: 'RedisInMemoryServer' }), port);
  await redisInMemoryServer.start();
  return redisInMemoryServer;
};

export const stopRedisInMemoryServer = async (redisInMemoryServer: RedisInMemoryServer): Promise<void> => {
  await redisInMemoryServer.stop();
};

/**
 * Temporarily overrides environment variables for the duration of the encapsulating describe block.
 * @param envs - An object containing key-value pairs of environment variables to set.
 *
 * @example
 * describe('given TEST is set to false', () => {
 *   overrideEnvsInMochaDescribe({ TEST: false });
 *
 *   it('should return false', () => {
 *     expect(ConfigService.get('TEST')).to.equal(false);
 *   });
 * });
 *
 * it('should return true', () => {
 *   expect(ConfigService.get('TEST')).to.equal(true);
 * });
 */
export const overrideEnvsInMochaDescribe = (envs: NodeJS.Dict<any>) => {
  const envsToReset: NodeJS.Dict<any> = {};

  const overrideEnv = (key: string, value: any) => {
    if (value === undefined) {
      ConfigServiceTestHelper.remove(key);
    } else {
      ConfigServiceTestHelper.dynamicOverride(key, value);
    }
  };

  before(() => {
    for (const key in envs) {
      envsToReset[key] = ConfigService.get(key as ConfigKey);
      overrideEnv(key, envs[key]);
    }
  });

  after(() => {
    for (const key in envs) {
      overrideEnv(key, envsToReset[key]);
    }
  });
};

/**
 * Overrides environment variables for the duration of the provided tests.
 *
 * @param {NodeJS.Dict<string>} envs - An object containing key-value pairs of environment variables to set.
 * @param {Function} tests - A function containing the tests to run with the overridden environment variables.
 *
 * @example
 * withOverriddenEnvsInMochaTest({ TEST: false }, () => {
 *   it('should return false', () => {
 *     expect(ConfigService.get('TEST')).to.equal(false);
 *   });
 * });
 *
 * it('should return true', () => {
 *   expect(ConfigService.get('TEST')).to.equal(true);
 * });
 */
export const withOverriddenEnvsInMochaTest = (envs: NodeJS.Dict<any>, tests: () => void) => {
  const overriddenEnvs = Object.entries(envs)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');

  describe(`given ${overriddenEnvs} are set`, () => {
    overrideEnvsInMochaDescribe(envs);

    tests();
  });
};

export const estimateFileTransactionsFee = (
  callDataSize: number,
  fileChunkSize: number,
  currentNetworkExchangeRateInCents: number,
): number => {
  const fileCreateTransactions = 1;
  const fileCreateFeeInCents = constants.NETWORK_FEES_IN_CENTS.FILE_CREATE_PER_5_KB;

  // The first chunk goes in with FileCreateTransaciton, the rest are FileAppendTransactions
  const fileAppendTransactions = Math.floor(callDataSize / fileChunkSize) - 1;
  const lastFileAppendChunkSize = callDataSize % fileChunkSize;

  const fileAppendFeeInCents = constants.NETWORK_FEES_IN_CENTS.FILE_APPEND_PER_5_KB;
  const lastFileAppendChunkFeeInCents =
    constants.NETWORK_FEES_IN_CENTS.FILE_APPEND_BASE_FEE +
    lastFileAppendChunkSize * constants.NETWORK_FEES_IN_CENTS.FILE_APPEND_RATE_PER_BYTE;

  const totalTxFeeInCents =
    fileCreateTransactions * fileCreateFeeInCents +
    fileAppendFeeInCents * fileAppendTransactions +
    lastFileAppendChunkFeeInCents;

  const estimatedTxFee = Math.round(
    (totalTxFeeInCents / currentNetworkExchangeRateInCents) * constants.HBAR_TO_TINYBAR_COEF,
  );

  return estimatedTxFee;
};

/**
 * Verifies the result of a function call.
 * @param {() => Promise<T>} func - The function to call.
 * @param {Partial<T> | null} expected - The expected result.
 * @param {string} [errorMessage] - The expected error message.
 * @param {Function | Error} [errorType] - The expected error type.
 * @returns {Promise<void>} - A promise that resolves when the verification is complete.
 * @template T
 */
export const verifyResult = async <T>(
  func: () => Promise<T>,
  expected: Partial<T> | null,
  errorMessage?: string,
  errorType?: Function | Error,
): Promise<void> => {
  if (expected) {
    await expect(func()).to.eventually.deep.include(expected);
  } else {
    if (errorType) {
      await expect(func()).to.eventually.be.rejectedWith(errorType, errorMessage);
    } else if (errorMessage) {
      await expect(func()).to.eventually.be.rejectedWith(errorMessage);
    } else {
      await expect(func()).to.eventually.be.rejected;
    }
  }
};
