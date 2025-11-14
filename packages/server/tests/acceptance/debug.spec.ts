// SPDX-License-Identifier: Apache-2.0

// External resources
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { predefined } from '@hashgraph/json-rpc-relay';
import { numberTo0x } from '@hashgraph/json-rpc-relay/src/formatters';
import { TracerType } from '@hashgraph/json-rpc-relay/src/lib/constants';
import chai, { expect } from 'chai';
import chaiExclude from 'chai-exclude';
import { ethers } from 'ethers';

import { ConfigServiceTestHelper } from '../../../config-service/tests/configServiceTestHelper';
import RelayCall from '../../tests/helpers/constants';
import MirrorClient from '../clients/mirrorClient';
import RelayClient from '../clients/relayClient';
import basicContractJson from '../contracts/Basic.json';
import deployerContractJson from '../contracts/Deployer.json';
import mockContractJson from '../contracts/MockContract.json';
import parentContractJson from '../contracts/Parent.json';
import reverterContractJson from '../contracts/Reverter.json';
import Assertions from '../helpers/assertions';
import { Utils } from '../helpers/utils';
import { AliasAccount } from '../types/AliasAccount';

chai.use(chaiExclude);

describe('@debug API Acceptance Tests', function () {
  this.timeout(240 * 1000); // 240 seconds

  const accounts: AliasAccount[] = [];

  // @ts-ignore
  const { mirrorNode, relay }: { mirrorNode: MirrorClient; relay: RelayClient } = global;

  let basicContract: ethers.Contract;
  let basicContractAddress: string;
  let reverterContract: ethers.Contract;
  let reverterContractAddress: string;
  let deploymentBlockNumber: number;
  let parentContract: ethers.Contract;
  let parentContractAddress: string;
  let deployerContract: ethers.Contract;
  let deployerContractAddress: string;
  let createChildTx: ethers.ContractTransactionResponse;
  let mirrorContractDetails: any;

  const PURE_METHOD_CALL_DATA = '0xb2e0100c';
  const BASIC_CONTRACT_PING_CALL_DATA = '0x5c36b186';

  const DEBUG_TRACE_BLOCK_BY_NUMBER = 'debug_traceBlockByNumber';
  const DEBUG_TRACE_TRANSACTION = 'debug_traceTransaction';

  const TRACER_CONFIGS = {
    CALL_TRACER_TOP_ONLY_FALSE: { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } },
    CALL_TRACER_TOP_ONLY: { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: true } },
    PRESTATE_TRACER: { tracer: TracerType.PrestateTracer },
    PRESTATE_TRACER_TOP_ONLY: { tracer: TracerType.PrestateTracer, tracerConfig: { onlyTopCall: true } },
    PRESTATE_TRACER_TOP_ONLY_FALSE: { tracer: TracerType.PrestateTracer, tracerConfig: { onlyTopCall: false } },
    OPCODE_LOGGER: { tracer: TracerType.OpcodeLogger },
    OPCODE_WITH_MEMORY: { tracer: TracerType.OpcodeLogger, tracerConfig: { enableMemory: true } },
    OPCODE_WITH_MEMORY_AND_STACK: {
      tracer: TracerType.OpcodeLogger,
      tracerConfig: { enableMemory: true, enableStack: true },
    },
    OPCODE_WITH_STACK: { tracer: TracerType.OpcodeLogger, tracerConfig: { disableStack: true } },
    OPCODE_WITH_STORAGE: { tracer: TracerType.OpcodeLogger, tracerConfig: { disableStorage: true } },
    OPCODE_WITH_MEMORY_AND_STORAGE: {
      tracer: TracerType.OpcodeLogger,
      tracerConfig: { enableMemory: true, disableStorage: true },
    },
  };

  before(async () => {
    const initialAccount: AliasAccount = global.accounts[0];

    const initialBalance = '10000000000';
    const neededAccounts: number = 2;
    accounts.push(
      ...(await Utils.createMultipleAliasAccounts(mirrorNode, initialAccount, neededAccounts, initialBalance)),
    );
    global.accounts.push(...accounts);

    // Deploy the Basic contract
    basicContract = await Utils.deployContract(basicContractJson.abi, basicContractJson.bytecode, accounts[0].wallet);
    basicContractAddress = basicContract.target as string;

    const basicContractTxHash = basicContract.deploymentTransaction()?.hash;
    expect(basicContractTxHash).to.not.be.null;

    const transactionReceipt = await accounts[0].wallet.provider?.getTransactionReceipt(basicContractTxHash!);
    expect(transactionReceipt).to.not.be.null;

    if (transactionReceipt) {
      deploymentBlockNumber = transactionReceipt.blockNumber;
    }

    // Deploy the Reverter contract
    reverterContract = await Utils.deployContract(
      reverterContractJson.abi,
      reverterContractJson.bytecode,
      accounts[0].wallet,
    );
    reverterContractAddress = reverterContract.target as string;

    deployerContract = await Utils.deployContract(
      deployerContractJson.abi,
      deployerContractJson.bytecode,
      accounts[0].wallet,
    );
    deployerContractAddress = deployerContract.target as string;
  });

  describe('debug_traceBlockByNumber', () => {
    it('should trace a block containing a contract call tx that executes CREATE2 opcode using CallTracer', async () => {
      const transaction = await Utils.buildTransaction(
        relay,
        deployerContractAddress,
        accounts[0].address,
        '0xdbb6f04a', // deployViaCreate2() selector
      );
      const receipt = await Utils.getReceipt(relay, transaction, accounts[0].wallet);

      const result = await relay.call(DEBUG_TRACE_BLOCK_BY_NUMBER, [
        receipt.blockNumber,
        TRACER_CONFIGS.CALL_TRACER_TOP_ONLY_FALSE,
      ]);

      expect(result).to.not.be.empty;
      expect(result[0].result.calls).to.not.be.empty;
      expect(result[0].result.calls[0].type).to.equal('CREATE2');
      expect(result[0].result.calls[0].input).to.equal(mockContractJson.bytecode);
      expect(result[0].result.calls[0].output).to.equal(mockContractJson.deployedBytecode);
    });

    it('@release should trace a block containing successful transactions using CallTracer', async function () {
      // Create a transaction that will be included in the next block
      const transaction = await Utils.buildTransaction(
        relay,
        basicContractAddress,
        accounts[0].address,
        BASIC_CONTRACT_PING_CALL_DATA,
      );
      const receipt = await Utils.getReceipt(relay, transaction, accounts[0].wallet);

      // Get the block number from the receipt
      const blockNumber = receipt.blockNumber;

      // Call debug_traceBlockByNumber with CallTracer
      const result = await relay.call(DEBUG_TRACE_BLOCK_BY_NUMBER, [
        blockNumber,
        TRACER_CONFIGS.CALL_TRACER_TOP_ONLY_FALSE,
      ]);

      expect(result).to.be.an('array');
      expect(result.length).to.be.at.least(1);

      // Find our transaction in the result
      const txTrace = result.find((trace) => trace.txHash === receipt.transactionHash);
      expect(txTrace).to.exist;
      expect(txTrace.result).to.exist;
      Assertions.validateCallTracerResult(
        txTrace.result,
        BASIC_CONTRACT_PING_CALL_DATA,
        accounts[0].address,
        basicContractAddress,
      );
    });

    it('@release should trace a block containing a failing transaction using CallTracer', async function () {
      // Create a transaction that will revert
      const transaction = await Utils.buildTransaction(
        relay,
        reverterContractAddress,
        accounts[0].address,
        PURE_METHOD_CALL_DATA,
      );
      const receipt = await Utils.getReceipt(relay, transaction, accounts[0].wallet);

      // Get the block number from the receipt
      const blockNumber = receipt.blockNumber;

      // Call debug_traceBlockByNumber with CallTracer
      const result = await relay.call(DEBUG_TRACE_BLOCK_BY_NUMBER, [
        blockNumber,
        TRACER_CONFIGS.CALL_TRACER_TOP_ONLY_FALSE,
      ]);

      expect(result).to.be.an('array');
      expect(result.length).to.be.at.least(1);

      // Find our transaction in the result
      const txTrace = result.find((trace) => trace.txHash === receipt.transactionHash);
      Assertions.validateCallTracerResult(
        txTrace.result,
        PURE_METHOD_CALL_DATA,
        accounts[0].address,
        reverterContractAddress,
      );
      expect(txTrace.result.error).to.exist; // There should be an error field for the reverted transaction
      expect(txTrace.result.revertReason).to.exist; // There should be a revert reason
    });

    it('@release should trace a block using PrestateTracer', async function () {
      // Create a transaction that will be included in the next block
      const transaction = await Utils.buildTransaction(
        relay,
        basicContractAddress,
        accounts[0].address,
        BASIC_CONTRACT_PING_CALL_DATA,
      );
      const receipt = await Utils.getReceipt(relay, transaction, accounts[0].wallet);

      // Get the block number from the receipt
      const blockNumber = receipt.blockNumber;

      // Call debug_traceBlockByNumber with PrestateTracer
      const result = await relay.call(DEBUG_TRACE_BLOCK_BY_NUMBER, [blockNumber, TRACER_CONFIGS.PRESTATE_TRACER]);

      expect(result).to.be.an('array');
      expect(result.length).to.be.at.least(1);

      // Find our transaction in the result
      const txTrace = result.find((trace) => trace.txHash === receipt.transactionHash);
      expect(txTrace).to.exist;
      expect(txTrace.result).to.exist;

      // Check that the result contains prestate information for at least the contract and sender
      const keys = Object.keys(txTrace.result);
      expect(keys.length).to.be.at.least(2);

      // For each address in the result, check it has the expected fields
      for (const address of keys) {
        const state = txTrace.result[address];
        Assertions.validatePrestateTracerResult(state);
      }
    });

    it('should trace a block using PrestateTracer with onlyTopCall=true', async function () {
      // Create a transaction that calls a contract which might make internal calls
      const transaction = await Utils.buildTransaction(
        relay,
        basicContractAddress,
        accounts[0].address,
        BASIC_CONTRACT_PING_CALL_DATA,
      );
      const receipt = await Utils.getReceipt(relay, transaction, accounts[0].wallet);

      const blockNumber = receipt.blockNumber;

      // First trace with onlyTopCall=false (default)
      const fullResult = await relay.call(DEBUG_TRACE_BLOCK_BY_NUMBER, [
        blockNumber,
        TRACER_CONFIGS.PRESTATE_TRACER_TOP_ONLY,
      ]);

      // Then trace with onlyTopCall=true
      const topCallResult = await relay.call(DEBUG_TRACE_BLOCK_BY_NUMBER, [
        blockNumber,
        TRACER_CONFIGS.PRESTATE_TRACER_TOP_ONLY,
      ]);

      // Both should return results
      expect(fullResult).to.be.an('array');
      expect(topCallResult).to.be.an('array');

      // Find our transaction in both results
      const fullTxTrace = fullResult.find((trace) => trace.txHash === receipt.transactionHash);
      const topCallTxTrace = topCallResult.find((trace) => trace.txHash === receipt.transactionHash);

      expect(fullTxTrace).to.exist;
      expect(topCallTxTrace).to.exist;

      // Both should contain at least the contract address and sender address
      expect(Object.keys(fullTxTrace.result).length).to.be.at.least(2);
      expect(Object.keys(topCallTxTrace.result).length).to.be.at.least(2);

      // The addresses in topCallResult should be a subset of those in fullResult
      // or equal if there are no nested calls
      const fullAddresses = Object.keys(fullTxTrace.result);
      const topCallAddresses = Object.keys(topCallTxTrace.result);

      // Every address in topCallAddresses should be in fullAddresses
      topCallAddresses.forEach((address) => {
        expect(fullAddresses).to.include(address);
      });

      // Each address should have the standard fields
      for (const address of topCallAddresses) {
        const state = topCallTxTrace.result[address];
        Assertions.validatePrestateTracerResult(state);
      }
    });

    it('should return an empty array for a block with no transactions', async function () {
      // Find a block with no transactions
      let currentBlockNumber = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_BLOCK_NUMBER, []);

      // Convert from hex
      currentBlockNumber = parseInt(currentBlockNumber, 16);

      // Go back several blocks to find one without transactions
      let blockNumberToTest = Math.max(1, currentBlockNumber - 10);
      let block;
      let hasTransactions = true;

      while (hasTransactions && blockNumberToTest < currentBlockNumber) {
        block = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER, [
          numberTo0x(blockNumberToTest),
          false,
        ]);

        hasTransactions = block.transactions.length > 0;

        if (hasTransactions) {
          blockNumberToTest++;
        }
      }

      if (!hasTransactions) {
        // Found a block without transactions
        const result = await relay.call(DEBUG_TRACE_BLOCK_BY_NUMBER, [
          numberTo0x(blockNumberToTest),
          TRACER_CONFIGS.CALL_TRACER_TOP_ONLY_FALSE,
        ]);

        expect(result).to.be.an('array');
        expect(result.length).to.equal(0);
      } else {
        // Skip this test if we can't find a block without transactions
        this.skip();
      }
    });

    it('should fail with INVALID_PARAMETER when given an invalid block number', async function () {
      // Invalid block number format
      await relay.callFailing(
        DEBUG_TRACE_BLOCK_BY_NUMBER,
        ['invalidBlockNumber', TRACER_CONFIGS.CALL_TRACER_TOP_ONLY_FALSE],
        predefined.INVALID_PARAMETER(
          '0',
          'Expected 0x prefixed hexadecimal block number, or the string "latest", "earliest" or "pending"',
        ),
      );
    });

    it('should fail with INVALID_PARAMETER when given an invalid tracer configuration', async function () {
      const invalidTracerConfig = { tracer: 'InvalidTracer', tracerConfig: { onlyTopCall: false } };
      await relay.callFailing(
        DEBUG_TRACE_BLOCK_BY_NUMBER,
        [numberTo0x(deploymentBlockNumber), invalidTracerConfig],
        predefined.INVALID_PARAMETER("'tracer' for TracerConfigWrapper", 'Expected TracerType, value: InvalidTracer'),
      );
    });

    it('@release should handle CREATE transactions with to=null in trace results', async function () {
      // Just use the existing basic contract deployment to test CREATE transactions
      // The deployment block should contain a CREATE transaction
      const deploymentBlockHex = numberTo0x(deploymentBlockNumber);

      // Call debug_traceBlockByNumber for the deployment block
      const result = await relay.call(DEBUG_TRACE_BLOCK_BY_NUMBER, [
        deploymentBlockHex,
        TRACER_CONFIGS.CALL_TRACER_TOP_ONLY_FALSE,
      ]);

      expect(result).to.be.an('array');
      expect(result.length).to.be.at.least(1);

      // Find a CREATE transaction in the result (from contract deployment)
      const createTxTrace = result.find((trace) => trace.result && trace.result.type === 'CREATE');
      expect(createTxTrace).to.exist;
      expect(createTxTrace.result).to.exist;

      // Verify it's a CREATE transaction with proper structure
      expect(createTxTrace.result.type).to.equal('CREATE');
      expect(createTxTrace.result.from).to.exist;
      expect(createTxTrace.result.to).to.exist;
      expect(createTxTrace.result.gas).to.exist;
      expect(createTxTrace.result.gasUsed).to.exist;
      expect(createTxTrace.result.input).to.exist;
      expect(createTxTrace.result.output).to.exist;

      // This test verifies that CREATE actions with to=null don't cause Mirror Node lookup errors
      // The main goal is that the debug_traceBlockByNumber call succeeds without throwing
      // "Invalid parameter: contractid" errors when processing CREATE transactions
    });
  });

  describe('debug_traceTransaction', () => {
    const PARENT_CONTRACT_CREATE_CHILD_CALL_DATA =
      '0x0419eca50000000000000000000000000000000000000000000000000000000000000001';
    before(async () => {
      // Deploy the Parent contract for testing transactions with internal calls
      parentContract = await Utils.deployContract(
        parentContractJson.abi,
        parentContractJson.bytecode,
        accounts[0].wallet,
      );
      parentContractAddress = parentContract.target as string;

      // Send some ether to the parent contract
      const response = await accounts[0].wallet.sendTransaction({
        to: parentContractAddress,
        value: ethers.parseEther('1'),
      });
      await relay.pollForValidTransactionReceipt(response.hash);

      // Call createChild to create a transaction with internal calls
      // @ts-ignore
      createChildTx = await parentContract.createChild(1);

      await relay.pollForValidTransactionReceipt(createChildTx.hash);

      // Get contract result details from mirror node
      mirrorContractDetails = await mirrorNode.get(`/contracts/results/${createChildTx.hash}`);
      mirrorContractDetails.from = accounts[0].address;
    });

    describe('Call Tracer', () => {
      it('should trace a transaction using CallTracer with onlyTopCall=false', async function () {
        // Call debug_traceTransaction with CallTracer (default config)
        const result = await relay.call(DEBUG_TRACE_TRANSACTION, [
          createChildTx.hash,
          TRACER_CONFIGS.CALL_TRACER_TOP_ONLY_FALSE,
        ]);

        Assertions.validateCallTracerResult(
          result,
          PARENT_CONTRACT_CREATE_CHILD_CALL_DATA,
          accounts[0].address,
          parentContractAddress,
        );
        expect(result).to.have.property('calls');
      });

      it('should trace a transaction using CallTracer with onlyTopCall=true', async function () {
        // Call debug_traceTransaction with CallTracer (default config)
        const result = await relay.call(DEBUG_TRACE_TRANSACTION, [
          createChildTx.hash,
          TRACER_CONFIGS.CALL_TRACER_TOP_ONLY,
        ]);

        Assertions.validateCallTracerResult(
          result,
          PARENT_CONTRACT_CREATE_CHILD_CALL_DATA,
          accounts[0].address,
          parentContractAddress,
        );
        expect(result).to.have.property('calls');
        expect(result.calls).to.be.an('array').that.is.empty;
      });
    });

    describe('PrestateTracer', () => {
      it('should trace a transaction using PrestateTracer', async function () {
        const result = await relay.call(DEBUG_TRACE_TRANSACTION, [createChildTx.hash, TRACER_CONFIGS.PRESTATE_TRACER]);

        expect(result).to.be.an('object');
        expect(Object.keys(result).length).to.be.at.least(1);

        // Check that the result contains prestate information for at least the contract and sender
        const keys = Object.keys(result);
        expect(keys.length).to.be.at.least(2);

        // For each address in the result, check it has the expected fields
        for (const address of keys) {
          const state = result[address];
          Assertions.validatePrestateTracerResult(state);
        }
      });

      it('should trace a transaction using PrestateTracer with onlyTopCall=true', async function () {
        const result = await relay.call(DEBUG_TRACE_TRANSACTION, [
          createChildTx.hash,
          TRACER_CONFIGS.PRESTATE_TRACER_TOP_ONLY,
        ]);

        expect(result).to.be.an('object');
        expect(Object.keys(result).length).to.be.at.least(1);

        // Check that the result contains prestate information for at least the contract and sender
        const keys = Object.keys(result);
        expect(keys.length).to.be.at.least(2);

        // For each address in the result, check it has the expected fields
        for (const address of keys) {
          const state = result[address];
          Assertions.validatePrestateTracerResult(state);
        }
      });

      it('should trace a transaction using PrestateTracer with onlyTopCall=false', async function () {
        const result = await relay.call(DEBUG_TRACE_TRANSACTION, [
          createChildTx.hash,
          TRACER_CONFIGS.PRESTATE_TRACER_TOP_ONLY_FALSE,
        ]);

        expect(result).to.be.an('object');
        expect(Object.keys(result).length).to.be.at.least(1);

        // Check that the result contains prestate information for at least the contract and sender
        const keys = Object.keys(result);
        expect(keys.length).to.be.at.least(2);

        // For each address in the result, check it has the expected fields
        for (const address of keys) {
          const state = result[address];
          Assertions.validatePrestateTracerResult(state);
        }
      });
    });

    describe('OpcodeLogger', () => {
      it('should trace a successful transaction using OpcodeLogger (default when no tracer specified)', async function () {
        const result = await relay.call(DEBUG_TRACE_TRANSACTION, [createChildTx.hash]);

        // Validate response structure for OpcodeLogger
        Assertions.validateOpcodeLoggerResult(result);

        // Check that structLogs contains opcode information
        if (result.structLogs.length > 0) {
          const firstLog = result.structLogs[0];
          expect(firstLog).to.have.property('pc');
          expect(firstLog).to.have.property('op');
          expect(firstLog).to.have.property('gas');
          expect(firstLog).to.have.property('gasCost');
          expect(firstLog).to.have.property('depth');
        }
      });

      it('should trace a successful transaction using OpcodeLogger explicitly', async function () {
        const result = await relay.call(DEBUG_TRACE_TRANSACTION, [createChildTx.hash, TRACER_CONFIGS.OPCODE_LOGGER]);

        Assertions.validateOpcodeLoggerResult(result);
      });

      it('should trace using OpcodeLogger with custom config (enableMemory=true)', async function () {
        const result = await relay.call(DEBUG_TRACE_TRANSACTION, [
          createChildTx.hash,
          TRACER_CONFIGS.OPCODE_WITH_MEMORY,
        ]);

        expect(result).to.be.an('object');
        expect(result).to.have.property('structLogs');

        // With enableMemory=true, memory field should be present in struct logs
        if (result.structLogs.length > 0) {
          const logsWithMemory = result.structLogs.filter((log) => log.memory);
          expect(logsWithMemory.length).to.be.greaterThan(0);
        }
      });

      it('should trace using OpcodeLogger with custom config (disableStack=true)', async function () {
        const result = await relay.call(DEBUG_TRACE_TRANSACTION, [
          createChildTx.hash,
          TRACER_CONFIGS.OPCODE_WITH_STACK,
        ]);

        expect(result).to.be.an('object');
        expect(result).to.have.property('structLogs');

        // With disableStack=true, stack field should not be present in struct logs
        if (result.structLogs.length > 0) {
          const logsWithStack = result.structLogs.filter((log) => log.stack);
          expect(logsWithStack.length).to.equal(0);
        }
      });

      it('should trace using OpcodeLogger with custom config (disableStorage=true)', async function () {
        const result = await relay.call(DEBUG_TRACE_TRANSACTION, [
          createChildTx.hash,
          TRACER_CONFIGS.OPCODE_WITH_STORAGE,
        ]);

        expect(result).to.be.an('object');
        expect(result).to.have.property('structLogs');

        // With disableStorage=true, storage field should not be present in struct logs
        if (result.structLogs.length > 0) {
          const logsWithStorage = result.structLogs.filter((log) => log.storage);
          expect(logsWithStorage.length).to.equal(0);
        }
      });

      it('should trace using OpcodeLogger with custom config (enableMemory=true, disableStorage=true)', async function () {
        const result = await relay.call(DEBUG_TRACE_TRANSACTION, [
          createChildTx.hash,
          TRACER_CONFIGS.OPCODE_WITH_MEMORY_AND_STORAGE,
        ]);

        expect(result).to.be.an('object');
        expect(result).to.have.property('structLogs');
      });
    });

    describe('Edge Cases - Parameter Validation', () => {
      it('should fail with MISSING_REQUIRED_PARAMETER when transaction hash is missing', async function () {
        await relay.callFailing(DEBUG_TRACE_TRANSACTION, [], predefined.MISSING_REQUIRED_PARAMETER(0));
      });

      it('should fail with INVALID_PARAMETER when given an invalid transaction hash format', async function () {
        const invalidHash = '0xinvalidhash';
        await relay.callFailing(
          DEBUG_TRACE_TRANSACTION,
          [invalidHash],
          predefined.INVALID_PARAMETER(
            0,
            'Expected Expected 0x prefixed string representing the hash (32 bytes) of a transaction, value: 0xinvalidhash',
          ),
        );
      });

      it('should fail with RESOURCE_NOT_FOUND for non-existent transaction hash and no tracer', async function () {
        const nonExistentHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
        await relay.callFailing(
          DEBUG_TRACE_TRANSACTION,
          [nonExistentHash],
          predefined.RESOURCE_NOT_FOUND(`Failed to retrieve contract results for transaction ${nonExistentHash}`),
        );
      });

      it('should fail with RESOURCE_NOT_FOUND for non-existent transaction hash with tracer', async function () {
        const nonExistentHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdee';
        await relay.callFailing(
          DEBUG_TRACE_TRANSACTION,
          [nonExistentHash, TRACER_CONFIGS.CALL_TRACER_TOP_ONLY],
          predefined.RESOURCE_NOT_FOUND(`Failed to retrieve contract results for transaction ${nonExistentHash}`),
        );
      });

      it('should fail with INVALID_PARAMETER when given an invalid tracer type', async function () {
        const invalidTracerConfig = { tracer: 'InvalidTracer' };
        await relay.callFailing(
          DEBUG_TRACE_TRANSACTION,
          [createChildTx.hash, invalidTracerConfig],
          predefined.INVALID_PARAMETER("'tracer' for TracerConfigWrapper", 'Expected TracerType, value: InvalidTracer'),
        );
      });

      it('should fail with INVALID_PARAMETER when given invalid TracerConfig for CallTracer', async function () {
        const invalidTracerConfig = {
          tracer: TracerType.CallTracer,
          tracerConfig: { onlyTopCall: 'invalid' },
        };
        await relay.callFailing(
          DEBUG_TRACE_TRANSACTION,
          [createChildTx.hash, invalidTracerConfig],
          predefined.INVALID_PARAMETER("'tracerConfig' for TracerConfigWrapper", 'Expected TracerConfig'),
        );
      });

      it('should fail with INVALID_PARAMETER when given invalid TracerConfig for OpcodeLogger', async function () {
        const invalidTracerConfig = {
          tracer: TracerType.OpcodeLogger,
          tracerConfig: { enableMemory: 'invalid' },
        };
        await relay.callFailing(
          DEBUG_TRACE_TRANSACTION,
          [createChildTx.hash, invalidTracerConfig],
          predefined.INVALID_PARAMETER("'tracerConfig' for TracerConfigWrapper", 'Expected TracerConfig'),
        );
      });

      it('should fail with INVALID_PARAMETER when using CallTracer config with OpcodeLogger tracer', async function () {
        const invalidTracerConfig = {
          tracer: TracerType.OpcodeLogger,
          tracerConfig: { onlyTopCall: true }, // CallTracer config with OpcodeLogger tracer
        };
        await relay.callFailing(
          DEBUG_TRACE_TRANSACTION,
          [createChildTx.hash, invalidTracerConfig],
          predefined.INVALID_PARAMETER(
            1,
            'callTracer config properties for TracerConfigWrapper are only valid when tracer=callTracer',
          ),
        );
      });

      it('should fail with INVALID_PARAMETER when using OpcodeLogger config with CallTracer tracer', async function () {
        const invalidTracerConfig = {
          tracer: TracerType.CallTracer,
          tracerConfig: { enableMemory: true }, // OpcodeLogger config with CallTracer tracer
        };
        await relay.callFailing(
          DEBUG_TRACE_TRANSACTION,
          [createChildTx.hash, invalidTracerConfig],
          predefined.INVALID_PARAMETER(
            1,
            'opcodeLogger config properties for TracerConfigWrapper are only valid when tracer=opcodeLogger',
          ),
        );
      });

      it('should support both nested and top-level tracer config parameter formats', async function () {
        // Test the nested format (original format)
        const nestedFormat = {
          tracer: TracerType.OpcodeLogger,
          tracerConfig: {
            enableMemory: true,
            disableStack: false,
            disableStorage: true,
          },
        };

        const nestedResult = await relay.call(DEBUG_TRACE_TRANSACTION, [createChildTx.hash, nestedFormat]);
        expect(nestedResult).to.exist;
        expect(nestedResult.structLogs).to.exist;

        // Test the top-level format (new format from our fix)
        const topLevelFormat = {
          enableMemory: true,
          disableStack: false,
          disableStorage: true,
        };

        // Test with fullStorage parameter (Remix compatibility)
        const topLevelWithFullStorage = {
          enableMemory: true,
          disableStack: false,
          disableStorage: true,
          fullStorage: false, // Non-standard parameter sent by Remix
        };

        const topLevelResult = await relay.call(DEBUG_TRACE_TRANSACTION, [createChildTx.hash, topLevelFormat]);
        expect(topLevelResult).to.exist;
        expect(topLevelResult.structLogs).to.exist;

        // Test that fullStorage parameter is accepted (Remix compatibility)
        const fullStorageResult = await relay.call(DEBUG_TRACE_TRANSACTION, [
          createChildTx.hash,
          topLevelWithFullStorage,
        ]);
        expect(fullStorageResult).to.exist;
        expect(fullStorageResult.structLogs).to.exist;

        // All formats should produce similar results
        expect(topLevelResult.structLogs).to.have.length.greaterThan(0);
        expect(nestedResult.structLogs).to.have.length.greaterThan(0);
        expect(fullStorageResult.structLogs).to.have.length.greaterThan(0);
      });

      it('should reject mixed format (top-level and nested config)', async function () {
        const mixedFormat = {
          enableMemory: true,
          tracerConfig: {
            disableStack: false,
          },
        };

        await relay.callFailing(
          DEBUG_TRACE_TRANSACTION,
          [createChildTx.hash, mixedFormat],
          predefined.INVALID_PARAMETER(
            1,
            "Cannot specify tracer config properties both at top level and in 'tracerConfig' for TracerConfigWrapper",
          ),
        );
      });

      it('should reject top-level config when tracer is explicitly set', async function () {
        const invalidFormat = {
          tracer: TracerType.OpcodeLogger,
          enableMemory: true, // Not allowed - tracer is explicitly set
        };

        await relay.callFailing(
          DEBUG_TRACE_TRANSACTION,
          [createChildTx.hash, invalidFormat],
          predefined.INVALID_PARAMETER(
            1,
            "Cannot specify tracer config properties at top level when 'tracer' is explicitly set for TracerConfigWrapper",
          ),
        );
      });
    });

    describe('when DEBUG_API_ENABLED is false', () => {
      let originalDebugApiEnabled: boolean;
      let transactionHash: string;
      let deploymentBlockNumber: string;

      before(async () => {
        const transaction = await Utils.buildTransaction(
          relay,
          basicContractAddress,
          accounts[0].address,
          BASIC_CONTRACT_PING_CALL_DATA,
        );
        const receipt = await Utils.getReceipt(relay, transaction, accounts[0].wallet);

        deploymentBlockNumber = receipt.blockNumber;
        transactionHash = receipt.transactionHash;
        originalDebugApiEnabled = ConfigService.get('DEBUG_API_ENABLED');
        ConfigServiceTestHelper.dynamicOverride('DEBUG_API_ENABLED', false);
      });

      after(() => {
        ConfigServiceTestHelper.dynamicOverride('DEBUG_API_ENABLED', originalDebugApiEnabled);
      });

      it('should fail debug_traceBlockByNumber with UNSUPPORTED_METHOD', async function () {
        await relay.callFailing(
          DEBUG_TRACE_BLOCK_BY_NUMBER,
          [deploymentBlockNumber, TRACER_CONFIGS.CALL_TRACER_TOP_ONLY_FALSE],
          predefined.UNSUPPORTED_METHOD,
        );
      });

      it('should fail debug_traceTransaction with UNSUPPORTED_METHOD', async function () {
        const tracerConfig = { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } };

        await relay.callFailing(
          DEBUG_TRACE_TRANSACTION,
          [transactionHash, tracerConfig],
          predefined.UNSUPPORTED_METHOD,
        );
      });
    });
  });
});
