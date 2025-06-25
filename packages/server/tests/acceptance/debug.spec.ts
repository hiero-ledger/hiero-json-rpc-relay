// SPDX-License-Identifier: Apache-2.0

// External resources
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { ConfigServiceTestHelper } from '@hashgraph/json-rpc-config-service/tests/configServiceTestHelper';
import { predefined } from '@hashgraph/json-rpc-relay';
import { RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';
import { numberTo0x } from '@hashgraph/json-rpc-relay/src/formatters';
import { TracerType } from '@hashgraph/json-rpc-relay/src/lib/constants';
import chai, { expect } from 'chai';
import chaiExclude from 'chai-exclude';
import { ethers } from 'ethers';

import RelayCall from '../../tests/helpers/constants';
import MirrorClient from '../clients/mirrorClient';
import RelayClient from '../clients/relayClient';
import ServicesClient from '../clients/servicesClient';
import basicContractJson from '../contracts/Basic.json';
import parentContractJson from '../contracts/Parent.json';
import reverterContractJson from '../contracts/Reverter.json';
import { Utils } from '../helpers/utils';
import { AliasAccount } from '../types/AliasAccount';

chai.use(chaiExclude);

describe('@debug API Acceptance Tests', function () {
  this.timeout(240 * 1000); // 240 seconds

  const accounts: AliasAccount[] = [];
  const requestDetails = new RequestDetails({ requestId: 'debug_test', ipAddress: '0.0.0.0' });

  // @ts-ignore
  const { mirrorNode, relay }: { servicesNode: ServicesClient; mirrorNode: MirrorClient; relay: RelayClient } = global;

  let requestId: string;
  let basicContract: ethers.Contract;
  let basicContractAddress: string;
  let reverterContract: ethers.Contract;
  let reverterContractAddress: string;
  let deploymentBlockNumber: number;
  let parentContract: ethers.Contract;
  let parentContractAddress: string;
  let createChildTx: ethers.ContractTransactionResponse;
  let mirrorContractDetails: any;

  const PURE_METHOD_CALL_DATA = '0xb2e0100c';
  const BASIC_CONTRACT_PING_CALL_DATA = '0x5c36b186';

  const ONE_TINYBAR = Utils.add0xPrefix(Utils.toHex(ethers.parseUnits('1', 10)));
  const CHAIN_ID = ConfigService.get('CHAIN_ID');
  const DEBUG_TRACE_BLOCK_BY_NUMBER = 'debug_traceBlockByNumber';
  const DEBUG_TRACE_TRANSACTION = 'debug_traceTransaction';

  before(async () => {
    requestId = Utils.generateRequestId();
    const initialAccount: AliasAccount = global.accounts[0];

    const initialBalance = '10000000000';
    const neededAccounts: number = 2;
    accounts.push(
      ...(await Utils.createMultipleAliasAccounts(
        mirrorNode,
        initialAccount,
        neededAccounts,
        initialBalance,
        requestDetails,
      )),
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
  });

  beforeEach(async () => {
    requestId = Utils.generateRequestId();
  });

  describe('debug_traceBlockByNumber', () => {
    it('@release should trace a block containing successful transactions using CallTracer', async function () {
      // Create a transaction that will be included in the next block
      const transaction = {
        to: basicContractAddress,
        from: accounts[0].address,
        gasLimit: numberTo0x(3_000_000),
        chainId: Number(CHAIN_ID),
        type: 2,
        maxFeePerGas: await relay.gasPrice(requestId),
        maxPriorityFeePerGas: await relay.gasPrice(requestId),
        data: BASIC_CONTRACT_PING_CALL_DATA,
        nonce: await relay.getAccountNonce(accounts[0].address, requestId),
      };

      const signedTx = await accounts[0].wallet.signTransaction(transaction);
      const transactionHash = await relay.sendRawTransaction(signedTx, requestId);

      // Wait for transaction to be processed
      const receipt = await relay.pollForValidTransactionReceipt(transactionHash);

      // Get the block number from the receipt
      const blockNumber = receipt.blockNumber;

      // Call debug_traceBlockByNumber with CallTracer
      const tracerConfig = { tracer: TracerType.CallTracer, onlyTopCall: false };
      const result = await relay.call(DEBUG_TRACE_BLOCK_BY_NUMBER, [blockNumber, tracerConfig], requestId);

      expect(result).to.be.an('array');
      expect(result.length).to.be.at.least(1);

      // Find our transaction in the result
      const txTrace = result.find((trace) => trace.txHash === transactionHash);
      expect(txTrace).to.exist;
      expect(txTrace.result).to.exist;
      expect(txTrace.result.type).to.equal('CALL');
      expect(txTrace.result.from.toLowerCase()).to.equal(accounts[0].address.toLowerCase());
      expect(txTrace.result.to.toLowerCase()).to.equal(basicContractAddress.toLowerCase());
      expect(txTrace.result.input).to.equal(BASIC_CONTRACT_PING_CALL_DATA);
    });

    it('@release should trace a block containing a failing transaction using CallTracer', async function () {
      // Create a transaction that will revert
      const transaction = {
        to: reverterContractAddress,
        from: accounts[0].address,
        gasLimit: numberTo0x(3_000_000),
        chainId: Number(CHAIN_ID),
        type: 2,
        maxFeePerGas: await relay.gasPrice(requestId),
        maxPriorityFeePerGas: await relay.gasPrice(requestId),
        data: PURE_METHOD_CALL_DATA, // This will cause a revert
        nonce: await relay.getAccountNonce(accounts[0].address, requestId),
      };

      const signedTx = await accounts[0].wallet.signTransaction(transaction);
      const transactionHash = await relay.sendRawTransaction(signedTx, requestId);

      // Wait for transaction to be processed
      const receipt = await relay.pollForValidTransactionReceipt(transactionHash);

      // Get the block number from the receipt
      const blockNumber = receipt.blockNumber;

      // Call debug_traceBlockByNumber with CallTracer
      const tracerConfig = { tracer: TracerType.CallTracer, onlyTopCall: false };
      const result = await relay.call(DEBUG_TRACE_BLOCK_BY_NUMBER, [blockNumber, tracerConfig], requestId);

      expect(result).to.be.an('array');
      expect(result.length).to.be.at.least(1);

      // Find our transaction in the result
      const txTrace = result.find((trace) => trace.txHash === transactionHash);
      expect(txTrace).to.exist;
      expect(txTrace.result).to.exist;
      expect(txTrace.result.type).to.equal('CALL');
      expect(txTrace.result.from.toLowerCase()).to.equal(accounts[0].address.toLowerCase());
      expect(txTrace.result.to.toLowerCase()).to.equal(reverterContractAddress.toLowerCase());
      expect(txTrace.result.input).to.equal(PURE_METHOD_CALL_DATA);
      expect(txTrace.result.error).to.exist; // There should be an error field for the reverted transaction
      expect(txTrace.result.revertReason).to.exist; // There should be a revert reason
    });

    it('@release should trace a block using PrestateTracer', async function () {
      // Create a transaction that will be included in the next block
      const transaction = {
        to: basicContractAddress,
        from: accounts[0].address,
        value: ONE_TINYBAR, // Adding value to see state changes
        gasLimit: numberTo0x(3_000_000),
        chainId: Number(CHAIN_ID),
        type: 2,
        maxFeePerGas: await relay.gasPrice(requestId),
        maxPriorityFeePerGas: await relay.gasPrice(requestId),
        data: BASIC_CONTRACT_PING_CALL_DATA,
        nonce: await relay.getAccountNonce(accounts[0].address, requestId),
      };

      const signedTx = await accounts[0].wallet.signTransaction(transaction);
      const transactionHash = await relay.sendRawTransaction(signedTx, requestId);

      // Wait for transaction to be processed
      const receipt = await relay.pollForValidTransactionReceipt(transactionHash);

      // Get the block number from the receipt
      const blockNumber = receipt.blockNumber;

      // Call debug_traceBlockByNumber with PrestateTracer
      const tracerConfig = { tracer: TracerType.PrestateTracer };
      const result = await relay.call(DEBUG_TRACE_BLOCK_BY_NUMBER, [blockNumber, tracerConfig], requestId);

      expect(result).to.be.an('array');
      expect(result.length).to.be.at.least(1);

      // Find our transaction in the result
      const txTrace = result.find((trace) => trace.txHash === transactionHash);
      expect(txTrace).to.exist;
      expect(txTrace.result).to.exist;

      // Check that the result contains prestate information for at least the contract and sender
      const keys = Object.keys(txTrace.result);
      expect(keys.length).to.be.at.least(2);

      // For each address in the result, check it has the expected fields
      for (const address of keys) {
        const state = txTrace.result[address];
        expect(state).to.have.property('balance');
        expect(state).to.have.property('nonce');
        expect(state).to.have.property('code');
        expect(state).to.have.property('storage');
      }
    });

    it('should trace a block using PrestateTracer with onlyTopCall=true', async function () {
      // Create a transaction that calls a contract which might make internal calls
      const transaction = {
        to: basicContractAddress,
        from: accounts[0].address,
        value: ONE_TINYBAR,
        gasLimit: numberTo0x(3_000_000),
        chainId: Number(CHAIN_ID),
        type: 2,
        maxFeePerGas: await relay.gasPrice(requestId),
        maxPriorityFeePerGas: await relay.gasPrice(requestId),
        data: BASIC_CONTRACT_PING_CALL_DATA,
        nonce: await relay.getAccountNonce(accounts[0].address, requestId),
      };

      const signedTx = await accounts[0].wallet.signTransaction(transaction);
      const transactionHash = await relay.sendRawTransaction(signedTx, requestId);

      // Wait for transaction to be processed
      const receipt = await relay.pollForValidTransactionReceipt(transactionHash);
      const blockNumber = receipt.blockNumber;

      // First trace with onlyTopCall=false (default)
      const fullTracerConfig = { tracer: TracerType.PrestateTracer, onlyTopCall: false };
      const fullResult = await relay.call(DEBUG_TRACE_BLOCK_BY_NUMBER, [blockNumber, fullTracerConfig], requestId);

      // Then trace with onlyTopCall=true
      const topCallTracerConfig = { tracer: TracerType.PrestateTracer, onlyTopCall: true };
      const topCallResult = await relay.call(
        DEBUG_TRACE_BLOCK_BY_NUMBER,
        [blockNumber, topCallTracerConfig],
        requestId,
      );

      // Both should return results
      expect(fullResult).to.be.an('array');
      expect(topCallResult).to.be.an('array');

      // Find our transaction in both results
      const fullTxTrace = fullResult.find((trace) => trace.txHash === transactionHash);
      const topCallTxTrace = topCallResult.find((trace) => trace.txHash === transactionHash);

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
        expect(state).to.have.property('balance');
        expect(state).to.have.property('nonce');
        expect(state).to.have.property('code');
        expect(state).to.have.property('storage');
      }
    });

    it('should return an empty array for a block with no transactions', async function () {
      // Find a block with no transactions
      let currentBlockNumber = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_BLOCK_NUMBER, [], requestId);

      // Convert from hex
      currentBlockNumber = parseInt(currentBlockNumber, 16);

      // Go back several blocks to find one without transactions
      let blockNumberToTest = Math.max(1, currentBlockNumber - 10);
      let block;
      let hasTransactions = true;

      while (hasTransactions && blockNumberToTest < currentBlockNumber) {
        block = await relay.call(
          RelayCall.ETH_ENDPOINTS.ETH_GET_BLOCK_BY_NUMBER,
          [numberTo0x(blockNumberToTest), false],
          requestId,
        );

        hasTransactions = block.transactions.length > 0;

        if (hasTransactions) {
          blockNumberToTest++;
        }
      }

      if (!hasTransactions) {
        // Found a block without transactions
        const tracerConfig = { tracer: TracerType.CallTracer, onlyTopCall: false };
        const result = await relay.call(
          DEBUG_TRACE_BLOCK_BY_NUMBER,
          [numberTo0x(blockNumberToTest), tracerConfig],
          requestId,
        );

        expect(result).to.be.an('array');
        expect(result.length).to.equal(0);
      } else {
        // Skip this test if we can't find a block without transactions
        this.skip();
      }
    });

    it('should fail with UNSUPPORTED_METHOD error when DEBUG_API_ENABLED is false', async function () {
      // Store original value
      const originalDebugApiEnabled = ConfigService.get('DEBUG_API_ENABLED');

      // Set DEBUG_API_ENABLED to false
      ConfigServiceTestHelper.dynamicOverride('DEBUG_API_ENABLED', false);

      try {
        const tracerConfig = { tracer: TracerType.CallTracer, onlyTopCall: false };

        // Should return UNSUPPORTED_METHOD error
        await relay.callFailing(
          DEBUG_TRACE_BLOCK_BY_NUMBER,
          [numberTo0x(deploymentBlockNumber), tracerConfig],
          predefined.UNSUPPORTED_METHOD,
          requestId,
        );
      } finally {
        // Restore original value
        ConfigServiceTestHelper.dynamicOverride('DEBUG_API_ENABLED', originalDebugApiEnabled);
      }
    });

    it('should fail with INVALID_PARAMETER when given an invalid block number', async function () {
      const tracerConfig = { tracer: TracerType.CallTracer, onlyTopCall: false };

      // Invalid block number format
      await relay.callFailing(
        DEBUG_TRACE_BLOCK_BY_NUMBER,
        ['invalidBlockNumber', tracerConfig],
        predefined.INVALID_PARAMETER(
          '0',
          'Expected 0x prefixed hexadecimal block number, or the string "latest", "earliest" or "pending"',
        ),
        requestId,
      );
    });

    it('should fail with INVALID_PARAMETER when given an invalid tracer configuration', async function () {
      const invalidTracerConfig = { tracer: 'InvalidTracer', onlyTopCall: false };
      await relay.callFailing(
        DEBUG_TRACE_BLOCK_BY_NUMBER,
        [numberTo0x(deploymentBlockNumber), invalidTracerConfig],
        predefined.INVALID_PARAMETER("'tracer' for TracerConfigWrapper", 'Expected TracerType, value: InvalidTracer'),
        requestId,
      );
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

      const receipt = await relay.pollForValidTransactionReceipt(createChildTx.hash);
      console.log(createChildTx.hash);
      console.log('receipt', receipt);
      // Get contract result details from mirror node
      mirrorContractDetails = await mirrorNode.get(`/contracts/results/${createChildTx.hash}`, requestId);
      mirrorContractDetails.from = accounts[0].address;
    });

    describe('Call Tracer', () => {
      it('should trace a transaction using CallTracer with onlyTopCall=false', async function () {
        // Call debug_traceTransaction with CallTracer (default config)
        const tracerConfig = { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: false } };
        const result = await relay.call(DEBUG_TRACE_TRANSACTION, [createChildTx.hash, tracerConfig], requestId);

        console.log('result', result);
        expect(result).to.be.an('object');
        expect(result).to.have.property('type', 'CALL');
        expect(result).to.have.property('from');
        expect(result.from.toLowerCase()).to.equal(accounts[0].address.toLowerCase());
        expect(result).to.have.property('to');
        expect(result.to.toLowerCase()).to.equal(parentContractAddress.toLowerCase());
        expect(result).to.have.property('value');
        expect(result).to.have.property('gas');
        expect(result).to.have.property('gasUsed');
        expect(result).to.have.property('input', PARENT_CONTRACT_CREATE_CHILD_CALL_DATA);
        expect(result).to.have.property('output');
        expect(result).to.have.property('calls');
      });

      it('should trace a transaction using CallTracer with onlyTopCall=true', async function () {
        // Call debug_traceTransaction with CallTracer (default config)
        const tracerConfig = { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: true } };
        const result = await relay.call(DEBUG_TRACE_TRANSACTION, [createChildTx.hash, tracerConfig], requestId);

        console.log('result 2', result);
        expect(result).to.be.an('object');
        expect(result).to.have.property('type', 'CALL');
        expect(result).to.have.property('from');
        expect(result.from.toLowerCase()).to.equal(accounts[0].address.toLowerCase());
        expect(result).to.have.property('to');
        expect(result.to.toLowerCase()).to.equal(parentContractAddress.toLowerCase());
        expect(result).to.have.property('value');
        expect(result).to.have.property('gas');
        expect(result).to.have.property('gasUsed');
        expect(result).to.have.property('input', PARENT_CONTRACT_CREATE_CHILD_CALL_DATA);
        expect(result).to.have.property('output');
        expect(result).to.not.have.property('calls');
      });
    });

    describe('OpcodeLogger', () => {
      it('@release should trace a successful transaction using OpcodeLogger (default when no tracer specified)', async function () {
        const result = await relay.call(DEBUG_TRACE_TRANSACTION, [createChildTx.hash], requestId);

        // Validate response structure for OpcodeLogger
        expect(result).to.be.an('object');
        expect(result).to.have.property('gas');
        expect(result).to.have.property('failed');
        expect(result).to.have.property('returnValue');
        expect(result).to.have.property('structLogs');
        expect(result.structLogs).to.be.an('array');

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

      it('@release should trace a successful transaction using OpcodeLogger explicitly', async function () {
        const tracerConfig = { tracer: TracerType.OpcodeLogger };
        const result = await relay.call(DEBUG_TRACE_TRANSACTION, [createChildTx.hash, tracerConfig], requestId);

        expect(result).to.be.an('object');
        expect(result).to.have.property('gas');
        expect(result).to.have.property('failed');
        expect(result).to.have.property('returnValue');
        expect(result).to.have.property('structLogs');
        expect(result.structLogs).to.be.an('array');
      });

      it('@release should trace using OpcodeLogger with custom config (enableMemory=true)', async function () {
        const tracerConfig = {
          tracer: TracerType.OpcodeLogger,
          tracerConfig: { enableMemory: true },
        };
        const result = await relay.call(DEBUG_TRACE_TRANSACTION, [createChildTx.hash, tracerConfig], requestId);

        expect(result).to.be.an('object');
        expect(result).to.have.property('structLogs');

        // With enableMemory=true, memory field should be present in struct logs
        if (result.structLogs.length > 0) {
          const logsWithMemory = result.structLogs.filter((log) => log.memory);
          expect(logsWithMemory.length).to.be.greaterThan(0);
        }
      });

      it('@release should trace using OpcodeLogger with custom config (disableStack=true)', async function () {
        const tracerConfig = {
          tracer: TracerType.OpcodeLogger,
          tracerConfig: { disableStack: true },
        };
        const result = await relay.call(DEBUG_TRACE_TRANSACTION, [createChildTx.hash, tracerConfig], requestId);

        expect(result).to.be.an('object');
        expect(result).to.have.property('structLogs');

        // With disableStack=true, stack field should not be present in struct logs
        if (result.structLogs.length > 0) {
          const logsWithStack = result.structLogs.filter((log) => log.stack);
          expect(logsWithStack.length).to.equal(0);
        }
      });

      it('@release should trace using OpcodeLogger with custom config (disableStorage=true)', async function () {
        const tracerConfig = {
          tracer: TracerType.OpcodeLogger,
          tracerConfig: { disableStorage: true },
        };
        const result = await relay.call(DEBUG_TRACE_TRANSACTION, [createChildTx.hash, tracerConfig], requestId);

        expect(result).to.be.an('object');
        expect(result).to.have.property('structLogs');

        // With disableStorage=true, storage field should not be present in struct logs
        if (result.structLogs.length > 0) {
          const logsWithStorage = result.structLogs.filter((log) => log.storage);
          expect(logsWithStorage.length).to.equal(0);
        }
      });

      it('@release should trace using OpcodeLogger with custom config (enableMemory=true, disableStorage=true)', async function () {
        const tracerConfig = {
          tracer: TracerType.OpcodeLogger,
          tracerConfig: { enableMemory: true, disableStorage: true },
        };
        const result = await relay.call(DEBUG_TRACE_TRANSACTION, [createChildTx.hash, tracerConfig], requestId);

        expect(result).to.be.an('object');
        expect(result).to.have.property('structLogs');
      });
    });

    describe('Edge Cases - Parameter Validation', () => {
      it('should fail with MISSING_REQUIRED_PARAMETER when transaction hash is missing', async function () {
        await relay.callFailing(DEBUG_TRACE_TRANSACTION, [], predefined.MISSING_REQUIRED_PARAMETER(0), requestId);
      });

      it('should fail with INVALID_PARAMETER when given an invalid transaction hash format', async function () {
        const invalidHash = '0xinvalidhash';
        await relay.callFailing(
          DEBUG_TRACE_TRANSACTION,
          [invalidHash],
          predefined.INVALID_PARAMETER(
            0,
            'The value passed is not valid: 0xinvalidhash. Expected Expected 0x prefixed string representing the hash (32 bytes) of a transaction OR Expected a transaction ID string in the format "shard.realm.num-sss-nnn" where sss are seconds and nnn are nanoseconds',
          ),
          requestId,
        );
      });

      it('should fail with RESOURCE_NOT_FOUND for non-existent transaction hash and no tracer', async function () {
        const nonExistentHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
        await relay.callFailing(
          DEBUG_TRACE_TRANSACTION,
          [nonExistentHash],
          predefined.RESOURCE_NOT_FOUND(`Failed to retrieve contract results for transaction ${nonExistentHash}`),
          requestId,
        );
      });

      it('should fail with RESOURCE_NOT_FOUND for non-existent transaction hash with tracer', async function () {
        const nonExistentHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdee';
        const tracer = {
          tracer: TracerType.CallTracer,
          tracerConfig: { onlyTopCall: true },
        };
        await relay.callFailing(
          DEBUG_TRACE_TRANSACTION,
          [nonExistentHash, tracer],
          predefined.RESOURCE_NOT_FOUND(`Failed to retrieve contract results for transaction ${nonExistentHash}`),
          requestId,
        );
      });

      it('should fail with INVALID_PARAMETER when using PrestateTracer', async function () {
        const tracerConfig = { tracer: TracerType.PrestateTracer };
        await relay.callFailing(
          DEBUG_TRACE_TRANSACTION,
          [createChildTx.hash, tracerConfig],
          predefined.INVALID_PARAMETER(1, 'Prestate tracer is not yet supported on debug_traceTransaction'),
          requestId,
        );
      });

      it('should fail with INVALID_PARAMETER when given an invalid tracer type', async function () {
        const invalidTracerConfig = { tracer: 'InvalidTracer' };
        await relay.callFailing(
          DEBUG_TRACE_TRANSACTION,
          [createChildTx.hash, invalidTracerConfig],
          predefined.INVALID_PARAMETER("'tracer' for TracerConfigWrapper", 'Expected TracerType, value: InvalidTracer'),
          requestId,
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
          requestId,
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
          requestId,
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
            "callTracer 'tracerConfig' for TracerConfigWrapper is only valid when tracer=callTracer",
          ),
          requestId,
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
            "opcodeLogger 'tracerConfig' for TracerConfigWrapper is only valid when tracer=opcodeLogger",
          ),
          requestId,
        );
      });

      it('should fail with UNSUPPORTED_METHOD error when DEBUG_API_ENABLED is false', async function () {
        // Store original value
        const originalDebugApiEnabled = ConfigService.get('DEBUG_API_ENABLED');

        // Set DEBUG_API_ENABLED to false
        ConfigServiceTestHelper.dynamicOverride('DEBUG_API_ENABLED', false);

        try {
          const tracerConfig = { tracer: TracerType.CallTracer };

          // Should return UNSUPPORTED_METHOD error
          await relay.callFailing(
            DEBUG_TRACE_TRANSACTION,
            [createChildTx.hash, tracerConfig],
            predefined.UNSUPPORTED_METHOD,
            requestId,
          );
        } finally {
          // Restore original value
          ConfigServiceTestHelper.dynamicOverride('DEBUG_API_ENABLED', originalDebugApiEnabled);
        }
      });
    });
  });
});
