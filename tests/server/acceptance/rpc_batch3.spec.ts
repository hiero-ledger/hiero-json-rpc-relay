// SPDX-License-Identifier: Apache-2.0

// External resources
import Axios from 'axios';
import { expect, use } from 'chai';
import chaiExclude from 'chai-exclude';
import { type BaseContract, ethers } from 'ethers';

import openRpcData from '../../../docs/openrpc.json';
import { ConfigService } from '../../../src/config-service/services';
import { type JsonRpcError, predefined } from '../../../src/relay';
import { numberTo0x } from '../../../src/relay/formatters';
import { TracerType } from '../../../src/relay/lib/constants';
// Helper functions/constants from local resources
import { Constants as ValidatorConstants, TYPES } from '../../../src/relay/lib/validators';
import RelayAssertions from '../../relay/assertions';
import { overrideEnvsInMochaDescribe } from '../../relay/helpers';
import type MirrorClient from '../clients/mirrorClient';
import type RelayClient from '../clients/relayClient';
import type ServicesClient from '../clients/servicesClient';
import DeployerContractJson from '../contracts/Deployer.json';
import ERC20MockJson from '../contracts/ERC20Mock.json';
import EstimateGasContract from '../contracts/EstimateGasContract.json';
import HederaTokenServiceImplJson from '../contracts/HederaTokenServiceImpl.json';
import LogsContractJson from '../contracts/Logs.json';
// Contracts and JSON files from local resources
import reverterContractJson from '../contracts/Reverter.json';
import StorageContractJson from '../contracts/Storage.json';
// Assertions and constants from local resources
import Assertions, { requestIdRegex } from '../helpers/assertions';
import RelayCall from '../helpers/constants';
import Helper from '../helpers/constants';
import RelayCalls from '../helpers/constants';
import { Utils } from '../helpers/utils';
import { type AliasAccount } from '../types/AliasAccount';

use(chaiExclude);

