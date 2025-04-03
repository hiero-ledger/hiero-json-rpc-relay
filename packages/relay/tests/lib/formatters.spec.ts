// SPDX-License-Identifier: Apache-2.0

import { BigNumber as BN } from 'bignumber.js';
import { expect } from 'chai';
import { AbiCoder, keccak256 } from 'ethers';

import {
  ASCIIToHex,
  decodeErrorMessage,
  formatRequestIdMessage,
  formatTransactionId,
  formatTransactionIdWithoutQueryParams,
  getFunctionSelector,
  hexToASCII,
  isHex,
  isValidEthereumAddress,
  mapKeysAndValues,
  nanOrNumberInt64To0x,
  nanOrNumberTo0x,
  nullableNumberTo0x,
  numberTo0x,
  parseNumericEnvVar,
  prepend0x,
  strip0x,
  tinybarsToWeibars,
  toHash32,
  toHexString,
  toNullableBigNumber,
  toNullIfEmptyHex,
  trimPrecedingZeros,
  weibarHexToTinyBarInt,
} from '../../src/formatters';
import constants from '../../src/lib/constants';
import { CommonService } from '../../src/lib/services';
import { overrideEnvsInMochaDescribe } from '../helpers';

describe('Formatters', () => {
  describe('formatRequestIdMessage', () => {
    const exampleRequestId = '46530e63-e33a-4f42-8e44-b125f99f1a9b';
    const expectedFormattedId = '[Request ID: 46530e63-e33a-4f42-8e44-b125f99f1a9b]';

    it('Should format request ID message', () => {
      const result = formatRequestIdMessage(exampleRequestId);
      expect(result).to.eq(expectedFormattedId);
    });

    it('Should return formated request ID if already formatted request ID is passed in', () => {
      const result = formatRequestIdMessage(expectedFormattedId);
      expect(result).to.eq(expectedFormattedId);
    });

    it('Should return an empty string if undefined is passed in', () => {
      const result = formatRequestIdMessage(undefined);
      expect(result).to.eq('');
    });
  });

  describe('hexToASCII', () => {
    const inputs = ['4C6F72656D20497073756D', '466F6F', '426172'];

    const outputs = ['Lorem Ipsum', 'Foo', 'Bar'];

    it('Decodes correctly', () => {
      for (let i = 0; i < inputs.length; i++) {
        expect(hexToASCII(inputs[i])).to.eq(outputs[i]);
      }
    });
  });

  describe('decodeErrorMessage', () => {
    const inputs = [
      '0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d53657420746f2072657665727400000000000000000000000000000000000000',
      '0x08c379a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000013526576657274526561736f6e50617961626c6500000000000000000000000000',
      '0x08c379a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000010526576657274526561736f6e5075726500000000000000000000000000000000',
      '0x08c379a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000010526576657274526561736f6e5669657700000000000000000000000000000000',
    ];

    const outputs = ['Set to revert', 'RevertReasonPayable', 'RevertReasonPure', 'RevertReasonView'];

    it('Decodes correctly', () => {
      for (let i = 0; i < inputs.length; i++) {
        expect(decodeErrorMessage(inputs[i])).to.eq(outputs[i]);
      }
    });

    it('should return empty string when we dont pass params', async function () {
      expect(decodeErrorMessage()).to.equal('');
    });
  });

  describe('formatTransactionId', () => {
    const validInputTimestamp = '0.0.2@1234567890.123456789';
    const validOutputTimestamp = '0.0.2-1234567890-123456789';
    const invalidInputTimestamp = '0.0.2@12345678222.123456789';

    it('should return correct formated transaction id', () => {
      expect(formatTransactionId(validInputTimestamp)).to.eq(validOutputTimestamp);
    });

    it('should return null', () => {
      expect(formatTransactionId(invalidInputTimestamp)).to.eq(null);
    });

    it('should return null on empty', () => {
      expect(formatTransactionId('')).to.eq(null);
    });
  });

  describe('formatTransactionIdWithoutQueryParams', () => {
    const validInputTimestamp = '0.0.2@1234567890.123456789?nonce=1';
    const validOutputTimestamp = '0.0.2-1234567890-123456789';
    const invalidInputTimestamp = '0.0.2@12345678222.123456789?nonce=1';

    it('should return correct formated transaction id', () => {
      expect(formatTransactionIdWithoutQueryParams(validInputTimestamp)).to.eq(validOutputTimestamp);
    });

    it('should return null', () => {
      expect(formatTransactionIdWithoutQueryParams(invalidInputTimestamp)).to.eq(null);
    });

    it('should return null on empty', () => {
      expect(formatTransactionIdWithoutQueryParams('')).to.eq(null);
    });
  });

  describe('parseNumericEnvVar', () => {
    overrideEnvsInMochaDescribe({
      TEST_ONLY_ENV_VAR_EMPTYSTRING: '',
      TEST_ONLY_ENV_VAR_NONNUMERICSTRING: 'foobar',
      TEST_ONLY_ENV_VAR_NUMERICSTRING: '12345',
    });

    it('should use default value when env var is undefined', () => {
      const value = parseNumericEnvVar('TEST_ONLY_ENV_VAR_UNDEFINED', 'ETH_BLOCK_NUMBER_CACHE_TTL_MS_DEFAULT');
      expect(isNaN(value)).to.equal(false, 'should not be NaN');
      expect(value).to.equal(constants.ETH_BLOCK_NUMBER_CACHE_TTL_MS_DEFAULT);
    });

    it('should use default value when env var is empty string', () => {
      const value = parseNumericEnvVar('TEST_ONLY_ENV_VAR_EMPTYSTRING', 'ETH_BLOCK_NUMBER_CACHE_TTL_MS_DEFAULT');
      expect(isNaN(value)).to.equal(false, 'should not be NaN');
      expect(value).to.equal(constants.ETH_BLOCK_NUMBER_CACHE_TTL_MS_DEFAULT);
    });

    it('should use default value when env var is non-numeric string', () => {
      const value = parseNumericEnvVar('TEST_ONLY_ENV_VAR_NONNUMERICSTRING', 'ETH_BLOCK_NUMBER_CACHE_TTL_MS_DEFAULT');
      expect(isNaN(value)).to.equal(false, 'should not be NaN');
      expect(value).to.equal(constants.ETH_BLOCK_NUMBER_CACHE_TTL_MS_DEFAULT);
    });

    it('should throw when env var is any non-parseable value and constant is any non-parseable value', () => {
      let value: any = undefined;
      expect(function () {
        value = parseNumericEnvVar('TEST_ONLY_ENV_VAR_NONNUMERICSTRING', 'TYPE_ACCOUNT');
      }).to.throw(
        Error,
        "Unable to parse numeric env var: 'TEST_ONLY_ENV_VAR_NONNUMERICSTRING', constant: 'TYPE_ACCOUNT'",
        'throws when unable to parse both',
      );
      expect(value).to.be.undefined;
    });

    it('should throw when env var is any non-parseable value and constant does not exist', () => {
      let value: any = undefined;
      expect(function () {
        value = parseNumericEnvVar('TEST_ONLY_ENV_VAR_NONNUMERICSTRING', 'FOO_BAR');
      }).to.throw(
        Error,
        "Unable to parse numeric env var: 'TEST_ONLY_ENV_VAR_NONNUMERICSTRING', constant: 'FOO_BAR'",
        'throws when unable to parse both',
      );
      expect(value).to.be.undefined;
    });

    it('should use specified value when env var is numeric string', () => {
      const value = parseNumericEnvVar('TEST_ONLY_ENV_VAR_NUMERICSTRING', 'ETH_BLOCK_NUMBER_CACHE_TTL_MS_DEFAULT');
      expect(isNaN(value)).to.equal(false, 'should not be NaN');
      expect(value).to.equal(12345);
    });
  });

  describe('formatContractResult', () => {
    const contractResult = {
      amount: 0,
      from: '0x05fba803be258049a27b820088bab1cad2058871',
      function_parameters: '0x08090033',
      gas_used: 400000,
      to: '0x0000000000000000000000000000000000000409',
      hash: '0xfc4ab7133197016293d2e14e8cf9c5227b07357e6385184f1cd1cb40d783cfbd',
      block_hash: '0xb0f10139fa0bf9e66402c8c0e5ed364e07cf83b3726c8045fabf86a07f4887130e4650cb5cf48a9f6139a805b78f0312',
      block_number: 528,
      transaction_index: 9,
      chain_id: '0x12a',
      gas_price: '0x',
      max_fee_per_gas: '0x59',
      max_priority_fee_per_gas: '0x',
      r: '0x2af9d41244c702764ed86c5b9f1a734b075b91c4d9c65e78bc584b0e35181e42',
      s: '0x3f0a6baa347876e08c53ffc70619ba75881841885b2bd114dbb1905cd57112a5',
      type: 2,
      v: 1,
      nonce: 2,
    };

    const contractResultZeroPrefixedSignatureS = {
      amount: 0,
      from: '0x05fba803be258049a27b820088bab1cad2058871',
      function_parameters: '0x08090033',
      gas_used: 400000,
      to: '0x0000000000000000000000000000000000000409',
      hash: '0xfc4ab7133197016293d2e14e8cf9c5227b07357e6385184f1cd1cb40d783cfbd',
      block_hash: '0xb0f10139fa0bf9e66402c8c0e5ed364e07cf83b3726c8045fabf86a07f4887130e4650cb5cf48a9f6139a805b78f0312',
      block_number: 528,
      transaction_index: 9,
      chain_id: '0x12a',
      gas_price: '0x',
      max_fee_per_gas: '0x59',
      max_priority_fee_per_gas: '0x',
      r: '0x58075c8984de34a46c9617ab2b4e0ed5ddc8803e718c42152ed5d58b82166676',
      s: '0x0dd3a5aeb203d9284e50a9973bc5e266a3ea66da1fbb793b244b19b42f19e00b',
      type: 2,
      v: 1,
      nonce: 2,
    };

    it('should return null if null is passed', () => {
      expect(CommonService.formatContractResult(null)).to.equal(null);
    });

    it('should return a valid match', () => {
      const formattedResult: any = CommonService.formatContractResult(contractResult);
      expect(formattedResult.accessList).to.deep.eq([]);
      expect(formattedResult.blockHash).to.equal('0xb0f10139fa0bf9e66402c8c0e5ed364e07cf83b3726c8045fabf86a07f488713');
      expect(formattedResult.blockNumber).to.equal('0x210');
      expect(formattedResult.chainId).to.equal('0x12a');
      expect(formattedResult.from).to.equal('0x05fba803be258049a27b820088bab1cad2058871');
      expect(formattedResult.gas).to.equal('0x61a80');
      expect(formattedResult.gasPrice).to.equal('0x0');
      expect(formattedResult.hash).to.equal('0xfc4ab7133197016293d2e14e8cf9c5227b07357e6385184f1cd1cb40d783cfbd');
      expect(formattedResult.input).to.equal('0x08090033');
      expect(formattedResult.maxPriorityFeePerGas).to.equal('0x0');
      expect(formattedResult.maxFeePerGas).to.equal('0x59');
      expect(formattedResult.nonce).to.equal('0x2');
      expect(formattedResult.r).to.equal('0x2af9d41244c702764ed86c5b9f1a734b075b91c4d9c65e78bc584b0e35181e42');
      expect(formattedResult.s).to.equal('0x3f0a6baa347876e08c53ffc70619ba75881841885b2bd114dbb1905cd57112a5');
      expect(formattedResult.to).to.equal('0x0000000000000000000000000000000000000409');
      expect(formattedResult.transactionIndex).to.equal('0x9');
      expect(formattedResult.type).to.equal('0x2');
      expect(formattedResult.yParity).to.equal('0x1');
      expect(formattedResult.v).to.equal(`0x1`);
      expect(formattedResult.value).to.equal('0x0');
    });

    it('should return a valid signature s value', () => {
      const formattedResult: any = CommonService.formatContractResult(contractResultZeroPrefixedSignatureS);
      expect(formattedResult.accessList).to.deep.eq([]);
      expect(formattedResult.blockHash).to.equal('0xb0f10139fa0bf9e66402c8c0e5ed364e07cf83b3726c8045fabf86a07f488713');
      expect(formattedResult.blockNumber).to.equal('0x210');
      expect(formattedResult.chainId).to.equal('0x12a');
      expect(formattedResult.from).to.equal('0x05fba803be258049a27b820088bab1cad2058871');
      expect(formattedResult.gas).to.equal('0x61a80');
      expect(formattedResult.gasPrice).to.equal('0x0');
      expect(formattedResult.hash).to.equal('0xfc4ab7133197016293d2e14e8cf9c5227b07357e6385184f1cd1cb40d783cfbd');
      expect(formattedResult.input).to.equal('0x08090033');
      expect(formattedResult.maxPriorityFeePerGas).to.equal('0x0');
      expect(formattedResult.maxFeePerGas).to.equal('0x59');
      expect(formattedResult.nonce).to.equal('0x2');
      expect(formattedResult.r).to.equal('0x58075c8984de34a46c9617ab2b4e0ed5ddc8803e718c42152ed5d58b82166676');
      expect(formattedResult.s).to.equal('0xdd3a5aeb203d9284e50a9973bc5e266a3ea66da1fbb793b244b19b42f19e00b');
      expect(formattedResult.to).to.equal('0x0000000000000000000000000000000000000409');
      expect(formattedResult.transactionIndex).to.equal('0x9');
      expect(formattedResult.type).to.equal('0x2');
      expect(formattedResult.yParity).to.equal('0x1');
      expect(formattedResult.v).to.equal(`0x1`);
      expect(formattedResult.value).to.equal('0x0');
    });

    it('should return nullable fields', () => {
      const formattedResult: any = CommonService.formatContractResult({
        ...contractResult,
        block_number: null,
        gas_used: null,
        gas_price: '0x',
        max_priority_fee_per_gas: '0x',
        max_fee_per_gas: '0x',
        nonce: null,
        r: null,
        s: null,
        transaction_index: null,
        v: null,
        value: null,
      });
      expect(formattedResult.blockHash).to.equal('0xb0f10139fa0bf9e66402c8c0e5ed364e07cf83b3726c8045fabf86a07f488713');
      expect(formattedResult.blockNumber).to.equal(null);
      expect(formattedResult.chainId).to.equal('0x12a');
      expect(formattedResult.from).to.equal('0x05fba803be258049a27b820088bab1cad2058871');
      expect(formattedResult.gas).to.equal('0x0');
      expect(formattedResult.gasPrice).to.equal('0x0');
      expect(formattedResult.hash).to.equal('0xfc4ab7133197016293d2e14e8cf9c5227b07357e6385184f1cd1cb40d783cfbd');
      expect(formattedResult.input).to.equal('0x08090033');
      expect(formattedResult.maxPriorityFeePerGas).to.equal('0x0');
      expect(formattedResult.maxFeePerGas).to.equal('0x0');
      expect(formattedResult.nonce).to.equal('0x0');
      expect(formattedResult.r).to.equal('0x0');
      expect(formattedResult.s).to.equal('0x0');
      expect(formattedResult.to).to.equal('0x0000000000000000000000000000000000000409');
      expect(formattedResult.transactionIndex).to.equal(null);
      expect(formattedResult.v).to.equal(`0x0`);
      expect(formattedResult.yParity).to.equal('0x0');
      expect(formattedResult.value).to.equal('0x0');
    });

    it('Should not include chainId field for legacy EIP155 transaction (tx.chainId=0x0)', () => {
      const formattedResult: any = CommonService.formatContractResult({ ...contractResult, chain_id: '0x' });
      expect(formattedResult.chainId).to.be.undefined;
    });

    it('Should return legacy EIP155 transaction when null type', () => {
      const formattedResult: any = CommonService.formatContractResult({ ...contractResult, type: null });
      expect(formattedResult.type).to.be.eq('0x0');
    });

    it('Should return null when contract result type is undefined', async function () {
      const formattedResult = CommonService.formatContractResult({ ...contractResult, type: undefined });
      expect(formattedResult).to.be.null;
    });
  });

  describe('prepend0x', () => {
    it('should add a prefix if there is no one', () => {
      expect(prepend0x('5644')).to.equal('0x5644');
    });
    it('should not add prefix if the string is already prefixed', () => {
      expect(prepend0x('0x5644')).to.equal('0x5644');
    });
  });

  describe('trimPrecedingZeros', () => {
    it('should trim all the unnecessary preceding 0s in a hex value', () => {
      expect(trimPrecedingZeros('0x0000000034')).to.eq('34');
      expect(trimPrecedingZeros('0x0000039000')).to.eq('39000');
      expect('0x' + trimPrecedingZeros('0x0')).to.eq('0x0');
      expect('0x' + trimPrecedingZeros('0x00000000603')).to.eq('0x603');
      expect('0x' + trimPrecedingZeros('0x00000300042')).to.eq('0x300042');
      expect('0x' + trimPrecedingZeros('0x00012000000')).to.eq('0x12000000');
    });

    it('should return NaN if inputs are invalid number', () => {
      expect(trimPrecedingZeros('')).to.eq('NaN');
      expect(trimPrecedingZeros('0x')).to.eq('NaN');
      expect(trimPrecedingZeros('Relay')).to.eq('NaN');
      expect(trimPrecedingZeros('Hedera')).to.eq('NaN');
    });
  });

  describe('numberTo0x', () => {
    it('should convert to hex a number type', () => {
      expect(numberTo0x(1009)).to.equal('0x3f1');
    });
    it('should convert to hex a BigInt type', () => {
      expect(numberTo0x(BigInt(6234))).to.equal('0x185a');
    });
  });

  describe('nullableNumberTo0x', () => {
    it('should be able to accept null', () => {
      expect(nullableNumberTo0x(null)).to.equal(null);
    });
    it('should convert a valid number to hex', () => {
      expect(nullableNumberTo0x(3867)).to.equal('0xf1b');
    });
  });

  describe('nanOrNumberTo0x', () => {
    it('should return null for nullable input', () => {
      expect(nanOrNumberTo0x(null)).to.equal('0x0');
    });
    it('should return 0x0 for Nan input', () => {
      expect(nanOrNumberTo0x(NaN)).to.equal('0x0');
    });
    it('should convert a number', () => {
      expect(nanOrNumberTo0x(593)).to.equal('0x251');
    });
  });

  describe('nanOrNumberInt64To0x', () => {
    it('should return 0x0 for nullable input', () => {
      expect(nanOrNumberInt64To0x(null)).to.equal('0x0');
    });
    it('should return 0x0 for NaN input', () => {
      expect(nanOrNumberInt64To0x(NaN)).to.equal('0x0');
    });

    for (const [testName, testValues] of Object.entries({
      '2 digits': ['-10', '0xfffffffffffffff6'],
      '6 digits': ['-851969', '0xfffffffffff2ffff'],
      '19 digits -6917529027641081857': ['-6917529027641081857', '0x9fffffffffffffff'],
      '19 digits -9223372036586340353': ['-9223372036586340353', '0x800000000fffffff'],
    })) {
      it(`should convert negative int64 number (${testName})`, () => {
        expect(nanOrNumberInt64To0x(BigInt(testValues[0]))).to.equal(testValues[1]);
      });
    }

    for (const [bits, testValues] of Object.entries({
      10: ['593', '0x251'],
      50: ['844424930131967', '0x2ffffffffffff'],
      51: ['1970324836974591', '0x6ffffffffffff'],
      52: ['3096224743817215', '0xaffffffffffff'],
      53: ['9007199254740991', '0x1fffffffffffff'],
      54: ['13510798882111487', '0x2fffffffffffff'],
      55: ['31525197391593471', '0x6fffffffffffff'],
      56: ['49539595901075455', '0xafffffffffffff'],
      57: ['144115188075855871', '0x1ffffffffffffff'],
      58: ['216172782113783807', '0x2ffffffffffffff'],
      59: ['504403158265495551', '0x6ffffffffffffff'],
      60: ['792633534417207295', '0xaffffffffffffff'],
      61: ['2305843009213693951', '0x1fffffffffffffff'],
      62: ['3458764513820540927', '0x2fffffffffffffff'],
      63: ['8070450532247928831', '0x6fffffffffffffff'],
    })) {
      it(`should convert positive ${bits} bits number`, () => {
        expect(nanOrNumberInt64To0x(BigInt(testValues[0]))).to.equal(testValues[1]);
      });
    }
  });

  describe('toHash32', () => {
    it('should format more than 32 bytes hash to 32 bytes', () => {
      expect(
        toHash32('0x9af1252ea00af08c2ebc78f35a6071a3736795dc53027ea746d710c46b0ef011dc4460630cf109972dafa76c4a56f530'),
      ).to.equal('0x9af1252ea00af08c2ebc78f35a6071a3736795dc53027ea746d710c46b0ef011');
    });
    it('should format exactly 32 bytes hash to 32 bytes', () => {
      const hash32bytes = '0x92b761fa12ed062122c962dd84fce75ed6659e5bca328b6bb08077ff249682a';
      expect(toHash32(hash32bytes)).to.equal(hash32bytes);
    });
  });

  describe('toNullableBigNumber', () => {
    it('should return null for null input', () => {
      expect(toNullableBigNumber(null)).to.equal(null);
    });
    it('should convert a valid hex to BigNumber', () => {
      const bigNumberString =
        '0x9af1252ea00af08c2ebc78f35a6071a3736795dc53027ea746d710c46b0ef011dc4460630cf109972dafa76c4a56f530';
      expect(toNullableBigNumber(bigNumberString)).to.equal(new BN(bigNumberString).toString());
    });
  });

  describe('toNullIfEmptyHex', () => {
    it('should return null for empty hex', () => {
      expect(toNullIfEmptyHex('0x')).to.equal(null);
    });
    it('should return value for non-nullable input', () => {
      const value = '2911';
      expect(toNullIfEmptyHex(value)).to.equal(value);
    });
  });

  describe('weibarHexToTinyBarInt', () => {
    it('should convert weibar hex value to tinybar number', () => {
      const value = '0x1027127DC00';
      expect(weibarHexToTinyBarInt(value)).to.eq(111);
    });

    it('should handle 0x value', () => {
      const value = '0x';
      expect(weibarHexToTinyBarInt(value)).to.eq(0);
    });

    it('should 0x0', () => {
      const value = '0x0';
      expect(weibarHexToTinyBarInt(value)).to.eq(0);
    });

    it('should convert max int64 value in hex to tinybar number', () => {
      const value = '0x7FFFFFFFFFFFFFFF';
      expect(weibarHexToTinyBarInt(value)).to.eq(922337203);
    });
  });

  describe('valid ethereum address', () => {
    it('should return true for valid address', () => {
      const address = '0x05fba803be258049a27b820088bab1cad2058871';
      expect(isValidEthereumAddress(address)).to.equal(true);
    });

    it('should return false for invalid address', () => {
      const address = '0x05fba803be258049a27b820088bab1cad205887';
      expect(isValidEthereumAddress(address)).to.equal(false);
    });

    it('should return true for valid long zero address', () => {
      const address = '0x000000000000000000000000000000000074d64a';
      expect(isValidEthereumAddress(address)).to.equal(true);
    });

    it('should return true for valid zero address', () => {
      const address = '0x0000000000000000000000000000000000000000';
      expect(isValidEthereumAddress(address)).to.equal(true);
    });

    it('should return false for an address with a 0x value', () => {
      const address = '0x';
      expect(isValidEthereumAddress(address)).to.equal(false);
    });

    it('should return false for an address with an empty string', () => {
      const address = '';
      expect(isValidEthereumAddress(address)).to.equal(false);
    });

    it('should return false for an address with an empty string', () => {
      const address = '';
      expect(isValidEthereumAddress(address)).to.equal(false);
    });

    it('should return false for an address with an undefined value', () => {
      const address = undefined;
      expect(isValidEthereumAddress(address as any)).to.equal(false);
    });
    it('should return false for an address with a null value', () => {
      const address = null;
      expect(isValidEthereumAddress(address as any)).to.equal(false);
    });

    it('should return false for an address with a null value', () => {
      const address = null;
      expect(isValidEthereumAddress(address)).to.equal(false);
    });
  });

  describe('isHex Function', () => {
    it('should return true for valid lowercase hexadecimal string', () => {
      expect(isHex('0x1a3f')).to.be.true;
    });

    it('should return true for valid uppercase hexadecimal string', () => {
      expect(isHex('0xABC')).to.be.true;
    });

    it('should return true for mixed-case hexadecimal string', () => {
      expect(isHex('0xAbC123')).to.be.true;
    });

    it('should return false for string without 0x prefix', () => {
      expect(isHex('1a3f')).to.be.false;
    });

    it('should return false for string with invalid characters', () => {
      expect(isHex('0x1g3f')).to.be.false;
    });

    it('should return false for string with only 0x prefix', () => {
      expect(isHex('0x')).to.be.false;
    });

    it('should return false for empty string', () => {
      expect(isHex('')).to.be.false;
    });

    it('should return false for string with spaces', () => {
      expect(isHex('0x 1a3f')).to.be.false;
    });

    it('should return true for a known gasPrice', () => {
      expect(isHex('0x58')).to.be.true;
    });
  });

  describe('ASCIIToHex Function', () => {
    const inputs = ['Lorem Ipsum', 'Foo', 'Bar'];
    const outputs = ['4c6f72656d20497073756d', '466f6f', '426172'];

    it('should return "" for empty string', () => {
      expect(ASCIIToHex('')).to.equal('');
    });

    it('should return valid hex', () => {
      expect(isHex(prepend0x(ASCIIToHex(inputs[0])))).to.be.true;
    });

    it('should return expected hex formatted value', () => {
      expect(inputs[0]).to.equal(hexToASCII(ASCIIToHex(inputs[0])));
    });

    it('should decode correctly regarding hardcoded mapping', () => {
      for (let i = 0; i < inputs.length; i++) {
        expect(ASCIIToHex(inputs[i])).to.eq(outputs[i]);
      }
    });
  });

  describe('strip0x', () => {
    it('should strip "0x" from the beginning of a string', () => {
      const input = '0x123abc';
      const result = strip0x(input);
      expect(result).to.equal('123abc');
    });

    it('should return the same string if it does not start with "0x"', () => {
      const input = '123abc';
      const result = strip0x(input);
      expect(result).to.equal('123abc');
    });

    it('should return an empty string if input is an empty string', () => {
      const input = '';
      const result = strip0x(input);
      expect(result).to.equal('');
    });

    it('should handle input that only contains "0x"', () => {
      const input = '0x';
      const result = strip0x(input);
      expect(result).to.equal('');
    });

    it('should not modify a string that contains "0x" not at the start', () => {
      const input = '1230xabc';
      const result = strip0x(input);
      expect(result).to.equal('1230xabc');
    });

    describe('decodeErrorMessage', () => {
      it('should return an empty string if the message is undefined', () => {
        expect(decodeErrorMessage(undefined)).to.equal('');
      });

      it('should return an empty string if the message is an empty string', () => {
        expect(decodeErrorMessage('')).to.equal('');
      });

      it('should return the message as is if it does not start with 0x', () => {
        const message = 'Some non-hex error message';
        expect(decodeErrorMessage(message)).to.equal(message);
      });

      it('should decode a valid error message', () => {
        const hexErrorMessage =
          '0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d53657420746f2072657665727400000000000000000000000000000000000000';
        const decodedMessage = 'Set to revert';

        expect(decodeErrorMessage(hexErrorMessage)).to.equal(decodedMessage);
      });

      it('should return an empty string for a valid hex message with no content', () => {
        const hexErrorMessage =
          '0x08c379a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000';
        expect(decodeErrorMessage(hexErrorMessage)).to.equal('');
      });

      it('should return empty string for custom error message without parameters', () => {
        expect(decodeErrorMessage('0x858d70bd')).to.equal('');
      });

      it('should return the message of custom error with string parameter', () => {
        const signature = keccak256(Buffer.from('CustomError(string)')).slice(0, 10); // 0x8d6ea8be
        const message = new AbiCoder().encode(['string'], ['Some error message']).replace('0x', '');
        const hexErrorMessage = signature + message;
        expect(decodeErrorMessage(hexErrorMessage)).to.equal('Some error message');
      });
    });
  });

  describe('toHexString', () => {
    it('should convert a Uint8Array with single byte values to a hex string', () => {
      const byteArray = new Uint8Array([0x00, 0xff, 0x7f]);
      const result = toHexString(byteArray);
      expect(result).to.eq('00ff7f');
    });

    it('should convert a Uint8Array with multiple byte values to a hex string', () => {
      const byteArray = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
      const result = toHexString(byteArray);
      expect(result).to.eq('12345678');
    });

    it('should convert an empty Uint8Array to an empty hex string', () => {
      const byteArray = new Uint8Array([]);
      const result = toHexString(byteArray);
      expect(result).to.eq('');
    });

    it('should convert a Uint8Array with maximum byte value (0xff) to a hex string', () => {
      const byteArray = new Uint8Array([0xff, 0xff, 0xff]);
      const result = toHexString(byteArray);
      expect(result).to.eq('ffffff');
    });
  });

  describe('getFunctionSelector', () => {
    it('should return an empty string when input is an empty string or undefined', () => {
      const result = getFunctionSelector('');
      expect(result).to.eq('');

      const undefinedResult = getFunctionSelector(undefined);
      expect(undefinedResult).to.eq('');
    });

    it('should return the first 8 characters of a valid hex string without "0x"', () => {
      const result = getFunctionSelector('1234567890abcdef');
      expect(result).to.eq('12345678');
    });

    it('should return the first 8 characters of a valid hex string starting with "0x"', () => {
      const result = getFunctionSelector('0x1234567890abcdef');
      expect(result).to.eq('12345678');
    });
  });

  describe('mapKeysAndValues', () => {
    it('should map keys and values correctly', () => {
      const target = { a: '1', b: '2', c: '3' };
      const result = mapKeysAndValues(target, { key: (key) => key.toUpperCase(), value: parseInt });
      expect(result).to.deep.equal({ A: 1, B: 2, C: 3 });
    });

    it('should handle empty object', () => {
      const target = {};
      const result = mapKeysAndValues(target, { key: (key) => key, value: parseInt });
      expect(result).to.deep.equal({});
    });

    it('should handle keys with special characters', () => {
      const target = { 'a-b': '1', c_d: '2' };
      const result = mapKeysAndValues(target, { key: (key) => key.replace('-', '_'), value: parseInt });
      expect(result).to.deep.equal({ a_b: 1, c_d: 2 });
    });

    it('should handle values that are not strings', () => {
      const target = { a: '1', b: true, c: null };
      const result = mapKeysAndValues(target, { key: (key) => key.toUpperCase(), value: (value) => String(value) });
      expect(result).to.deep.equal({ A: '1', B: 'true', C: 'null' });
    });

    it('should handle keys that are numbers', () => {
      const target = { '1': 'one', '2': 'two' };
      const result = mapKeysAndValues(target, { key: parseInt, value: (value) => value.toUpperCase() });
      expect(result).to.deep.equal({ 1: 'ONE', 2: 'TWO' });
    });

    it('should apply no mapping if mapFn is not provided', () => {
      const target = { a: '1', b: '2', c: '3' };
      const result = mapKeysAndValues(target, {});
      expect(result).to.deep.equal({ a: '1', b: '2', c: '3' });
    });

    it('should apply no mapping if mapFn.key is not provided', () => {
      const target = { a: '1', b: '2', c: '3' };
      const result = mapKeysAndValues(target, { value: (value) => parseInt(value) });
      expect(result).to.deep.equal({ a: 1, b: 2, c: 3 });
    });

    it('should apply no mapping if mapFn.value is not provided', () => {
      const target = { a: '1', b: '2', c: '3' };
      const result = mapKeysAndValues(target, { key: (key) => key.toUpperCase() });
      expect(result).to.deep.equal({ A: '1', B: '2', C: '3' });
    });
  });

  describe('tinybarsToWeibars', () => {
    for (const allowNegativeValues of [true, false]) {
      it(`should convert tinybars to weibars allowNegativeValues = ${allowNegativeValues}`, () => {
        expect(tinybarsToWeibars(10, allowNegativeValues)).to.eql(100000000000);
      });

      it(`should return null if null is passed allowNegativeValues = ${allowNegativeValues}`, () => {
        expect(tinybarsToWeibars(null, allowNegativeValues)).to.eql(null);
      });

      it(`should return 0 for 0 input allowNegativeValues = ${allowNegativeValues}`, () => {
        expect(tinybarsToWeibars(0, allowNegativeValues)).to.eql(0);
      });

      it(`should throw an error when value is larger than the total supply of tinybars allowNegativeValues = ${allowNegativeValues}`, () => {
        expect(() => tinybarsToWeibars(constants.TOTAL_SUPPLY_TINYBARS * 10, allowNegativeValues)).to.throw(
          Error,
          'Value cannot be more than the total supply of tinybars in the blockchain',
        );
      });
    }

    it('should throw an error when value is smaller than 0', () => {
      expect(() => tinybarsToWeibars(-10, false)).to.throw(Error, 'Invalid value - cannot pass negative number');
    });

    it('should return the negative number if allowNegativeValues flag is set to true', () => {
      expect(tinybarsToWeibars(-10, true)).to.eql(-10);
    });
  });
});
