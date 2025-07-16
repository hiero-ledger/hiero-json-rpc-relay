// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { PrivateKey } from '@hashgraph/sdk';
import { expect } from 'chai';
import createHash from 'keccak';
import pino from 'pino';

import { ASCIIToHex, prepend0x } from '../../src/formatters';
import constants, { TracerType } from '../../src/lib/constants';
import { RPC_PARAM_LAYOUT_KEY } from '../../src/lib/decorators/rpcParamLayoutConfig.decorator';
import { RPC_LAYOUT } from '../../src/lib/decorators/rpcParamLayoutConfig.decorator';
import { RequestDetails } from '../../src/lib/types';
import { Utils } from '../../src/utils';
import { estimateFileTransactionsFee, overrideEnvsInMochaDescribe, withOverriddenEnvsInMochaTest } from '../helpers';

describe('Utils', () => {
  describe('addPercentageBufferToGasPrice', () => {
    const TW_COEF = constants.TINYBAR_TO_WEIBAR_COEF;
    const TEST_CASES = [
      { testName: 'zero input', buffer: '0', input: 0, output: 0 },
      { testName: 'buffer 0%', buffer: '0', input: 10 * TW_COEF, output: 10 * TW_COEF },
      { testName: 'buffer 7%', buffer: '7', input: 140 * TW_COEF, output: 150 * TW_COEF },
      { testName: 'buffer 10%', buffer: '10', input: 126 * TW_COEF, output: 139 * TW_COEF },
      { testName: 'buffer 12.25%', buffer: '12.25', input: 56 * TW_COEF, output: 63 * TW_COEF },
      { testName: 'negative buffer -6%', buffer: '-6', input: 100 * TW_COEF, output: 94 * TW_COEF },
      { testName: 'negative buffer -12.58%', buffer: '-12.58', input: 136 * TW_COEF, output: 119 * TW_COEF },
    ];
    const gasFormat = Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 2,
    });

    for (const i in TEST_CASES) {
      describe(`${TEST_CASES[i].testName}, ${gasFormat.format(TEST_CASES[i].input)} gas`, () => {
        overrideEnvsInMochaDescribe({ GAS_PRICE_PERCENTAGE_BUFFER: TEST_CASES[i].buffer });

        it(`should return ${gasFormat.format(TEST_CASES[i].output)} gas`, () => {
          expect(Utils.addPercentageBufferToGasPrice(TEST_CASES[i].input)).to.equal(TEST_CASES[i].output);
        });
      });
    }
  });

  describe('estimateFileTransactionsFee', () => {
    const callDataSize = 6000;
    const mockedExchangeRateInCents: number = 12;
    const fileChunkSize = ConfigService.get('FILE_APPEND_CHUNK_SIZE');
    it('Should execute estimateFileTransactionFee() to estimate total fee of file transactions', async () => {
      const result = Utils.estimateFileTransactionsFee(callDataSize, fileChunkSize, mockedExchangeRateInCents);
      const expectedResult = estimateFileTransactionsFee(callDataSize, fileChunkSize, mockedExchangeRateInCents);
      expect(result).to.eq(expectedResult);
    });
  });

  describe('isRevertedDueToHederaSpecificValidation', () => {
    it('should not exclude transaction with status SUCCESS', () => {
      expect(Utils.isRevertedDueToHederaSpecificValidation({ result: 'SUCCESS', error_message: null })).to.be.false;
    });

    it('should not exclude evm reverted transaction', () => {
      expect(
        Utils.isRevertedDueToHederaSpecificValidation({
          result: 'CONTRACT_REVERT_EXECUTED',
          error_message: 'Error',
        }),
      ).to.be.false;
    });

    ConfigService.get('HEDERA_SPECIFIC_REVERT_STATUSES').forEach((status) => {
      it(`should exclude transaction with result ${status}`, () => {
        expect(Utils.isRevertedDueToHederaSpecificValidation({ result: status, error_message: null })).to.be.true;
      });
      it(`should exclude transaction with error_message ${status}`, () => {
        expect(
          Utils.isRevertedDueToHederaSpecificValidation({
            result: '',
            error_message: prepend0x(ASCIIToHex(status)),
          }),
        ).to.be.true;
      });
    });
  });

  describe('computeTransactionHash', () => {
    const testCases = [
      { description: 'handle empty buffer', input: '' },
      { description: 'handle buffer with special characters', input: '!@#$%^&*()' },
      {
        description: 'compute correct keccak256 hash and prepend 0x',
        input:
          '0x02f881820128048459682f0086014fa0186f00901714801554cbe52dd95512bedddf68e09405fba803be258049a27b820088bab1cad205887185174876e80080c080a0cab3f53602000c9989be5787d0db637512acdd2ad187ce15ba83d10d9eae2571a07802515717a5a1c7d6fa7616183eb78307b4657d7462dbb9e9deca820dd28f62',
      },
    ];

    testCases.forEach(({ description, input }) => {
      it(`should ${description}`, () => {
        const testBuffer = Buffer.from(input);
        const expectedHash = '0x' + createHash('keccak256').update(testBuffer).digest('hex');

        const result = Utils.computeTransactionHash(testBuffer);

        expect(result).to.equal(expectedHash);
        expect(result.substring(0, 2)).to.equal('0x');
        // Keccak-256 produces a 32 byte (256 bit) hash
        // Each byte is represented by 2 hex characters
        // Plus 2 characters for '0x' prefix
        expect(result.length).to.equal(66);
      });
    });
  });

  describe('getOperator', () => {
    const logger = pino({ level: 'silent' });
    const accountId = '0.0.1234';
    const privateKeys = [
      { keyFormat: 'HEX_ECDSA', keyValue: PrivateKey.generateECDSA().toStringRaw() },
      { keyFormat: 'DER', keyValue: PrivateKey.generateECDSA().toStringDer() },
      { keyFormat: 'HEX_ED25519', keyValue: PrivateKey.generateED25519().toStringRaw() },
      { keyFormat: 'DER', keyValue: PrivateKey.generateED25519().toStringDer() },
    ];

    withOverriddenEnvsInMochaTest(
      {
        OPERATOR_ID_MAIN: false,
        OPERATOR_KEY_MAIN: false,
      },
      () => {
        it('should return null for invalid operator id or key', () => {
          const operator = Utils.getOperator(logger);
          expect(operator).to.be.null;
        });
      },
    );

    privateKeys.forEach(({ keyFormat, keyValue }) => {
      withOverriddenEnvsInMochaTest(
        {
          OPERATOR_ID_MAIN: accountId,
          OPERATOR_KEY_MAIN: keyValue,
          OPERATOR_KEY_FORMAT: keyFormat,
        },
        () => {
          it(`should return operator credentials for main client type`, () => {
            const operator = Utils.getOperator(logger);

            expect(operator).to.not.be.null;
            expect(operator?.accountId.toString()).to.equal(accountId);
            expect(operator?.privateKey).to.deep.equal(Utils.createPrivateKeyBasedOnFormat(keyValue));
          });
        },
      );
    });
  });

  describe('getNetworkNameByChainId', () => {
    for (const [chainId, networkName] of Object.entries({
      '0x127': 'mainnet',
      '0x128': 'testnet',
      '0x129': 'previewnet',
      '0x12a': 'local',
    })) {
      withOverriddenEnvsInMochaTest(
        {
          CHAIN_ID: chainId,
        },
        () => {
          it(`should return ${networkName} for chain id ${chainId}`, () => {
            const networkName = Utils.getNetworkNameByChainId();
            expect(networkName).to.equal(networkName);
          });
        },
      );
    }
  });

  describe('arrangeRpcParams', () => {
    const requestDetails = new RequestDetails({
      requestId: 'test-request-id',
      ipAddress: '127.0.0.1',
    });

    it('should return only requestDetails for REQUEST_DETAILS_ONLY layout', () => {
      const mockMethod = function () {};
      mockMethod[RPC_PARAM_LAYOUT_KEY] = RPC_LAYOUT.REQUEST_DETAILS_ONLY;

      const result = Utils.arrangeRpcParams(mockMethod, ['param1', 'param2'], requestDetails);
      expect(result).to.deep.equal([requestDetails]);
    });

    it('should apply custom parameter layout function', () => {
      const customLayout = (params) => [params[0], params[1]];
      const mockMethod = function () {};
      mockMethod[RPC_PARAM_LAYOUT_KEY] = customLayout;

      const result = Utils.arrangeRpcParams(mockMethod, ['param1', 'param2'], requestDetails);
      expect(result).to.deep.equal(['param1', 'param2', requestDetails]);
    });

    it('should use default behavior when no layout is specified', () => {
      const mockMethod = function () {};

      const result = Utils.arrangeRpcParams(mockMethod, ['param1', 'param2'], requestDetails);
      expect(result).to.deep.equal(['param1', 'param2', requestDetails]);
    });

    it('should handle empty params with default behavior', () => {
      const mockMethod = function () {};

      const result = Utils.arrangeRpcParams(mockMethod, [], requestDetails);
      expect(result).to.deep.equal([requestDetails]);
    });

    describe('special case for traceTransaction', () => {
      const traceTransactionMethod = function traceTransaction() {};
      const transactionHash = '0x123456789abcdef';
      const tracerConfig = { enableMemory: true };

      // Define test cases as [testName, params, expectedTracer, expectedConfig]
      const testCases = [
        {
          name: 'should handle traceTransaction with only transaction hash',
          params: [],
          expected: [transactionHash, requestDetails],
        },
        {
          name: 'should handle traceTransaction with tracerConfigWrapper as second parameter',
          params: [{ tracer: TracerType.CallTracer, tracerConfig: tracerConfig }],
          expected: [transactionHash, { tracer: TracerType.CallTracer, tracerConfig: tracerConfig }, requestDetails],
        },
        {
          name: 'should handle traceTransaction with partial tracerConfigWrapper (only tracer)',
          params: [{ tracer: TracerType.CallTracer }],
          expected: [transactionHash, { tracer: TracerType.CallTracer }, requestDetails],
        },
        {
          name: 'should handle traceTransaction with empty tracerConfig',
          params: [{ tracer: TracerType.CallTracer, tracerConfig: {} }],
          expected: [transactionHash, { tracer: TracerType.CallTracer, tracerConfig: {} }, requestDetails],
        },
      ];

      // Loop through test cases and create tests
      testCases.forEach(({ name, params, expected }) => {
        it(name, () => {
          const result = Utils.arrangeRpcParams(traceTransactionMethod, [transactionHash, ...params], requestDetails);

          expect(result).to.deep.equal(expected);
        });
      });
    });
  });
});