describe('@api-batch-3 RPC Server Acceptance Tests', function () {
  this.timeout(240 * 1000); // 240 seconds

  const accounts: AliasAccount[] = [];

  // @ts-ignore
  const {
    servicesNode,
    mirrorNode,
    relay,
  }: { servicesNode: ServicesClient; mirrorNode: MirrorClient; relay: RelayClient } = global;

  const CHAIN_ID = ConfigService.get('CHAIN_ID');
  const ONE_TINYBAR = Utils.add0xPrefix(Utils.toHex(ethers.parseUnits('1', 10)));

  let reverterContract: ethers.Contract;
  let reverterEvmAddress: string;
  const PAYABLE_METHOD_CALL_DATA = '0xd0efd7ef';
  const PAYABLE_METHOD_ERROR_DATA =
    '0x08c379a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000013526576657274526561736f6e50617961626c6500000000000000000000000000';
  const RESULT_TRUE = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const TOPICS = [
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    '0x0000000000000000000000000000000000000000000000000000000000000000',
    '0x000000000000000000000000000000000000000000000000000000000000042d',
  ];
  before(async () => {
    const initialAccount: AliasAccount = global.accounts[0];

    const initialBalance = '10000000000';
    const neededAccounts: number = 4;
    accounts.push(
      ...(await Utils.createMultipleAliasAccounts(mirrorNode, initialAccount, neededAccounts, initialBalance)),
    );
    global.accounts.push(...accounts);

    reverterContract = await Utils.deployContract(
      reverterContractJson.abi,
      reverterContractJson.bytecode,
      accounts[0].wallet,
    );

    reverterEvmAddress = reverterContract.target as string;
  });

  describe('Contract call reverts', async () => {
    it('Returns revert reason in receipt for payable methods', async () => {
      const transaction = {
        value: ONE_TINYBAR,
        gasLimit: numberTo0x(30000),
        chainId: Number(CHAIN_ID),
        to: reverterEvmAddress,
        nonce: await relay.getAccountNonce(accounts[0].address),
        maxFeePerGas: await relay.gasPrice(),
        data: PAYABLE_METHOD_CALL_DATA,
      };
      const signedTx = await accounts[0].wallet.signTransaction(transaction);
      const transactionHash = await relay.sendRawTransaction(signedTx);

      // Wait until receipt is available in mirror node
      await mirrorNode.get(`/contracts/results/${transactionHash}`);

      const receipt = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT, [transactionHash]);
      expect(receipt?.revertReason).to.exist;
      expect(receipt.revertReason).to.eq(PAYABLE_METHOD_ERROR_DATA);
    });
  });

  describe('eth_call with contract that calls precompiles', async () => {
    const TOKEN_NAME = Utils.randomString(10);
    const TOKEN_SYMBOL = Utils.randomString(5);
    const INITIAL_SUPPLY = 100000;
    const IS_TOKEN_ADDRESS_SIGNATURE = '0xbff9834f000000000000000000000000';

    let htsImpl: BaseContract;
    let tokenAddress: string;

    before(async () => {
      const htsResult = await servicesNode.createHTS({
        tokenName: TOKEN_NAME,
        symbol: TOKEN_SYMBOL,
        treasuryAccountId: accounts[1].accountId.toString(),
        initialSupply: INITIAL_SUPPLY,
        adminPrivateKey: accounts[1].privateKey,
      });

      tokenAddress = Utils.idToEvmAddress(htsResult.receipt.tokenId!.toString());

      const HederaTokenServiceImplFactory = new ethers.ContractFactory(
        HederaTokenServiceImplJson.abi,
        HederaTokenServiceImplJson.bytecode,
        accounts[1].wallet,
      );
      htsImpl = await HederaTokenServiceImplFactory.deploy(Helper.GAS.LIMIT_15_000_000);
    });

    it('Function calling HederaTokenService.isToken(token)', async () => {
      const callData = {
        from: accounts[1].address,
        to: htsImpl.target,
        gas: numberTo0x(30000),
        data: IS_TOKEN_ADDRESS_SIGNATURE + tokenAddress.replace('0x', ''),
      };

      const res = await Utils.ethCallWRetries(relay, callData, 'latest');
      expect(res).to.eq(RESULT_TRUE);
    });
  });

  describe('State overrides', async function () {
    const SLOT = (n: number): string => `0x${n.toString(16).padStart(64, '0')}`;
    const VALUE = (n: number): string => `0x${n.toString(16).padStart(64, '0')}`;
    const COUNTER_SELECTOR = '0x61bc221a'; // counter(), storage slot 0, deployed as 1
    const SALT_SELECTOR = '0xbfa0b133'; // salt(), storage slot 1, deployed as 1
    const ABSENT_LONG_ZERO = RelayCall.NON_EXISTING_LONG_ZERO_ADDRESS;
    const ABSENT_ALIASED = RelayCall.NON_EXISTING_ADDRESS;
    const HTS_PRECOMPILE = '0x0000000000000000000000000000000000000167';
    const RETURNS_42 = '0x602a60005260206000f3'; // PUSH1 2a PUSH1 00 MSTORE PUSH1 20 PUSH1 00 RETURN
    const balanceReader = (address: string): string => `0x73${address.replace('0x', '')}3160005260206000f3`;

    let deployerAddress: string;
    let stateOverridesUnavailable = false;

    const ethCall = (params: unknown[]): Promise<string> => relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, params);

    before(async function () {
      const deployer = await Utils.deployContract(
        DeployerContractJson.abi,
        DeployerContractJson.bytecode,
        accounts[0].wallet,
      );
      deployerAddress = deployer.target as string;

      // State overrides only work when the mirror node has enableStateOverrides on, so probe and skip when it is off.
      const [probe] = await relay.callBatch([
        {
          id: 1,
          method: RelayCall.ETH_ENDPOINTS.ETH_CALL,
          params: [
            { to: deployerAddress, data: COUNTER_SELECTOR },
            'latest',
            { [deployerAddress]: { stateDiff: { [SLOT(0)]: VALUE(0x63) } } },
          ],
        },
      ]);

      if (probe?.error) {
        const message: string = probe.error.message;
        if (message.includes('State overrides are not supported') || message.includes('Internal Server Error')) {
          stateOverridesUnavailable = true;
        } else {
          throw new Error(`Unexpected error while probing state override support: ${message}`);
        }
      }
    });

    beforeEach(function () {
      if (stateOverridesUnavailable) {
        this.skip();
      }
    });

    it('applies a stateDiff override to the slot it names', async function () {
      const result = await ethCall([
        { to: deployerAddress, data: COUNTER_SELECTOR },
        'latest',
        { [deployerAddress]: { stateDiff: { [SLOT(0)]: VALUE(0x63) } } },
      ]);

      expect(result).to.equal(VALUE(0x63));
    });

    it('leaves slots a stateDiff does not name at their on-chain value', async function () {
      const result = await ethCall([
        { to: deployerAddress, data: COUNTER_SELECTOR },
        'latest',
        { [deployerAddress]: { stateDiff: { [SLOT(1)]: VALUE(0x63) } } },
      ]);

      expect(result).to.equal(VALUE(1));
    });

    it('reads zero from slots a state override does not name, replacing all storage', async function () {
      const result = await ethCall([
        { to: deployerAddress, data: COUNTER_SELECTOR },
        'latest',
        { [deployerAddress]: { state: { [SLOT(1)]: VALUE(0x63) } } },
      ]);

      expect(result).to.equal(VALUE(0));
    });

    it('applies a state override to the slot it names', async function () {
      const result = await ethCall([
        { to: deployerAddress, data: SALT_SELECTOR },
        'latest',
        { [deployerAddress]: { state: { [SLOT(1)]: VALUE(0x63) } } },
      ]);

      expect(result).to.equal(VALUE(0x63));
    });

    it('replaces the contract code for the duration of the call', async function () {
      const result = await ethCall([
        { to: deployerAddress, data: COUNTER_SELECTOR },
        'latest',
        // PUSH1 2a PUSH1 00 MSTORE PUSH1 20 PUSH1 00 RETURN -> always returns 42
        { [deployerAddress]: { code: '0x602a60005260206000f3' } },
      ]);

      expect(result).to.equal(VALUE(0x2a));
    });

    it('does not persist any override to chain state', async function () {
      await ethCall([
        { to: deployerAddress, data: COUNTER_SELECTOR },
        'latest',
        { [deployerAddress]: { stateDiff: { [SLOT(0)]: VALUE(0x63) } } },
      ]);

      const afterwards = await ethCall([{ to: deployerAddress, data: COUNTER_SELECTOR }, 'latest']);
      expect(afterwards).to.equal(VALUE(1));

      const storage = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_GET_STORAGE_AT, [
        deployerAddress,
        SLOT(0),
        'latest',
      ]);
      expect(storage).to.equal(VALUE(1));
    });

    it('applies a balance override where the contract reads it', async function () {
      const result = await ethCall([
        { to: deployerAddress },
        'latest',
        {
          [deployerAddress]: { code: balanceReader(ABSENT_LONG_ZERO) },
          [ABSENT_LONG_ZERO]: { balance: '0xde0b6b3a7640000' },
        },
      ]);

      expect(result).to.equal(VALUE(100_000_000));
    });

    it('applies a balance override to a long-zero account that does not exist on chain', async function () {
      const withoutOverride = await ethCall([
        { to: deployerAddress },
        'latest',
        { [deployerAddress]: { code: balanceReader(ABSENT_LONG_ZERO) } },
      ]);
      expect(withoutOverride).to.equal(VALUE(0));

      const withOverride = await ethCall([
        { to: deployerAddress },
        'latest',
        {
          [deployerAddress]: { code: balanceReader(ABSENT_LONG_ZERO) },
          [ABSENT_LONG_ZERO]: { balance: '0xde0b6b3a7640000' },
        },
      ]);
      expect(withOverride).to.equal(VALUE(100_000_000));
    });

    it('ignores a balance override on an aliased address with no account behind it', async function () {
      // Only long-zero addresses resolve to a Hedera entity, so an override on an aliased address
      // that was never created is dropped without any error.
      const result = await ethCall([
        { to: deployerAddress },
        'latest',
        {
          [deployerAddress]: { code: balanceReader(ABSENT_ALIASED) },
          [ABSENT_ALIASED]: { balance: '0xde0b6b3a7640000' },
        },
      ]);

      expect(result).to.equal(VALUE(0));
    });

    it('makes an overridden balance spendable, not merely readable', async function () {
      const transfer = { from: ABSENT_LONG_ZERO, to: deployerAddress, value: '0xde0b6b3a7640000' };

      let rejectedWithoutOverride = false;
      try {
        await ethCall([transfer, 'latest']);
      } catch {
        rejectedWithoutOverride = true;
      }
      expect(rejectedWithoutOverride).to.be.true;

      const result = await ethCall([transfer, 'latest', { [ABSENT_LONG_ZERO]: { balance: '0x152d02c7e14af6800000' } }]);
      expect(result).to.equal('0x');
    });

    it('clears the contract code when code is 0x', async function () {
      const result = await ethCall([
        { to: deployerAddress, data: COUNTER_SELECTOR },
        'latest',
        { [deployerAddress]: { code: '0x' } },
      ]);

      expect(result).to.equal('0x');
    });

    it('allows state on one address and stateDiff on another in the same request', async function () {
      const result = await ethCall([
        { to: deployerAddress, data: COUNTER_SELECTOR },
        'latest',
        {
          [deployerAddress]: { state: { [SLOT(0)]: VALUE(0x63) } },
          [ABSENT_LONG_ZERO]: { stateDiff: { [SLOT(0)]: VALUE(0x63) } },
        },
      ]);

      expect(result).to.equal(VALUE(0x63));
    });

    it('wipes storage when state is an empty map', async function () {
      const result = await ethCall([
        { to: deployerAddress, data: COUNTER_SELECTOR },
        'latest',
        { [deployerAddress]: { state: {} } },
      ]);

      expect(result).to.equal(VALUE(0));
    });

    it('changes nothing when stateDiff is an empty map', async function () {
      const result = await ethCall([
        { to: deployerAddress, data: COUNTER_SELECTOR },
        'latest',
        { [deployerAddress]: { stateDiff: {} } },
      ]);

      expect(result).to.equal(VALUE(1));
    });

    it('applies overrides at a historical block', async function () {
      const block = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_BLOCK_NUMBER, []);

      const overridden = await ethCall([
        { to: deployerAddress, data: COUNTER_SELECTOR },
        block,
        { [deployerAddress]: { stateDiff: { [SLOT(0)]: VALUE(0x63) } } },
      ]);
      expect(overridden).to.equal(VALUE(0x63));

      const plain = await ethCall([{ to: deployerAddress, data: COUNTER_SELECTOR }, block]);
      expect(plain).to.equal(VALUE(1));
    });

    it('accepts an override on a system address without applying it', async function () {
      const call = { to: HTS_PRECOMPILE, data: '0x' };
      const responses = await relay.callBatch([
        { id: 1, method: RelayCall.ETH_ENDPOINTS.ETH_CALL, params: [call, 'latest'] },
        {
          id: 2,
          method: RelayCall.ETH_ENDPOINTS.ETH_CALL,
          params: [call, 'latest', { [HTS_PRECOMPILE]: { code: RETURNS_42 } }],
        },
      ]);
      const plain = responses.find((entry: { id: number }) => entry.id === 1);
      const overridden = responses.find((entry: { id: number }) => entry.id === 2);

      expect(overridden.result).to.not.equal(VALUE(0x2a));
      expect(overridden.result).to.equal(plain.result);
      expect(overridden.error?.code).to.equal(plain.error?.code);
    });

    it('applies overrides to eth_estimateGas as well', async function () {
      const estimate = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [
        { to: deployerAddress, data: COUNTER_SELECTOR },
        'latest',
        { [deployerAddress]: { stateDiff: { [SLOT(0)]: VALUE(0x63) } } },
      ]);

      expect(Number(estimate)).to.be.greaterThan(0);
    });
  });

  describe('Filter API Test Suite', () => {
    const nonExstingFilter = '0x111222331';

    describe('Positive', async function () {
      it('@release should be able to create a log filter', async function () {
        const currentBlock = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_BLOCK_NUMBER, []);
        expect(
          RelayAssertions.validateUint(
            await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_NEW_FILTER, [
              {
                fromBlock: currentBlock,
                toBlock: 'latest',
              },
            ]),
          ),
        ).to.eq(true, 'from current block to latest');

        expect(
          RelayAssertions.validateUint(
            await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_NEW_FILTER, [
              {
                fromBlock: currentBlock,
                toBlock: 'latest',
                address: reverterEvmAddress,
              },
            ]),
          ),
        ).to.eq(true, 'from current block to latest and specified address');

        expect(
          RelayAssertions.validateUint(
            await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_NEW_FILTER, [
              {
                fromBlock: currentBlock,
                toBlock: 'latest',
                address: reverterEvmAddress,
                topics: TOPICS,
              },
            ]),
          ),
        ).to.eq(true, 'with all params');
      });

      it('@release should be able to create a newBlock filter', async function () {
        expect(RelayAssertions.validateUint(await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_NEW_BLOCK_FILTER, []))).to.eq(
          true,
        );
      });

      it('creates a new filter and retrieves logs using eth_getLogs with the same filter', async function () {
        const filter = { fromBlock: 'latest', toBlock: 'latest' };
        const createUintFilterIdWithLessThan16Bytes = async (): Promise<bigint | null> => {
          for (let attempt = 0; attempt < 200; attempt++) {
            // Each attempt has 10% of success rate.
            const filterId = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_NEW_FILTER, [filter]);
            if (filterId.length < 34) return BigInt(filterId); // 34 chars = 16 bytes + '0x' prefix
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
          return null; // Should be extremely unlikely to reach this point (but it's still possible).
        };
        const filterId = await createUintFilterIdWithLessThan16Bytes();
        expect(filterId).to.not.be.null;

        const hexFilterId = numberTo0x(filterId!);
        const numberResult = await relay.call('eth_getFilterLogs', [hexFilterId]);
        expect(numberResult).to.be.an('array');

        const zeroPrefixedFilterId = hexFilterId.replace('0x', '0x0');
        const bytesResult = await relay.call('eth_getFilterLogs', [zeroPrefixedFilterId]);
        expect(bytesResult).to.be.an('array');
      });

      it('should be able to uninstall existing log filter', async function () {
        const currentBlock = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_BLOCK_NUMBER, []);
        const filterId = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_NEW_FILTER, [
          {
            fromBlock: currentBlock,
            toBlock: 'latest',
          },
        ]);
        const result = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_UNINSTALL_FILTER, [filterId]);
        expect(result).to.eq(true);
      });

      it('should be able to uninstall existing newBlock filter', async function () {
        const filterId = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_NEW_BLOCK_FILTER, []);
        const result = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_UNINSTALL_FILTER, [filterId]);
        expect(result).to.eq(true);
      });

      it('@release should be able to call eth_getFilterChanges for NEW_BLOCK filter', async function () {
        const filterId = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_NEW_BLOCK_FILTER, []);

        await new Promise((r) => setTimeout(r, 4000));
        const result = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_FILTER_CHANGES, [filterId]);
        expect(result).to.exist;
        expect(result.length).to.gt(0, 'returns the latest block hashes');

        result.forEach((hash: string) => {
          expect(RelayAssertions.validateHash(hash, 64)).to.eq(true);
        });

        await new Promise((r) => setTimeout(r, 2000));
        const result2 = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_FILTER_CHANGES, [filterId]);
        expect(result2).to.exist;
        expect(result2.length).to.be.greaterThanOrEqual(1);
        expect(RelayAssertions.validateHash(result2[0], 64)).to.eq(true);
      });
    });

    describe('Negative', async function () {
      it('should not be able to uninstall not existing filter', async function () {
        const result = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_UNINSTALL_FILTER, [nonExstingFilter]);
        expect(result).to.eq(false);
      });

      it('should not be able to call eth_getFilterChanges for not existing filter', async function () {
        await relay.callFailing(
          RelayCall.ETH_ENDPOINTS.ETH_GET_FILTER_CHANGES,
          [nonExstingFilter],
          predefined.FILTER_NOT_FOUND,
        );
      });

      it('should not support "eth_newPendingTransactionFilter"', async function () {
        await relay.callUnsupported(RelayCalls.ETH_ENDPOINTS.ETH_NEW_PENDING_TRANSACTION_FILTER, []);
      });
    });
  });

  describe('Debug API Test Suite', async function () {
    type ILegacyTransaction = {
      to: null;
      from: string;
      gasPrice: number;
      chainId: number;
      gasLimit: string;
      type: number;
    };

    let requestId: string;
    let estimateGasContractAddress: { address: string };
    let transactionTypeLegacy: ILegacyTransaction;
    let transactionType2930: ILegacyTransaction & { accessList: never[] };
    let reverterContract: ethers.Contract;
    let reverterContractAddress: string;
    let transactionType2: ILegacyTransaction & { maxFeePerGas: number; maxPriorityFeePerGas: number };
    const defaultGasLimit = numberTo0x(3_000_000);
    const bytecode = EstimateGasContract.bytecode;
    const tracerConfigTrue = { onlyTopCall: true };
    const tracerConfigFalse = { onlyTopCall: false };
    const tracerConfigInvalid = { onlyTopCall: 'invalid' };
    const callTracer: TracerType = TracerType.CallTracer;

    before(async () => {
      const defaultGasPrice = await relay.gasPrice();
      requestId = Utils.generateRequestId();
      reverterContract = await Utils.deployContract(
        reverterContractJson.abi,
        reverterContractJson.bytecode,
        accounts[0].wallet,
      );
      reverterContractAddress = reverterContract.target as string;

      const defaultTransactionFields = {
        to: null,
        from: accounts[0].address,
        gasPrice: defaultGasPrice,
        chainId: Number(CHAIN_ID),
        gasLimit: defaultGasLimit,
      };

      transactionTypeLegacy = {
        ...defaultTransactionFields,
        type: 0,
      };

      transactionType2930 = {
        ...defaultTransactionFields,
        accessList: [],
        type: 1,
      };

      transactionType2 = {
        ...defaultTransactionFields,
        type: 2,
        maxFeePerGas: defaultGasPrice,
        maxPriorityFeePerGas: defaultGasPrice,
      };

      //deploy estimate gas contract
      const transaction = {
        ...transactionTypeLegacy,
        data: bytecode,
        nonce: await relay.getAccountNonce(accounts[0].address),
      };

      const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
      const transactionHash = await relay.sendRawTransaction(signedTransaction);
      await relay.pollForValidTransactionReceipt(transactionHash);
      estimateGasContractAddress = await mirrorNode.get(`/contracts/results/${transactionHash}`);
    });

    describe('Positive scenarios', async function () {
      const defaultResponseFields = {
        type: 'CREATE',
        from: '0x0000000000000000000000000000000000000948',
        to: '0x000000000000000000000000000000000000094f',
        value: '0x0',
        gas: '0x2dc6c0',
        gasUsed: '0x249f00',
        input: '',
        output: '',
        calls: [],
      };
      const successResultCreateWithDepth = {
        ...defaultResponseFields,
        calls: [
          {
            type: 'CREATE',
            from: '0xb3b6559bb61da201659b0c6be96ad6826ca0ad80',
            to: '0x40d5306d1a607292ceec43965ef053224db76129',
            gas: '0x2b7339',
            gasUsed: '0x4b',
            input: '0x',
            output: '0x',
            value: '0x0',
          },
        ],
      };
      const successResultCall = {
        ...defaultResponseFields,
        type: 'CALL',
        calls: [],
      };
      const successResultCallWithDepth = {
        ...successResultCall,
        calls: [
          {
            type: 'STATICCALL',
            from: '0xd2a8204468e18bb242e6dcbf1700b09e95400b3b',
            to: '0x5c33384ca47ccc712231c3ea271d334eeafc36a3',
            gas: '0xc350',
            gasUsed: '0x94',
            input: '0x38cc4831',
            output: '0x0000000000000000000000005c33384ca47ccc712231c3ea271d334eeafc36a3',
            value: '0x0',
          },
        ],
      };
      const failingResultCreate = {
        ...defaultResponseFields,
        error: 'CONTRACT_EXECUTION_EXCEPTION',
        revertReason: 'INSUFFICIENT_STACK_ITEMS',
        gasUsed: '0x2dc6c0',
        calls: [],
      };
      const failingResultCall = {
        ...defaultResponseFields,
        type: 'CALL',
        error: 'CONTRACT_REVERT_EXECUTED',
        revertReason: 'Some revert message',
        calls: [],
      };

      describe('Test transactions of type 0', async function () {
        //onlyTopCall:false
        it('should be able to debug a successful CREATE transaction of type Legacy with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionTypeLegacy,
            chainId: Number(CHAIN_ID),
            data: bytecode,
            nonce: await relay.getAccountNonce(accounts[0].address),
            gasPrice: await relay.gasPrice(),
          };
          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigFalse },
          ]);

          successResultCreateWithDepth.from = accounts[0].address;

          Assertions.validateResultDebugValues(
            resultDebug,
            ['to', 'output', 'input', 'calls', 'gas', 'gasUsed'],
            ['from', 'to', 'input', 'output', 'gas', 'gasUsed'],
            successResultCreateWithDepth,
          );
          expect(resultDebug.calls).to.have.lengthOf(1);
        });

        it('should be able to debug a successful CALL transaction of type Legacy with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionTypeLegacy,
            from: accounts[0].address,
            to: estimateGasContractAddress.address,
            nonce: await relay.getAccountNonce(accounts[0].address),
            gasPrice: await relay.gasPrice(),
            data: '0xbbbfb986',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigFalse },
          ]);

          successResultCallWithDepth.input = '0xbbbfb986';
          successResultCallWithDepth.from = accounts[0].address;

          Assertions.validateResultDebugValues(
            resultDebug,
            ['to', 'output', 'calls', 'gasUsed'],
            ['to', 'from', 'output', 'input', 'gasUsed'],
            successResultCallWithDepth,
          );
          expect(resultDebug.calls).to.have.lengthOf(1);
        });

        it('should not be able to debug a failing CREATE transaction of type Legacy with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionTypeLegacy,
            nonce: await relay.getAccountNonce(accounts[0].address),
            chainId: Number(CHAIN_ID),
            from: accounts[0].address,
            gasPrice: await relay.gasPrice(),
            data: '0x01121212',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigFalse },
          ]);

          failingResultCreate.from = accounts[0].address;
          failingResultCreate.input = '0x01121212';

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output', 'gasUsed'], [], failingResultCreate);
        });

        it('should be able to debug a failing CALL transaction with revert reason of type Legacy with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionTypeLegacy,
            from: accounts[0].address,
            to: reverterContractAddress,
            nonce: await relay.getAccountNonce(accounts[0].address),
            gasPrice: await relay.gasPrice(),
            data: '0x0323d234',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigFalse },
          ]);

          failingResultCall.from = accounts[0].address;
          failingResultCall.input = '0x0323d234';

          Assertions.validateResultDebugValues(
            resultDebug,
            ['to', 'output', 'calls', 'gasUsed'],
            [],
            failingResultCall,
          );
        });

        //onlyTopCall:true
        it('should be able to debug a successful CREATE transaction of type Legacy with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionTypeLegacy,
            chainId: Number(CHAIN_ID),
            data: bytecode,
            nonce: await relay.getAccountNonce(accounts[0].address),
            gasPrice: await relay.gasPrice(),
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);
          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigTrue },
          ]);

          defaultResponseFields.from = accounts[0].address;
          defaultResponseFields.input = bytecode;

          Assertions.validateResultDebugValues(
            resultDebug,
            ['to', 'output', 'calls', 'gasUsed'],
            [],
            defaultResponseFields,
          );
        });

        it('should be able to debug a successful CALL transaction of type Legacy with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionTypeLegacy,
            from: accounts[0].address,
            to: estimateGasContractAddress.address,
            nonce: await relay.getAccountNonce(accounts[0].address),
            gasPrice: await relay.gasPrice(),
            data: '0xc648049d0000000000000000000000000000000000000000000000000000000000000001',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigFalse },
          ]);

          successResultCall.input = '0xc648049d0000000000000000000000000000000000000000000000000000000000000001';
          successResultCall.from = accounts[0].address;

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output', 'gasUsed'], [], successResultCall);
        });

        it('should be able to debug a failing CREATE transaction of type Legacy with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionTypeLegacy,
            nonce: await relay.getAccountNonce(accounts[0].address),
            chainId: Number(CHAIN_ID),
            from: accounts[0].address,
            gasPrice: await relay.gasPrice(),
            data: '0x01121212',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigTrue },
          ]);

          failingResultCreate.from = accounts[0].address;
          failingResultCreate.input = '0x01121212';

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output', 'gasUsed'], [], failingResultCreate);
        });

        it('should be able to debug a failing CALL transaction of type Legacy with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionTypeLegacy,
            from: accounts[0].address,
            to: reverterContractAddress,
            nonce: await relay.getAccountNonce(accounts[0].address),
            gasPrice: await relay.gasPrice(),
            data: '0x0323d234',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigTrue },
          ]);

          failingResultCall.from = accounts[0].address;
          failingResultCall.input = '0x0323d234';

          Assertions.validateResultDebugValues(
            resultDebug,
            ['to', 'output', 'calls', 'gasUsed'],
            [],
            failingResultCall,
          );
        });
      });

      describe('Test transaction of type 1', async function () {
        //onlyTopCall:false
        it('should be able to debug a successful CREATE transaction of type 2930 with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionType2930,
            chainId: Number(CHAIN_ID),
            data: bytecode,
            nonce: await relay.getAccountNonce(accounts[0].address),
            gasPrice: await relay.gasPrice(),
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigFalse },
          ]);

          successResultCreateWithDepth.from = accounts[0].address;

          Assertions.validateResultDebugValues(
            resultDebug,
            ['to', 'output', 'input', 'calls', 'gas', 'gasUsed'],
            ['from', 'to', 'input', 'output', 'gas', 'gasUsed'],
            successResultCreateWithDepth,
          );
          expect(resultDebug.calls).to.have.lengthOf(1);
        });

        //onlyTopCall:false
        it('should be able to debug a successful CALL transaction of type 2930 with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionType2930,
            from: accounts[0].address,
            to: estimateGasContractAddress.address,
            nonce: await relay.getAccountNonce(accounts[0].address),
            gasPrice: await relay.gasPrice(),
            data: '0xc648049d0000000000000000000000000000000000000000000000000000000000000001',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigFalse },
          ]);

          defaultResponseFields.type = 'CALL';
          defaultResponseFields.input = '0xc648049d0000000000000000000000000000000000000000000000000000000000000001';
          defaultResponseFields.from = accounts[0].address;

          Assertions.validateResultDebugValues(
            resultDebug,
            ['to', 'output', 'calls', 'gasUsed'],
            [],
            defaultResponseFields,
          );
        });

        it('should be able to debug a failing CREATE transaction of type 2930 with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionType2930,
            nonce: await relay.getAccountNonce(accounts[2].address),
            chainId: Number(CHAIN_ID),
            from: accounts[2].address,
            gasPrice: await relay.gasPrice(),
            data: '0x01121212',
          };

          const signedTransaction = await accounts[2].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigFalse },
          ]);

          failingResultCreate.from = accounts[2].address;
          failingResultCreate.input = '0x01121212';

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output', 'gasUsed'], [], failingResultCreate);
        });

        it('should be able to debug a failing CALL transaction of type 2930 with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionType2930,
            from: accounts[0].address,
            to: reverterContractAddress,
            nonce: await relay.getAccountNonce(accounts[0].address),
            gasPrice: await relay.gasPrice(),
            data: '0x0323d234',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigFalse },
          ]);

          failingResultCall.from = accounts[0].address;
          failingResultCall.input = '0x0323d234';

          Assertions.validateResultDebugValues(
            resultDebug,
            ['to', 'output', 'calls', 'gasUsed'],
            [],
            failingResultCall,
          );
        });

        //onlyTopCall:true
        it('should be able to debug a successful CREATE transaction of type 2930 with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionType2930,
            chainId: Number(CHAIN_ID),
            data: bytecode,
            nonce: await relay.getAccountNonce(accounts[0].address),
            gasPrice: await relay.gasPrice(),
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigTrue },
          ]);

          defaultResponseFields.from = accounts[0].address;
          defaultResponseFields.input = bytecode;
          defaultResponseFields.type = 'CREATE';

          Assertions.validateResultDebugValues(
            resultDebug,
            ['to', 'output', 'input', 'calls', 'gasUsed'],
            [],
            defaultResponseFields,
          );
        });

        it('should be able to debug a successful CALL transaction of type 2930 with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionType2930,
            from: accounts[0].address,
            to: estimateGasContractAddress.address,
            nonce: await relay.getAccountNonce(accounts[0].address),
            gasPrice: await relay.gasPrice(),
            data: '0xc648049d0000000000000000000000000000000000000000000000000000000000000001',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigTrue },
          ]);

          successResultCall.input = '0xc648049d0000000000000000000000000000000000000000000000000000000000000001';
          successResultCall.from = accounts[0].address;

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output', 'gasUsed'], [], successResultCall);
        });

        it('should be able to debug a failing CREATE transaction of type 2930 with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionType2930,
            nonce: await relay.getAccountNonce(accounts[0].address),
            chainId: Number(CHAIN_ID),
            from: accounts[0].address,
            gasPrice: await relay.gasPrice(),
            data: '0x01121212',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigTrue },
          ]);

          failingResultCreate.from = accounts[0].address;
          failingResultCreate.input = '0x01121212';

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output', 'gasUsed'], [], failingResultCreate);
        });

        it('should be able to debug a failing CALL transaction of type 2930 with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionType2930,
            from: accounts[1].address,
            to: reverterContractAddress,
            nonce: await relay.getAccountNonce(accounts[1].address),
            gasPrice: await relay.gasPrice(),
            data: '0x0323d234',
          };

          const signedTransaction = await accounts[1].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigTrue },
          ]);

          failingResultCall.from = accounts[1].address;
          failingResultCall.input = '0x0323d234';

          Assertions.validateResultDebugValues(
            resultDebug,
            ['to', 'output', 'calls', 'gasUsed'],
            [],
            failingResultCall,
          );
        });
      });

      describe('Test transactions of type: 2', async function () {
        //onlyTopCall:false
        it('should be able to debug a successful CREATE transaction of type 1559 with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionType2,
            chainId: Number(CHAIN_ID),
            data: bytecode,
            nonce: await relay.getAccountNonce(accounts[0].address),
            gasPrice: await relay.gasPrice(),
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigFalse },
          ]);

          successResultCreateWithDepth.from = accounts[0].address;

          Assertions.validateResultDebugValues(
            resultDebug,
            ['to', 'output', 'input', 'calls', 'gas', 'gasUsed'],
            ['from', 'to', 'input', 'output', 'gas', 'gasUsed'],
            successResultCreateWithDepth,
          );
          expect(resultDebug.calls).to.have.lengthOf(1);
        });

        it('should be able to debug a successful CALL transaction of type 1559 with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionType2,
            to: estimateGasContractAddress.address,
            nonce: await relay.getAccountNonce(accounts[0].address),
            gasPrice: await relay.gasPrice(),
            data: '0xc648049d0000000000000000000000000000000000000000000000000000000000000001',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigFalse },
          ]);
          defaultResponseFields.type = 'CALL';
          defaultResponseFields.input = '0xc648049d0000000000000000000000000000000000000000000000000000000000000001';
          defaultResponseFields.from = accounts[0].address;

          Assertions.validateResultDebugValues(
            resultDebug,
            ['to', 'output', 'calls', 'gas', 'gasUsed'],
            [],
            defaultResponseFields,
          );
        });

        it('@release should be able to debug a failing CREATE transaction of type 1559 with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionType2,
            nonce: await relay.getAccountNonce(accounts[2].address),
            chainId: CHAIN_ID,
            from: accounts[2].address,
            gasPrice: await relay.gasPrice(),
            data: '0x01121212',
          };

          const signedTransaction = await accounts[2].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigFalse },
          ]);

          failingResultCreate.from = accounts[2].address;
          failingResultCreate.input = '0x01121212';

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output', 'gasUsed'], [], failingResultCreate);
        });

        it('@release should be able to debug a failing CALL transaction of type 1559 with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionType2,
            to: reverterContractAddress,
            nonce: await relay.getAccountNonce(accounts[0].address),
            gasPrice: await relay.gasPrice(),
            data: '0x0323d234',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigFalse },
          ]);

          failingResultCall.from = accounts[0].address;
          failingResultCall.input = '0x0323d234';

          Assertions.validateResultDebugValues(
            resultDebug,
            ['to', 'output', 'calls', 'gasUsed'],
            [],
            failingResultCall,
          );
        });

        //onlyTopCall:true
        it('@release should be able to debug a successful CREATE transaction of type 1559 with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionType2,
            chainId: CHAIN_ID,
            data: bytecode,
            nonce: await relay.getAccountNonce(accounts[0].address),
            gasPrice: await relay.gasPrice(),
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigTrue },
          ]);

          defaultResponseFields.from = accounts[0].address;
          defaultResponseFields.input = bytecode;
          defaultResponseFields.type = 'CREATE';

          Assertions.validateResultDebugValues(
            resultDebug,
            ['to', 'output', 'input', 'calls', 'gasUsed'],
            [],
            defaultResponseFields,
          );
        });

        it('@release should be able to debug a successful CALL transaction of type 1559 with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionType2,
            to: estimateGasContractAddress.address,
            nonce: await relay.getAccountNonce(accounts[0].address),
            gasPrice: await relay.gasPrice(),
            data: '0xc648049d0000000000000000000000000000000000000000000000000000000000000001',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigTrue },
          ]);

          successResultCall.input = '0xc648049d0000000000000000000000000000000000000000000000000000000000000001';
          successResultCall.from = accounts[0].address;

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output', 'gasUsed'], [], successResultCall);
        });

        it('should be able to debug a failing CREATE transaction of type 1559 with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionType2,
            nonce: await relay.getAccountNonce(accounts[0].address),
            chainId: Number(CHAIN_ID),
            gasPrice: await relay.gasPrice(),
            data: '0x01121212',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigTrue },
          ]);

          failingResultCreate.from = accounts[0].address;
          failingResultCreate.input = '0x01121212';

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output', 'gasUsed'], [], failingResultCreate);
        });

        it('should be able to debug a failing CALL transaction of type 1559 with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionType2,
            from: accounts[1].address,
            to: reverterContractAddress,
            nonce: await relay.getAccountNonce(accounts[1].address),
            gasPrice: await relay.gasPrice(),
            data: '0x0323d234',
          };

          const signedTransaction = await accounts[1].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION, [
            transactionHash,
            { tracer: callTracer, tracerConfig: tracerConfigTrue },
          ]);

          failingResultCall.from = accounts[1].address;
          failingResultCall.input = '0x0323d234';

          Assertions.validateResultDebugValues(
            resultDebug,
            ['to', 'output', 'calls', 'gasUsed'],
            [],
            failingResultCall,
          );
        });
      });
    });

    describe('Negative scenarios', async function () {
      it('should return 400 error for non-existing transaction hash', async function () {
        const nonExistentTransactionHash = '0xb8a433b014684558d4154c73de3ed360bd5867725239938c2143acb7a76bca82';
        const expectedError = predefined.RESOURCE_NOT_FOUND(
          `Failed to retrieve contract results for transaction ${nonExistentTransactionHash}`,
        );
        const args = [
          RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
          [nonExistentTransactionHash, { tracer: callTracer, tracerConfig: tracerConfigTrue }],
          requestId,
        ];

        await Assertions.assertPredefinedRpcError(expectedError, relay.call, false, relay, args);
      });

      it('should fail to debug a transaction with invalid onlyTopCall value type', async function () {
        const transaction = {
          ...transactionTypeLegacy,
          chainId: Number(CHAIN_ID),
          data: bytecode,
          nonce: await relay.getAccountNonce(accounts[0].address),
          gasPrice: await relay.gasPrice(),
        };

        const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTransaction);
        await relay.pollForValidTransactionReceipt(transactionHash);

        const expectedError = predefined.INVALID_PARAMETER(
          "'tracerConfig' for TracerConfigWrapper",
          `${TYPES.tracerConfig.error}, value: ${JSON.stringify(tracerConfigInvalid)}`,
        );
        const args = [
          RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
          [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigInvalid }],
          requestId,
        ];

        await Assertions.assertPredefinedRpcError(expectedError, relay.call, false, relay, args);
      });

      it('should fail to debug a transaction with invalid tracer type', async function () {
        const transaction = {
          ...transactionTypeLegacy,
          chainId: Number(CHAIN_ID),
          data: bytecode,
          nonce: await relay.getAccountNonce(accounts[0].address),
          gasPrice: await relay.gasPrice(),
        };

        const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTransaction);
        await relay.pollForValidTransactionReceipt(transactionHash);
        const expectedError = predefined.INVALID_PARAMETER(
          "'tracer' for TracerConfigWrapper",
          `${TYPES.tracerType.error}, value: invalidTracer`,
        );
        const args = [
          RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
          [transactionHash, { tracer: 'invalidTracer', tracerConfig: tracerConfigTrue }],
          requestId,
        ];

        await Assertions.assertPredefinedRpcError(expectedError, relay.call, false, relay, args);
      });
    });
  });

  describe('Batch Request Test Suite BATCH_REQUESTS_ENABLED = true', async function () {
    overrideEnvsInMochaDescribe({ BATCH_REQUESTS_ENABLED: true });

    it('@release Should return errors for blacklisted methods', async function () {
      const disallowedMethods = ConfigService.get('BATCH_REQUESTS_DISALLOWED_METHODS');
      const payload: { id: number; method: string; params: unknown[] }[] = [];
      for (let index = 0; index < disallowedMethods.length; index++) {
        payload.push({
          id: index,
          method: disallowedMethods[index],
          params: [],
        });
      }

      const res = await relay.callBatch(payload);
      expect(res.length).to.equal(disallowedMethods.length);
      for (let index = 0; index < disallowedMethods.length; index++) {
        expect(res[index]).to.haveOwnProperty('error');
        expect(res[index].id).to.equal(index);
        expect(res[index].error.code).to.equal(-32007);
        expect(res[index].error.message).to.match(
          requestIdRegex(`Method ${disallowedMethods[index]} is not permitted as part of batch requests`),
        );
      }
    });

    it('Should return a batch of requests', async function () {
      const testAccount = await Utils.createAliasAccount(mirrorNode, accounts[0]);

      {
        const payload = [
          {
            id: 1,
            method: RelayCall.ETH_ENDPOINTS.ETH_CHAIN_ID,
            params: [],
          },
          {
            id: 2,
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
            params: [testAccount.address, 'latest'],
          },
          {
            id: 3,
            method: RelayCall.ETH_ENDPOINTS.ETH_GAS_PRICE,
            params: [],
          },
        ];

        const res = await relay.callBatch(payload);
        expect(res).to.have.length(payload.length);
        expect(res.filter((r: { id: number }) => r.id === 1)[0].result).to.be.equal(CHAIN_ID);
        expect(res.filter((r: { id: number }) => r.id === 2)[0].result).to.be.equal('0x0');
        expect(res.filter((r: { id: number }) => r.id === 3)[0].result).to.be.equal(
          '0x' + Assertions.defaultGasPrice.toString(16),
        );
      }

      let transactionHash: string;
      {
        const deployerContract = await Utils.deployContract(
          DeployerContractJson.abi,
          DeployerContractJson.bytecode,
          testAccount.wallet,
        );
        const deployContractAddress = deployerContract.target;

        const defaultGasPrice = numberTo0x(Assertions.defaultGasPrice);
        const defaultGasLimit = numberTo0x(3_000_000);
        const defaultTransaction = {
          value: ONE_TINYBAR,
          chainId: Number(CHAIN_ID),
          maxPriorityFeePerGas: defaultGasPrice,
          maxFeePerGas: defaultGasPrice,
          gasLimit: defaultGasLimit,
          type: 2,
        };

        const account = accounts[3].wallet;

        const gasPrice = await relay.gasPrice();
        const signedTx = await account.signTransaction({
          ...defaultTransaction,
          to: deployContractAddress,
          nonce: await relay.getAccountNonce(account.address),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
        });
        transactionHash = await relay.sendRawTransaction(signedTx);
        await relay.pollForValidTransactionReceipt(transactionHash);

        const res = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT, [account.address, 'latest']);
        expect(res).to.be.equal('0x1');
      }

      {
        const payload = [
          {
            id: 2,
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
            params: [testAccount.address, 'latest'],
          },
          {
            id: 3,
            method: RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT,
            params: [transactionHash],
          },
        ];

        const res = await relay.callBatch(payload);
        expect(res).to.have.length(payload.length);
        expect(res.filter((r: { id: number }) => r.id === 2)[0].result).to.be.equal('0x1');
        expect(res.filter((r: { id: number }) => r.id === 3)[0].result.transactionHash).to.be.equal(transactionHash);
      }
    });
  });

  describe('Address Limit Test Suite', async function () {
    const MAX_ADDRESSES = ConfigService.get('MAX_ADDRESSES_PER_REQUEST');
    const addressLimitError = predefined.INVALID_PARAMETER(
      'address',
      `A maximum of ${MAX_ADDRESSES} addresses are allowed`,
    );

    const distinctAddresses = (count: number, offset = 0): string[] =>
      Array.from({ length: count }, (_, index) => `0x${(offset + index + 1).toString(16).padStart(40, '0')}`);

    let logsContractAddress: string;
    let logBlockNumber: string;

    before(async () => {
      const logsContract = await Utils.deployContract(
        LogsContractJson.abi,
        LogsContractJson.bytecode,
        accounts[0].wallet,
      );
      logsContractAddress = (logsContract.target as string).toLowerCase();

      const tx = await logsContract.log1(1, await Utils.gasOptions());
      const receipt = await tx.wait();
      logBlockNumber = numberTo0x(receipt.blockNumber);

      for (let attempt = 0; attempt < 10; attempt++) {
        const { logs } = await mirrorNode.get(`/contracts/${logsContractAddress}/results/logs?limit=1`);
        if (logs?.length) break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    });

    it('should reject eth_getLogs when the distinct address count exceeds MAX_ADDRESSES_PER_REQUEST', async function () {
      await relay.callFailing(
        RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
        [{ address: distinctAddresses(MAX_ADDRESSES + 1), fromBlock: 'latest', toBlock: 'latest' }],
        addressLimitError,
      );
    });

    it('should reject eth_newFilter when the distinct address count exceeds MAX_ADDRESSES_PER_REQUEST', async function () {
      await relay.callFailing(
        RelayCalls.ETH_ENDPOINTS.ETH_NEW_FILTER,
        [{ address: distinctAddresses(MAX_ADDRESSES + 1), fromBlock: 'latest', toBlock: 'latest' }],
        addressLimitError,
      );
    });

    it('should collapse duplicate addresses before applying the cap and return each log once', async function () {
      const blockRange = { fromBlock: logBlockNumber, toBlock: logBlockNumber };

      const single = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS, [
        { ...blockRange, address: logsContractAddress },
      ]);
      expect(single).to.be.an('array').with.length.greaterThan(0);

      const duplicated = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS, [
        { ...blockRange, address: new Array(MAX_ADDRESSES + 1).fill(logsContractAddress) },
      ]);

      expect(duplicated).to.deep.equal(single);
    });

    it('should reject the whole batch when the address total across entries exceeds MAX_ADDRESSES_PER_REQUEST', async function () {
      const total = MAX_ADDRESSES + 1;
      const firstEntryCount = Math.ceil(total / 2);
      const payload = [
        {
          id: 1,
          method: RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
          params: [{ address: distinctAddresses(firstEntryCount), fromBlock: 'latest', toBlock: 'latest' }],
        },
        {
          id: 2,
          method: RelayCalls.ETH_ENDPOINTS.ETH_GET_LOGS,
          params: [
            {
              address: distinctAddresses(total - firstEntryCount, firstEntryCount),
              fromBlock: 'latest',
              toBlock: 'latest',
            },
          ],
        },
      ];

      const res = await relay.callBatch(payload);
      const expectedError = predefined.BATCH_REQUESTS_ADDRESS_TOTAL_EXCEEDED(total, MAX_ADDRESSES);

      expect(res).to.have.length(payload.length);
      res.forEach((entry: { error: { code: number; message: string } }) => {
        expect(entry.error.code).to.equal(expectedError.code);
        expect(entry.error.message).to.match(requestIdRegex(expectedError.message));
      });
    });
  });

  describe('Validate length of the rpc parameters array', async function () {
    const testClient = Axios.create({
      baseURL: 'http://localhost:' + ConfigService.get('E2E_SERVER_PORT'),
      responseType: 'json' as const,
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
      timeout: 30 * 1000,
    });

    const generateTest = (method: string, params: unknown[]): void => {
      it(method, async () => {
        try {
          await testClient.post('/', {
            id: '2',
            jsonrpc: '2.0',
            method,
            params,
          });

          Assertions.expectedError();
        } catch (e) {
          const res = (e as { response: { status: number; data: { error: unknown } } }).response;
          expect(res.status).to.equal(400);
          Assertions.jsonRpcError(res.data.error, predefined.INVALID_PARAMETERS);
        }
      });
    };

    const TEST_SUITES = {
      eth_getBalance: ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', '0x140d78a', null],
      eth_getCode: ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', '0x140d78a', null],
      eth_getBlockByHash: ['0x4cc9a77780cf0e6d0dc75373bf00e3437db450ede45cb51b5da936fb46342c99', false, null],
      eth_getBlockByNumber: ['0x4cc9a7', false, null],
      eth_getBlockTransactionCountByHash: ['0x4cc9a77780cf0e6d0dc75373bf00e3437db450ede45cb51b5da936fb46342c99', null],
      eth_getBlockTransactionCountByNumber: ['0x4cc9a779', null],
      eth_getTransactionByBlockHashAndIndex: [
        '0x4cc9a77780cf0e6d0dc75373bf00e3437db450ede45cb51b5da936fb46342c99',
        '0x1',
        null,
      ],
      eth_getTransactionByBlockNumberAndIndex: ['0x4cc9a77', '0x1', null],
      eth_getTransactionCount: ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', '0x13455', null],
      eth_sendRawTransaction: [
        '0xf86a018203e882520894f17f52151ebef6c7334fad080c5704d77216b732896c6b935b8bbd400000801ba093129415f03b4794fd1512e79ee7f097e4271f66721020f8407aac92179893a5a0451b875d89721ec98be55201092980b0a87bb1c48507fccb86da713596b2a09e',
        null,
      ],
      eth_call: [
        {
          to: '0x6b175474e89094c44da98b954eedeac495271d0f',
          data: '0x70a082310000000000000000000000006E0d01A76C3Cf4288372a29124A26D4353EE51BE',
        },
        'latest',
        {},
        {},
        null,
      ],
      eth_getTransactionByHash: ['0x4cc9a77780cf0e6d0dc75373bf00e3437db450ede45cb51b5da936fb46342c99', null],
      eth_getTransactionReceipt: ['0x4cc9a77780cf0e6d0dc75373bf00e3437db450ede45cb51b5da936fb46342c99', null],
      eth_getLogs: [
        {
          address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        },
        null,
      ],
      eth_getBlockReceipts: ['0x5661236', null],
      eth_newFilter: [
        {
          address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        },
        null,
      ],
      eth_getFilterLogs: ['0xdf2a59ba81f4f052230c9992443cb801', null],
      eth_getFilterChanges: ['0xdf2a59ba81f4f052230c9992443cb801', null],
      eth_uninstallFilter: ['0xdf2a59ba81f4f052230c9992443cb801', null],
    };

    for (const [method, params] of Object.entries(TEST_SUITES)) {
      generateTest(method, params);
    }
  });

  describe('EIP-1898', function () {
    type RpcOutcome = { result?: unknown; error?: { code: number; message: string } };

    const outcome = async (method: string, params: unknown[]): Promise<RpcOutcome> => {
      try {
        return { result: await relay.call(method, params) };
      } catch (e) {
        const thrown = e as {
          response?: { bodyJson?: { error?: RpcOutcome['error'] } };
          info?: { error?: RpcOutcome['error'] };
          error?: RpcOutcome['error'];
        };
        const error = thrown.response?.bodyJson?.error ?? thrown.info?.error ?? thrown.error;
        if (!error) throw e;
        return { error: { code: error.code, message: error.message.replace(/^\[Request ID: [^\]]+\] /, '') } };
      }
    };

    const waitForChange = async <T>(read: () => Promise<T>, changed: (value: T) => boolean): Promise<T> => {
      const timeoutMs = 60 * 1000;
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const value = await read();
        if (changed(value)) return value;
        if (Date.now() > deadline) throw new Error(`value did not change within ${timeoutMs} ms`);
        await Utils.wait(1000);
      }
    };

    const UNKNOWN_HASH = '0x' + '11'.repeat(32);
    const BLOCK_TAGS = ['latest', 'earliest', 'pending', 'safe', 'finalized'];

    let storageContract: ethers.Contract;
    let storageAddress: string;
    let erc20Contract: ethers.Contract;
    let erc20Address: string;
    let blockNumber: string;
    let blockHash: string;

    /** The five methods taking a default block parameter, each building its params around `blockParam`. */
    const METHODS: Record<string, (blockParam: unknown) => unknown[]> = {
      eth_getBalance: (blockParam) => [accounts[0].address, blockParam],
      eth_getCode: (blockParam) => [storageAddress, blockParam],
      eth_getTransactionCount: (blockParam) => [accounts[0].address, blockParam],
      eth_getStorageAt: (blockParam) => [storageAddress, '0x0', blockParam],
      eth_call: (blockParam) => [
        { to: erc20Address, data: erc20Contract.interface.encodeFunctionData('balanceOf', [accounts[1].address]) },
        blockParam,
      ],
    };
    const STATE_GETTERS = ['eth_getBalance', 'eth_getCode', 'eth_getTransactionCount', 'eth_getStorageAt'];
    const blockParamIndex = (method: string): number => (method === 'eth_getStorageAt' ? 2 : 1);

    const call = (method: string, blockParam: unknown): Promise<unknown> =>
      relay.call(method, METHODS[method](blockParam));
    const callOutcome = (method: string, blockParam: unknown): Promise<RpcOutcome> =>
      outcome(method, METHODS[method](blockParam));
    const callFailing = (method: string, blockParam: unknown, expectedError: JsonRpcError): Promise<void> =>
      relay.callFailing(method, METHODS[method](blockParam), expectedError);

    before(async () => {
      erc20Contract = await Utils.deployContractWithEthers(
        ['EIP-1898', 'EIP', accounts[0].address, 1000],
        ERC20MockJson,
        accounts[0].wallet,
        relay,
      );
      erc20Address = await erc20Contract.getAddress();

      storageContract = await Utils.deployContract(
        StorageContractJson.abi,
        StorageContractJson.bytecode,
        accounts[0].wallet,
      );
      storageAddress = storageContract.target as string;

      const receipt = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT, [
        storageContract.deploymentTransaction()!.hash,
      ]);
      blockNumber = receipt.blockNumber;
      blockHash = receipt.blockHash;
    });

    describe('AC1: object forms are accepted on all state getters', function () {
      for (const method of STATE_GETTERS) {
        it(`${method} answers {"blockNumber"}, {"blockHash"} and {"blockHash", "requireCanonical"} like the block number`, async function () {
          const expected = await call(method, blockNumber);

          for (const objectForm of [{ blockNumber }, { blockHash }, { blockHash, requireCanonical: true }]) {
            expect(await call(method, objectForm), JSON.stringify(objectForm)).to.deep.equal(expected);
          }
        });
      }
    });

    describe('AC2: tags inside blockNumber', function () {
      for (const method of Object.keys(METHODS)) {
        it(`${method} answers {"blockNumber": <tag>} like the plain tag`, async function () {
          for (const tag of BLOCK_TAGS) {
            const stringForm = await callOutcome(method, tag);
            expect(await callOutcome(method, { blockNumber: tag }), tag).to.deep.equal(stringForm);
          }
        });
      }

      it('eth_getTransactionCount with {"blockNumber": "pending"} matches "pending"', async function () {
        const expected = await call('eth_getTransactionCount', 'pending');

        expect(await call('eth_getTransactionCount', { blockNumber: 'pending' })).to.equal(expected);
      });

      it('eth_getTransactionCount with {"blockNumber": "0x0"} and {"blockNumber": "earliest"} match the string forms', async function () {
        for (const blockParam of ['0x0', 'earliest']) {
          const stringForm = await callOutcome('eth_getTransactionCount', blockParam);
          expect(await callOutcome('eth_getTransactionCount', { blockNumber: blockParam }), blockParam).to.deep.equal(
            stringForm,
          );
        }
      });
    });

    describe('AC3: requireCanonical is accepted everywhere, including eth_call', function () {
      for (const method of Object.keys(METHODS)) {
        it(`${method} answers requireCanonical true and false like {"blockHash"}, and rejects a non-boolean`, async function () {
          const expected = await call(method, { blockHash });

          for (const requireCanonical of [true, false]) {
            expect(await call(method, { blockHash, requireCanonical }), String(requireCanonical)).to.deep.equal(
              expected,
            );
          }

          await callFailing(
            method,
            { blockHash, requireCanonical: 'yes' },
            predefined.INVALID_PARAMETER(blockParamIndex(method), `'requireCanonical' in EIP-1898 block object`),
          );
        });
      }
    });

    describe('AC4: malformed objects are rejected at validation time', function () {
      const malformed = (): [unknown, string][] => [
        [{}, ValidatorConstants.BLOCK_PARAM_OBJECT_NEITHER_ERROR],
        [{ blockHash, blockNumber }, ValidatorConstants.BLOCK_PARAM_OBJECT_BOTH_ERROR],
        [{ blockNumber, requireCanonical: true }, ValidatorConstants.BLOCK_PARAM_OBJECT_REQUIRE_CANONICAL_ERROR],
        [{ blockHash: null }, `'blockHash' in EIP-1898 block object`],
        [{ blockNumber: null }, `'blockNumber' in EIP-1898 block object`],
        [{ blockHash: '0x1234' }, `'blockHash' in EIP-1898 block object`],
        [[blockNumber], ValidatorConstants.BLOCK_PARAMS_ERROR],
        [{ blockHash, foo: 'bar' }, ValidatorConstants.BLOCK_PARAM_OBJECT_UNKNOWN_KEY_ERROR('foo')],
      ];

      for (const method of Object.keys(METHODS)) {
        it(`${method} rejects every malformed block object with -32602 naming the rule and parameter ${blockParamIndex(method)}`, async function () {
          for (const [blockParam, rule] of malformed()) {
            await callFailing(method, blockParam, predefined.INVALID_PARAMETER(blockParamIndex(method), rule));
          }
        });
      }
    });

    describe('AC5: block hash works on eth_getCode', function () {
      it('returns the code at the block for a plain block hash string', async function () {
        const byHash = await call('eth_getCode', blockHash);

        expect(byHash).to.not.equal('0x');
        expect(byHash).to.equal(await call('eth_getCode', blockNumber));
      });
    });

    describe('AC6: an unknown block hash is a uniform "not found"', function () {
      for (const method of Object.keys(METHODS)) {
        it(`${method} returns -32001 for an unknown hash in string and object form`, async function () {
          for (const blockParam of [UNKNOWN_HASH, { blockHash: UNKNOWN_HASH }]) {
            await callFailing(method, blockParam, predefined.RESOURCE_NOT_FOUND(`block '${UNKNOWN_HASH}'.`));
          }
        });
      }
    });

    describe('AC7: error messages are readable', function () {
      it('the hash and block parameter errors never say "Expected Expected"', function () {
        for (const message of [ValidatorConstants.BLOCK_HASH_ERROR, ValidatorConstants.BLOCK_PARAMS_ERROR]) {
          expect(message).to.not.contain('Expected Expected');
        }
      });

      for (const method of Object.keys(METHODS)) {
        it(`${method} prints the offending value as JSON`, async function () {
          const index = blockParamIndex(method);
          const cases: [unknown, string][] = [
            [
              { blockNumber: 'newest' },
              `'blockNumber' in EIP-1898 block object: ${ValidatorConstants.BLOCK_NUMBER_ERROR}, value: {"blockNumber":"newest"}`,
            ],
            [
              { blockHash: '0x1234' },
              `'blockHash' in EIP-1898 block object: ${ValidatorConstants.BLOCK_HASH_ERROR}, value: {"blockHash":"0x1234"}`,
            ],
            ['newest', `${ValidatorConstants.BLOCK_PARAMS_ERROR}, value: newest`],
          ];

          for (const [blockParam, message] of cases) {
            await callFailing(method, blockParam, predefined.INVALID_PARAMETER(index, message));
          }
        });
      }
    });

    describe('AC8: no regression for existing forms', function () {
      for (const method of Object.keys(METHODS)) {
        it(`${method} still answers a block number, the tags and a raw block hash`, async function () {
          for (const blockParam of [blockNumber, blockHash, ...BLOCK_TAGS.filter((tag) => tag !== 'earliest')]) {
            expect(await call(method, blockParam), blockParam).to.exist;
          }
        });
      }

      it('eth_call with {"blockHash"} answers like the raw block hash string', async function () {
        expect(await call('eth_call', { blockHash })).to.equal(await call('eth_call', blockHash));
      });
    });

    describe('AC9: spec matches behavior', function () {
      it('declares both EIP-1898 object forms in BlockNumberOrTagOrHash for the five methods', function () {
        const schemas = openRpcData.components.schemas as Record<string, { oneOf?: { $ref?: string }[] }>;
        const refs = schemas.BlockNumberOrTagOrHash.oneOf!.map((option) => option.$ref);
        expect(refs).to.include.members([
          '#/components/schemas/BlockNumberObject',
          '#/components/schemas/BlockHashObject',
        ]);

        for (const method of Object.keys(METHODS)) {
          const spec = openRpcData.methods.find((m: { name: string }) => m.name === method)!;
          const blockParamSchema = (spec.params as { schema: { $ref?: string } }[])[blockParamIndex(method)].schema;
          expect(blockParamSchema.$ref, method).to.equal('#/components/schemas/BlockNumberOrTagOrHash');
        }
      });
    });

    describe('AC10: non-cacheable tags stay uncached in object form', function () {
      it('eth_getBalance, eth_getTransactionCount, eth_getStorageAt and eth_call with {"blockNumber": "latest"} follow state changes', async function () {
        const latest = { blockNumber: 'latest' };
        const readers: Record<string, () => Promise<unknown>> = {
          eth_getBalance: () => relay.call('eth_getBalance', [accounts[1].address, latest]),
          eth_getTransactionCount: () => call('eth_getTransactionCount', latest),
          eth_getStorageAt: () => call('eth_getStorageAt', latest),
          eth_call: () => call('eth_call', latest),
        };

        // read through the object form first, so a cached answer would be served back below
        const before: Record<string, unknown> = {};
        for (const [method, read] of Object.entries(readers)) {
          before[method] = await read();
        }

        // change the state behind every reader: accounts[0] sends three transactions (nonce), one of which
        // moves HBAR to accounts[1] (balance), one moves tokens to accounts[1] (eth_call) and one rewrites slot 0
        await Utils.sendTransaction(ONE_TINYBAR, CHAIN_ID, accounts, relay, mirrorNode);
        await (await erc20Contract.getFunction('transfer')(accounts[1].address, 1)).wait();
        await (await storageContract.getFunction('updateStoredUInt')()).wait();

        for (const [method, read] of Object.entries(readers)) {
          const after = await waitForChange(read, (value) => value !== before[method]);
          expect(after, method).to.not.equal(before[method]);
        }
      });
    });

    describe('AC11 / AC12: object and string forms share one answer', function () {
      for (const method of Object.keys(METHODS)) {
        it(`${method} answers "N", {"blockNumber": N}, "H", {"blockHash": H} and requireCanonical identically`, async function () {
          const forms = [blockNumber, { blockNumber }, blockHash, { blockHash }, { blockHash, requireCanonical: true }];
          const expected = await call(method, forms[0]);

          for (const blockParam of [...forms, ...[...forms].reverse()]) {
            expect(await call(method, blockParam), JSON.stringify(blockParam)).to.deep.equal(expected);
          }
        });
      }
    });

    describe('AC13: batch parity', function () {
      overrideEnvsInMochaDescribe({ BATCH_REQUESTS_ENABLED: true });

      it('answers object forms inside a batch like single requests, failing only the malformed entries', async function () {
        const requests = [
          ...Object.keys(METHODS).map((method) => ({
            method,
            params: METHODS[method]({ blockHash, requireCanonical: true }),
          })),
          ...Object.keys(METHODS).map((method) => ({ method, params: METHODS[method]({ blockNumber }) })),
          { method: 'eth_getBalance', params: METHODS.eth_getBalance({}) },
          { method: 'eth_getStorageAt', params: METHODS.eth_getStorageAt({ blockHash, blockNumber }) },
          { method: 'eth_call', params: METHODS.eth_call({ blockHash: UNKNOWN_HASH }) },
        ];

        const batch = await relay.callBatch(requests.map((request, id) => ({ id, ...request })));

        expect(batch.length).to.equal(requests.length);
        for (const [i, entry] of batch.entries()) {
          const single = await outcome(requests[i].method, requests[i].params);
          expect(entry.id).to.equal(i);
          if (single.error) {
            expect(entry.error.code, requests[i].method).to.equal(single.error.code);
            expect(entry.error.message, requests[i].method).to.match(requestIdRegex(single.error.message));
          } else {
            expect(entry.result, requests[i].method).to.deep.equal(single.result);
          }
        }

        const valid = Object.keys(METHODS).length * 2;
        expect(batch.slice(0, valid).every((entry: RpcOutcome) => !entry.error)).to.be.true;
        expect(batch.slice(valid).map((entry: RpcOutcome) => entry.error?.code)).to.deep.equal([
          -32602, -32602, -32001,
        ]);
      });
    });
  });

  it('should return balance for eth_getBalance called with a block number within the last 15 minutes', async function () {
    const blocksRes = await mirrorNode.get('/blocks?limit=1&order=desc');
    const latestBlock = blocksRes.blocks[0];

    // 5 blocks back: blockDiff=5 > latestBlockTolerance(1), so delta path is taken.
    // At ~2s/block this is ~10s old, well within the 900s BALANCES_UPDATE_INTERVAL.
    const targetBlockNumber = latestBlock.number - 5;

    const balance = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_BALANCE, [
      accounts[0].address,
      numberTo0x(targetBlockNumber),
    ]);

    expect(balance).to.not.be.null;
    expect(balance).to.match(/^0x[0-9a-f]+$/i);
  });
});
