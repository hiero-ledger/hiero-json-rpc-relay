// SPDX-License-Identifier: Apache-2.0

// External resources
import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { predefined } from '@hashgraph/json-rpc-relay';
import Constants from '@hashgraph/json-rpc-relay/dist/lib/constants';
import { RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';
import { numberTo0x } from '@hashgraph/json-rpc-relay/src/formatters';
import { TracerType } from '@hashgraph/json-rpc-relay/src/lib/constants';
// Helper functions/constants from local resources
import { EthImpl } from '@hashgraph/json-rpc-relay/src/lib/eth';
import RelayAssertions from '@hashgraph/json-rpc-relay/tests/assertions';
import { ContractId } from '@hashgraph/sdk';
import Axios from 'axios';
import chai, { expect } from 'chai';
import chaiExclude from 'chai-exclude';
import { BaseContract, ethers } from 'ethers';

import { ConfigServiceTestHelper } from '../../../config-service/tests/configServiceTestHelper';
import { overrideEnvsInMochaDescribe } from '../../../relay/tests/helpers';
import { TYPES } from '../../src/validator';
import RelayCall from '../../tests/helpers/constants';
import Helper from '../../tests/helpers/constants';
import Address from '../../tests/helpers/constants';
import MirrorClient from '../clients/mirrorClient';
import RelayClient from '../clients/relayClient';
import ServicesClient from '../clients/servicesClient';
import basicContractJson from '../contracts/Basic.json';
import callerContractJson from '../contracts/Caller.json';
import DeployerContractJson from '../contracts/Deployer.json';
import EstimateGasContract from '../contracts/EstimateGasContract.json';
import HederaTokenServiceImplJson from '../contracts/HederaTokenServiceImpl.json';
import HRC719ContractJson from '../contracts/HRC719Contract.json';
// Contracts and JSON files from local resources
import reverterContractJson from '../contracts/Reverter.json';
// Assertions and constants from local resources
import Assertions from '../helpers/assertions';
import RelayCalls from '../helpers/constants';
import { Utils } from '../helpers/utils';
import { AliasAccount } from '../types/AliasAccount';

chai.use(chaiExclude);

describe('@api-batch-3 RPC Server Acceptance Tests', function () {
  this.timeout(240 * 1000); // 240 seconds

  const accounts: AliasAccount[] = [];
  const requestDetails = new RequestDetails({ requestId: 'rpc_batch1Test', ipAddress: '0.0.0.0' });

  // @ts-ignore
  const {
    servicesNode,
    mirrorNode,
    relay,
  }: { servicesNode: ServicesClient; mirrorNode: MirrorClient; relay: RelayClient } = global;
  let mirrorPrimaryAccount: ethers.Wallet;
  let mirrorSecondaryAccount: ethers.Wallet;

  const CHAIN_ID = ConfigService.get('CHAIN_ID');
  const ONE_TINYBAR = Utils.add0xPrefix(Utils.toHex(ethers.parseUnits('1', 10)));

  let reverterContract: ethers.Contract;
  let reverterEvmAddress: string;
  let requestId: string;
  const BASIC_CONTRACT_PING_CALL_DATA = '0x5c36b186';
  const BASIC_CONTRACT_PING_RESULT = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const RESULT_TRUE = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const PURE_METHOD_CALL_DATA = '0xb2e0100c';
  const VIEW_METHOD_CALL_DATA = '0x90e9b875';
  const PAYABLE_METHOD_CALL_DATA = '0xd0efd7ef';
  const PURE_METHOD_ERROR_DATA =
    '0x08c379a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000010526576657274526561736f6e5075726500000000000000000000000000000000';
  const VIEW_METHOD_ERROR_DATA =
    '0x08c379a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000010526576657274526561736f6e5669657700000000000000000000000000000000';
  const PAYABLE_METHOD_ERROR_DATA =
    '0x08c379a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000013526576657274526561736f6e50617961626c6500000000000000000000000000';
  const PURE_METHOD_ERROR_MESSAGE = 'RevertReasonPure';
  const VIEW_METHOD_ERROR_MESSAGE = 'RevertReasonView';
  const errorMessagePrefixedStr =
    'Expected 0x prefixed string representing the hash (32 bytes) in object, 0x prefixed hexadecimal block number, or the string "latest", "earliest" or "pending"';
  const TOPICS = [
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    '0x0000000000000000000000000000000000000000000000000000000000000000',
    '0x000000000000000000000000000000000000000000000000000000000000042d',
  ];
  const ONE_THOUSAND_TINYBARS = Utils.add0xPrefix(Utils.toHex(Constants.TINYBAR_TO_WEIBAR_COEF * 1000));

  beforeEach(async () => {
    requestId = Utils.generateRequestId();
  });

  before(async () => {
    requestId = Utils.generateRequestId();
    const initialAccount: AliasAccount = global.accounts[0];

    const initialBalance = '10000000000';
    const neededAccounts: number = 4;
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

    reverterContract = await Utils.deployContract(
      reverterContractJson.abi,
      reverterContractJson.bytecode,
      accounts[0].wallet,
    );

    reverterEvmAddress = reverterContract.target as string;

    mirrorPrimaryAccount = accounts[0].wallet;
    mirrorSecondaryAccount = accounts[1].wallet;
  });

  describe('eth_call', () => {
    let basicContract: ethers.Contract;
    let basicContractAddress: string;
    let deploymentBlockNumber: number;
    let deploymentBlockHash: string;

    before(async () => {
      basicContract = await Utils.deployContract(basicContractJson.abi, basicContractJson.bytecode, accounts[0].wallet);
      basicContractAddress = basicContract.target as string;

      const basicContractTxHash = basicContract.deploymentTransaction()?.hash;
      expect(basicContractTxHash).to.not.be.null;

      const transactionReceipt = await accounts[0].wallet.provider?.getTransactionReceipt(basicContractTxHash!);
      expect(transactionReceipt).to.not.be.null;

      if (transactionReceipt) {
        deploymentBlockNumber = transactionReceipt.blockNumber;
        deploymentBlockHash = transactionReceipt.blockHash;
      }
    });

    it('@release should execute "eth_call" request to Basic contract', async function () {
      const callData = {
        from: accounts[0].address,
        to: basicContractAddress,
        gas: numberTo0x(30000),
        data: BASIC_CONTRACT_PING_CALL_DATA,
      };

      const res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, 'latest'], requestId);
      expect(res).to.eq(BASIC_CONTRACT_PING_RESULT);
    });

    it('@release should execute "eth_call" request to simulate deploying a contract with `to` field being null', async function () {
      const callData = {
        from: accounts[0].address,
        to: null,
        data: basicContractJson.bytecode,
      };
      const res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, 'latest'], requestId);
      expect(res).to.eq(basicContractJson.deployedBytecode);
    });

    it('@release should execute "eth_call" request to simulate deploying a contract with `to` field being empty/undefined', async function () {
      const callData = {
        from: accounts[0].address,
        data: basicContractJson.bytecode,
      };
      const res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, 'latest'], requestId);
      expect(res).to.eq(basicContractJson.deployedBytecode);
    });

    it('should fail "eth_call" request without data field', async function () {
      const callData = {
        from: accounts[0].address,
        to: basicContractAddress,
        gas: numberTo0x(30000),
      };

      const res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, 'latest'], requestId);
      expect(res).to.eq('0x'); // confirm no error
    });

    it('"eth_call" for non-existing contract address returns 0x', async function () {
      const callData = {
        from: accounts[0].address,
        to: Address.NON_EXISTING_ADDRESS,
        gas: numberTo0x(30000),
        data: BASIC_CONTRACT_PING_CALL_DATA,
      };

      const res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, 'latest'], requestId);
      expect(res).to.eq('0x'); // confirm no error
    });

    it('should execute "eth_call" without from field', async function () {
      const callData = {
        to: basicContractAddress,
        gas: numberTo0x(30000),
        data: BASIC_CONTRACT_PING_CALL_DATA,
      };

      const res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, 'latest'], requestId);
      expect(res).to.eq(BASIC_CONTRACT_PING_RESULT);
    });

    it('should execute "eth_call" without gas field', async function () {
      const callData = {
        from: accounts[0].address,
        to: basicContractAddress,
        data: BASIC_CONTRACT_PING_CALL_DATA,
      };

      const res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, 'latest'], requestId);
      expect(res).to.eq(BASIC_CONTRACT_PING_RESULT);
    });

    it('should execute "eth_call" with correct block number', async function () {
      const callData = {
        from: accounts[0].address,
        to: basicContractAddress,
        data: BASIC_CONTRACT_PING_CALL_DATA,
      };

      // deploymentBlockNumber to HEX
      const block = numberTo0x(deploymentBlockNumber);

      const res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, block], requestId);
      expect(res).to.eq(BASIC_CONTRACT_PING_RESULT);
    });

    it('should execute "eth_call" with incorrect block number, SC should not exist yet', async function () {
      const callData = {
        from: accounts[0].address,
        to: basicContractAddress,
        data: BASIC_CONTRACT_PING_CALL_DATA,
      };

      // deploymentBlockNumber - 1 to HEX
      const block = numberTo0x(deploymentBlockNumber - 1);

      const res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, block], requestId);
      expect(res).to.eq('0x');
    });

    it('should execute "eth_call" with incorrect block number as an object, SC should not exist yet', async function () {
      const callData = {
        from: accounts[0].address,
        to: basicContractAddress,
        data: BASIC_CONTRACT_PING_CALL_DATA,
      };

      // deploymentBlockNumber - 1 to HEX
      const block = numberTo0x(deploymentBlockNumber - 1);

      const res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, { blockNumber: block }], requestId);
      expect(res).to.eq('0x');
    });

    it('should execute "eth_call" with incorrect block hash object, SC should not exist yet', async function () {
      const callData = {
        from: accounts[0].address,
        to: basicContractAddress,
        data: BASIC_CONTRACT_PING_CALL_DATA,
      };

      // get block hash before deployment
      const blockNumber = deploymentBlockNumber - 1;
      const nextBlockHash = (await mirrorNode.get(`/blocks/${blockNumber}`, requestId)).hash;
      const truncatedHash = nextBlockHash.slice(0, 66);

      const res = await relay.call(
        RelayCall.ETH_ENDPOINTS.ETH_CALL,
        [callData, { blockHash: truncatedHash }],
        requestId,
      );
      expect(res).to.eq('0x');
    });

    it('should execute "eth_call" with correct block hash object', async function () {
      const callData = {
        from: accounts[0].address,
        to: basicContractAddress,
        data: BASIC_CONTRACT_PING_CALL_DATA,
      };

      const truncatedHash = deploymentBlockHash.slice(0, 66);

      const res = await relay.call(
        RelayCall.ETH_ENDPOINTS.ETH_CALL,
        [callData, { blockHash: truncatedHash }],
        requestId,
      );
      expect(res).to.eq(BASIC_CONTRACT_PING_RESULT);
    });

    it('should execute "eth_call" with correct block number object', async function () {
      const callData = {
        from: accounts[0].address,
        to: basicContractAddress,
        data: BASIC_CONTRACT_PING_CALL_DATA,
      };

      // deploymentBlockNumber to HEX
      const block = numberTo0x(deploymentBlockNumber);

      const res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, { blockNumber: block }], requestId);
      expect(res).to.eq(BASIC_CONTRACT_PING_RESULT);
    });

    it('should execute "eth_call" with both data and input fields', async function () {
      const callData = {
        from: accounts[0].address,
        to: basicContractAddress,
        data: BASIC_CONTRACT_PING_CALL_DATA,
        input: BASIC_CONTRACT_PING_CALL_DATA,
      };

      // deploymentBlockNumber to HEX
      const block = numberTo0x(deploymentBlockNumber);
      const res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, { blockNumber: block }], requestId);
      expect(res).to.eq(BASIC_CONTRACT_PING_RESULT);
    });

    it('should fail to execute "eth_call" with wrong block tag', async function () {
      const callData = {
        from: accounts[0].address,
        to: basicContractAddress,
        data: BASIC_CONTRACT_PING_CALL_DATA,
      };
      const errorType = predefined.INVALID_PARAMETER(1, `${errorMessagePrefixedStr}, value: newest`);
      const args = [RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, 'newest'], requestId];

      await Assertions.assertPredefinedRpcError(errorType, relay.call, false, relay, args);
    });

    it('should fail to execute "eth_call" with wrong block number', async function () {
      const callData = {
        from: accounts[0].address,
        to: basicContractAddress,
        data: BASIC_CONTRACT_PING_CALL_DATA,
      };
      const errorType = predefined.INVALID_PARAMETER(1, `${errorMessagePrefixedStr}, value: 123`);
      const args = [RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, '123'], requestId];

      await Assertions.assertPredefinedRpcError(errorType, relay.call, false, relay, args);
    });

    it('should fail to execute "eth_call" with wrong block hash object', async function () {
      const callData = {
        from: accounts[0].address,
        to: basicContractAddress,
        data: BASIC_CONTRACT_PING_CALL_DATA,
      };
      const errorType = predefined.INVALID_PARAMETER(
        `'blockHash' for BlockHashObject`,
        'Expected 0x prefixed string representing the hash (32 bytes) of a block, value: 0x123',
      );
      const args = [RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, { blockHash: '0x123' }], requestId];

      await Assertions.assertPredefinedRpcError(errorType, relay.call, false, relay, args);
    });

    it('should fail to execute "eth_call" with wrong block number object', async function () {
      const callData = {
        from: accounts[0].address,
        to: basicContractAddress,
        data: BASIC_CONTRACT_PING_CALL_DATA,
      };
      const errorType = predefined.INVALID_PARAMETER(
        `'blockNumber' for BlockNumberObject`,
        `Expected 0x prefixed hexadecimal block number, or the string "latest", "earliest" or "pending", value: invalid_block_number`,
      );
      const args = [RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, { blockNumber: 'invalid_block_number' }], requestId];

      await Assertions.assertPredefinedRpcError(errorType, relay.call, false, relay, args);
    });

    describe('Caller contract', () => {
      let callerContract: ethers.Contract;
      let callerAddress: string;
      let defaultCallData: any;
      let activeAccount: AliasAccount;
      let activeAccountAddress: string;

      const describes = [
        {
          title: 'With long-zero address',
          beforeFunc: async function () {
            activeAccount = accounts[0];
            activeAccountAddress = accounts[0].wallet.address.replace('0x', '').toLowerCase();
            callerContract = await Utils.deployContract(
              callerContractJson.abi,
              callerContractJson.bytecode,
              activeAccount.wallet,
            );
            const callerMirror = await mirrorNode.get(`/contracts/${callerContract.target}`, requestId);

            const callerContractId = ContractId.fromString(callerMirror.contract_id);
            callerAddress = `0x${callerContractId.toSolidityAddress()}`;

            defaultCallData = {
              from: activeAccount.address,
              to: callerAddress,
              gas: `0x7530`,
            };
          },
        },
        {
          title: 'With evm address',
          beforeFunc: async function () {
            activeAccount = accounts[1];
            activeAccountAddress = accounts[1].wallet.address.replace('0x', '').toLowerCase();
            callerContract = (await Utils.deployContractWithEthers(
              [],
              callerContractJson,
              activeAccount.wallet,
              relay,
            )) as ethers.Contract;
            // Wait for creation to propagate
            const callerMirror = await mirrorNode.get(`/contracts/${callerContract.target}`, requestId);
            callerAddress = callerMirror.evm_address;
            defaultCallData = {
              from: activeAccount.address,
              to: callerAddress,
              gas: `0x7530`,
            };
          },
        },
      ];

      for (const desc of describes) {
        describe(desc.title, () => {
          before(desc.beforeFunc);

          it('001 Should call pureMultiply', async function () {
            const callData = {
              ...defaultCallData,
              data: '0x0ec1551d',
            };

            const res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, 'latest'], requestId);
            expect(res).to.eq('0x0000000000000000000000000000000000000000000000000000000000000004');
          });

          it('002 Should call msgSender', async function () {
            const callData = {
              ...defaultCallData,
              data: '0xd737d0c7',
            };

            const res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, 'latest'], requestId);
            expect(res).to.eq(`0x${activeAccountAddress.padStart(64, '0')}`);
          });

          it('003 Should call txOrigin', async function () {
            const callData = {
              ...defaultCallData,
              data: '0xf96757d1',
            };

            const res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, 'latest'], requestId);
            expect(res).to.eq(`0x${activeAccountAddress.padStart(64, '0')}`);
          });

          it('004 Should call msgSig', async function () {
            const callData = {
              ...defaultCallData,
              data: '0xec3e88cf',
            };

            const res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, 'latest'], requestId);
            expect(res).to.eq('0xec3e88cf00000000000000000000000000000000000000000000000000000000');
          });

          it('005 Should call addressBalance', async function () {
            const callData = {
              ...defaultCallData,
              data: '0x0ec1551d',
            };

            const res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, 'latest'], requestId);
            expect(res).to.eq('0x0000000000000000000000000000000000000000000000000000000000000004');
          });

          it("006 'data' from request body with wrong method signature", async function () {
            const callData = {
              ...defaultCallData,
              data: '0x3ec4de3800000000000000000000000067d8d32e9bf1a9968a5ff53b87d777aa8ebbee69',
            };

            await relay.callFailing(
              RelayCall.ETH_ENDPOINTS.ETH_CALL,
              [callData, 'latest'],
              predefined.CONTRACT_REVERT(),
              requestId,
            );
          });

          it("007 'data' from request body with wrong encoded parameter", async function () {
            const callData = {
              ...defaultCallData,
              data: '0x3ec4de350000000000000000000000000000000000000000000000000000000000000000',
            };

            const res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, 'latest'], requestId);
            expect(res).to.eq('0x0000000000000000000000000000000000000000000000000000000000000000');
          });

          it("008 should work for missing 'from' field", async function () {
            const callData = {
              to: callerAddress,
              data: '0x0ec1551d',
            };

            const res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, 'latest'], requestId);
            expect(res).to.eq('0x0000000000000000000000000000000000000000000000000000000000000004');
          });

          it("009 should work for missing 'to' field", async function () {
            const callData = {
              from: accounts[0].address,
              data: basicContractJson.bytecode,
            };

            const res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, 'latest'], requestId);
            expect(res).to.eq(basicContractJson.deployedBytecode);
          });

          // value is processed only when eth_call goes through the mirror node
          if (!ConfigService.get('ETH_CALL_DEFAULT_TO_CONSENSUS_NODE')) {
            it('010 Should call msgValue', async function () {
              const callData = {
                ...defaultCallData,
                data: '0xddf363d7',
                value: ONE_THOUSAND_TINYBARS,
              };

              const res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, 'latest'], requestId);
              expect(res).to.eq('0x00000000000000000000000000000000000000000000000000000000000003e8');
            });

            // test is pending until fallback workflow to consensus node is removed, because this flow works when calling to consensus
            xit('011 Should fail when calling msgValue with more value than available balance', async function () {
              const callData = {
                ...defaultCallData,
                data: '0xddf363d7',
                value: '0x3e80000000',
              };
              const errorType = predefined.CONTRACT_REVERT();
              const args = [RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, 'latest'], requestId];

              await Assertions.assertPredefinedRpcError(errorType, relay.call, true, relay, args);
            });

            it("012 should work for wrong 'from' field", async function () {
              const callData = {
                from: '0x0000000000000000000000000000000000000000',
                to: callerAddress,
                data: '0x0ec1551d',
              };

              const res = await relay.call(RelayCall.ETH_ENDPOINTS.ETH_CALL, [callData, 'latest'], requestId);
              expect(res).to.eq('0x0000000000000000000000000000000000000000000000000000000000000004');
            });
          }
        });
      }
    });

    it('eth_call contract revert returns 200 http status', async function () {
      // preparing the contract data needed for a REVERT
      const activeAccount = accounts[1];
      const callerContract = await Utils.deployContractWithEthers([], callerContractJson, activeAccount.wallet, relay);
      // Wait for creation to propagate
      const callerMirror = await mirrorNode.get(`/contracts/${callerContract.target}`, requestId);
      const callerAddress = callerMirror.evm_address;
      const defaultCallData = {
        from: activeAccount.address,
        to: callerAddress,
        gas: `0x7530`,
      };
      const callData = {
        ...defaultCallData,
        data: '0x3ec4de3800000000000000000000000067d8d32e9bf1a9968a5ff53b87d777aa8ebbee69',
      };
      const data = {
        id: '2',
        jsonrpc: '2.0',
        method: RelayCalls.ETH_ENDPOINTS.ETH_CALL,
        params: [callData, 'latest'],
      };

      // Since we want the http status code, we need to perform the call using a client http request instead of using the relay instance directly
      const testClientPort = ConfigService.get('E2E_SERVER_PORT');
      const testClient = Axios.create({
        baseURL: 'http://localhost:' + testClientPort,
        responseType: 'json' as const,
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
        timeout: 30 * 1000,
      });

      // Performing the call
      const response = await testClient.post('/', data);

      // Asserting the response
      expect(response).to.exist;
      expect(response.status).to.be.equal(200);
      expect(response.data).to.exist;
      expect(response.data.error).to.exist;
      expect(response.data.error.code).to.be.equal(3);
      expect(response.data.error.message).to.contain('execution reverted: CONTRACT_REVERT_EXECUTED');
      expect(response.data.error.name).to.undefined;
    });
  });

  describe('Contract call reverts', async () => {
    it('Returns revert message for pure methods', async () => {
      const callData = {
        from: accounts[0].address,
        to: reverterEvmAddress,
        gas: numberTo0x(30000),
        data: PURE_METHOD_CALL_DATA,
      };

      await relay.callFailing(
        RelayCall.ETH_ENDPOINTS.ETH_CALL,
        [callData, 'latest'],
        predefined.CONTRACT_REVERT(PURE_METHOD_ERROR_MESSAGE, PURE_METHOD_ERROR_DATA),
        requestId,
      );
    });

    it('Returns revert message for view methods', async () => {
      const callData = {
        from: accounts[0].address,
        to: reverterEvmAddress,
        gas: numberTo0x(30000),
        data: VIEW_METHOD_CALL_DATA,
      };

      await relay.callFailing(
        RelayCall.ETH_ENDPOINTS.ETH_CALL,
        [callData, 'latest'],
        predefined.CONTRACT_REVERT(VIEW_METHOD_ERROR_MESSAGE, VIEW_METHOD_ERROR_DATA),
        requestId,
      );
    });

    it('Returns revert reason in receipt for payable methods', async () => {
      const transaction = {
        value: ONE_TINYBAR,
        gasLimit: numberTo0x(30000),
        chainId: Number(CHAIN_ID),
        to: reverterEvmAddress,
        nonce: await relay.getAccountNonce(accounts[0].address, requestId),
        maxFeePerGas: await relay.gasPrice(requestId),
        data: PAYABLE_METHOD_CALL_DATA,
      };
      const signedTx = await accounts[0].wallet.signTransaction(transaction);
      const transactionHash = await relay.sendRawTransaction(signedTx, requestId);

      // Wait until receipt is available in mirror node
      await mirrorNode.get(`/contracts/results/${transactionHash}`, requestId);

      const receipt = await relay.call(
        RelayCall.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT,
        [transactionHash],
        requestId,
      );
      expect(receipt?.revertReason).to.exist;
      expect(receipt.revertReason).to.eq(PAYABLE_METHOD_ERROR_DATA);
    });

    describe('eth_call for reverted pure contract calls', async function () {
      beforeEach(async () => {
        requestId = Utils.generateRequestId();
      });

      const pureMethodsData = [
        {
          data: '0x2dac842f',
          method: 'revertWithNothingPure',
          message: '',
          errorData: '0x',
        },
        {
          data: '0x8b153371',
          method: 'revertWithStringPure',
          message: 'Some revert message',
          errorData:
            '0x08c379a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000013536f6d6520726576657274206d65737361676500000000000000000000000000',
        },
        {
          data: '0x35314694',
          method: 'revertWithCustomErrorPure',
          message: '',
          errorData: '0x0bd3d39c',
        },
        {
          data: '0x83889056',
          method: 'revertWithPanicPure',
          message: '',
          errorData: '0x4e487b710000000000000000000000000000000000000000000000000000000000000012',
        },
      ];

      for (const element of pureMethodsData) {
        it(`Pure method ${element.method} returns tx receipt`, async function () {
          const callData = {
            from: accounts[0].address,
            to: reverterEvmAddress,
            gas: numberTo0x(30000),
            data: element.data,
          };

          await relay.callFailing(
            RelayCall.ETH_ENDPOINTS.ETH_CALL,
            [callData, 'latest'],
            predefined.CONTRACT_REVERT(element.message, element.errorData),
            requestId,
          );
        });
      }
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

      // Deploy a contract implementing HederaTokenService
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

      const res = await Utils.ethCallWRetries(relay, callData, 'latest', requestId);
      expect(res).to.eq(RESULT_TRUE);
    });

    describe('eth_call with force-to-consensus-by-selector logic', () => {
      // context: The `IHRC719.isAssociated()` function is a new feature which is, at the moment, fully supported only by the Consensus node and not yet by the Mirror node.
      // Since `IHRC719.isAssociated()` is a view function, requests for this function are typically directed to the Mirror node by default.
      // This acceptance test ensures that the new force-to-consensus-by-selector logic correctly routes requests for `IHRC719.isAssociated()`
      // through the Consensus node rather than the Mirror node when using the `eth_call` endpoint.

      let initialEthCallSelectorsAlwaysToConsensus: any, hrc719Contract: ethers.Contract;

      before(async () => {
        initialEthCallSelectorsAlwaysToConsensus = ConfigService.get('ETH_CALL_CONSENSUS_SELECTORS');

        hrc719Contract = await Utils.deployContract(
          HRC719ContractJson.abi,
          HRC719ContractJson.bytecode,
          accounts[0].wallet,
        );
      });

      after(() => {
        ConfigServiceTestHelper.dynamicOverride(
          'ETH_CALL_CONSENSUS_SELECTORS',
          initialEthCallSelectorsAlwaysToConsensus,
        );
      });

      it('should NOT allow eth_call to process IHRC719.isAssociated() method', async () => {
        const selectorsList = ConfigService.get('ETH_CALL_CONSENSUS_SELECTORS');
        expect(selectorsList.length).to.eq(0);

        // If the selector for `isAssociated` is not included in `ETH_CALL_CONSENSUS_SELECTORS`, the request will fail with a `CALL_EXCEPTION` error code.
        await expect(hrc719Contract.isAssociated(tokenAddress)).to.eventually.be.rejected.and.have.property(
          'code',
          'CALL_EXCEPTION',
        );
      });

      it('should allow eth_call to successfully process IHRC719.isAssociated() method', async () => {
        const isAssociatedSelector = (await hrc719Contract.isAssociated.populateTransaction(tokenAddress)).data.slice(
          2,
          10,
        );

        // Add the selector for isAssociated to ETH_CALL_CONSENSUS_SELECTORS to ensure isAssociated() passes
        ConfigServiceTestHelper.dynamicOverride('ETH_CALL_CONSENSUS_SELECTORS', [isAssociatedSelector]);
        const isAssociatedResult = await hrc719Contract.isAssociated(tokenAddress);
        expect(isAssociatedResult).to.be.false; // associate status of the token with the caller
      });
    });
  });

  describe('eth_getTransactionCount', async function () {
    let deployerContract: ethers.Contract;
    let deployerContractTx: ethers.TransactionReceipt;
    let deployerContractAddress: string;
    let contractId: ContractId;
    let primaryAccountNonce: Long | null;
    let secondaryAccountNonce: Long | null;

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

    before(async () => {
      deployerContract = await Utils.deployContract(
        DeployerContractJson.abi,
        DeployerContractJson.bytecode,
        accounts[0].wallet,
      );
      deployerContractAddress = deployerContract.target as string;

      const deployerContractTxHash = deployerContract.deploymentTransaction()?.hash;
      expect(deployerContractTxHash).to.not.be.null;

      deployerContractTx = await relay.call(
        RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT,
        [deployerContractTxHash],
        requestId,
      );

      // get contract details
      const mirrorContract = await mirrorNode.get(`/contracts/${deployerContractAddress}`, requestId);
      contractId = ContractId.fromString(mirrorContract.contract_id);

      primaryAccountNonce = await relay.call(
        RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
        [accounts[0].address, 'latest'],
        requestId,
      );
      secondaryAccountNonce = await relay.call(
        RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
        [accounts[1].address, 'latest'],
        requestId,
      );
    });

    it('@release should execute "eth_getTransactionCount" primary', async function () {
      const res = await relay.call(
        RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
        [mirrorPrimaryAccount.address, deployerContractTx.blockNumber],
        requestId,
      );
      expect(res).to.be.equal(primaryAccountNonce);
    });

    it('should execute "eth_getTransactionCount" secondary', async function () {
      const res = await relay.call(
        RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
        [mirrorSecondaryAccount.address, deployerContractTx.blockNumber],
        requestId,
      );
      expect(res).to.be.equal(secondaryAccountNonce);
    });

    it('@release should execute "eth_getTransactionCount" historic', async function () {
      const res = await relay.call(
        RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
        [deployerContractAddress, deployerContractTx.blockNumber],
        requestId,
      );
      expect(res).to.be.equal('0x2');
    });

    it('@release should execute "eth_getTransactionCount" contract latest', async function () {
      const res = await relay.call(
        RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
        [deployerContractAddress, EthImpl.blockLatest],
        requestId,
      );
      expect(res).to.be.equal('0x2');
    });

    it('@release should execute "eth_getTransactionCount" with block hash', async function () {
      const res = await relay.call(
        RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
        [deployerContractAddress, deployerContractTx.blockHash.slice(0, 66)],
        requestId,
      );
      expect(res).to.be.equal('0x2');
    });

    it('@release should execute "eth_getTransactionCount" for account with id converted to evm_address', async function () {
      const res = await relay.call(
        RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
        [mirrorPrimaryAccount.address, deployerContractTx.blockNumber],
        requestId,
      );
      expect(res).to.be.equal(primaryAccountNonce);
    });

    it('@release should execute "eth_getTransactionCount" contract with id converted to evm_address historic', async function () {
      const res = await relay.call(
        RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
        [Utils.idToEvmAddress(contractId.toString()), deployerContractTx.blockNumber],
        requestId,
      );
      expect(res).to.be.equal('0x2');
    });

    it('@release should execute "eth_getTransactionCount" contract with id converted to evm_address latest', async function () {
      const res = await relay.call(
        RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
        [Utils.idToEvmAddress(contractId.toString()), EthImpl.blockLatest],
        requestId,
      );
      expect(res).to.be.equal('0x2');
    });

    it('should execute "eth_getTransactionCount" for non-existing address', async function () {
      const res = await relay.call(
        RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
        [Address.NON_EXISTING_ADDRESS, deployerContractTx.blockNumber],
        requestId,
      );
      expect(res).to.be.equal('0x0');
    });

    it('should execute "eth_getTransactionCount" from hollow account', async function () {
      const hollowAccount = ethers.Wallet.createRandom();
      const resBeforeCreation = await relay.call(
        RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
        [hollowAccount.address, 'latest'],
        requestId,
      );
      expect(resBeforeCreation).to.be.equal('0x0');

      const gasPrice = await relay.gasPrice(requestId);
      const signedTxHollowAccountCreation = await accounts[1].wallet.signTransaction({
        ...defaultTransaction,
        value: '10000000000000000000', // 10 HBARs
        to: hollowAccount.address,
        nonce: await relay.getAccountNonce(accounts[1].address, requestId),
        maxPriorityFeePerGas: gasPrice,
        maxFeePerGas: gasPrice,
      });
      const txHashHAC = await relay.call(
        RelayCalls.ETH_ENDPOINTS.ETH_SEND_RAW_TRANSACTION,
        [signedTxHollowAccountCreation],
        requestId,
      );
      await mirrorNode.get(`/contracts/results/${txHashHAC}`, requestId);

      const signTxFromHollowAccount = await hollowAccount.signTransaction({
        ...defaultTransaction,
        to: deployerContractAddress,
        nonce: await relay.getAccountNonce(hollowAccount.address, requestId),
        maxPriorityFeePerGas: gasPrice,
        maxFeePerGas: gasPrice,
      });
      const txHashHA = await relay.call(
        RelayCalls.ETH_ENDPOINTS.ETH_SEND_RAW_TRANSACTION,
        [signTxFromHollowAccount],
        requestId,
      );
      await mirrorNode.get(`/contracts/results/${txHashHA}`, requestId);

      const resAfterCreation = await relay.call(
        RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
        [hollowAccount.address, 'latest'],
        requestId,
      );
      expect(resAfterCreation).to.be.equal('0x1');
    });

    it('should execute "eth_getTransactionCount" for account with non-zero nonce', async function () {
      const account = await Utils.createAliasAccount(mirrorNode, accounts[0], requestId);

      const gasPrice = await relay.gasPrice(requestId);
      const transaction = {
        ...defaultTransaction,
        to: deployerContractAddress,
        nonce: await relay.getAccountNonce(account.address, requestId),
        maxPriorityFeePerGas: gasPrice,
        maxFeePerGas: gasPrice,
      };

      const signedTx = await account.wallet.signTransaction(transaction);
      const transactionHash = await relay.sendRawTransaction(signedTx, requestId);
      // Since the transactionId is not available in this context
      // Wait for the transaction to be processed and imported in the mirror node with axios-retry
      await mirrorNode.get(`/contracts/results/${transactionHash}`, requestId);

      const res = await relay.call(
        RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
        [account.address, 'latest'],
        requestId,
      );
      expect(res).to.be.equal('0x1');
    });

    it('nonce for contract correctly increments', async function () {
      const nonceBefore = await relay.call(
        RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
        [deployerContract.target, 'latest'],
        requestId,
      );
      expect(nonceBefore).to.be.equal('0x2');

      const newContractReceipt = await deployerContract.deployViaCreate();
      await newContractReceipt.wait();

      const nonceAfter = await relay.call(
        RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
        [deployerContract.target, 'latest'],
        requestId,
      );
      expect(nonceAfter).to.be.equal('0x3');
    });
  });

  describe('Filter API Test Suite', () => {
    const nonExstingFilter = '0x111222331';

    describe('Positive', async function () {
      it('@release should be able to create a log filter', async function () {
        const currentBlock = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_BLOCK_NUMBER, [], requestId);
        expect(
          RelayAssertions.validateHash(await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_NEW_FILTER, [], requestId), 32),
        ).to.eq(true, 'without params');
        expect(
          RelayAssertions.validateHash(
            await relay.call(
              RelayCalls.ETH_ENDPOINTS.ETH_NEW_FILTER,
              [
                {
                  fromBlock: currentBlock,
                  toBlock: 'latest',
                },
              ],
              requestId,
            ),
            32,
          ),
        ).to.eq(true, 'from current block to latest');

        expect(
          RelayAssertions.validateHash(
            await relay.call(
              RelayCalls.ETH_ENDPOINTS.ETH_NEW_FILTER,
              [
                {
                  fromBlock: currentBlock,
                  toBlock: 'latest',
                  address: reverterEvmAddress,
                },
              ],
              requestId,
            ),
            32,
          ),
        ).to.eq(true, 'from current block to latest and specified address');

        expect(
          RelayAssertions.validateHash(
            await relay.call(
              RelayCalls.ETH_ENDPOINTS.ETH_NEW_FILTER,
              [
                {
                  fromBlock: currentBlock,
                  toBlock: 'latest',
                  address: reverterEvmAddress,
                  topics: TOPICS,
                },
              ],
              requestId,
            ),
            32,
          ),
        ).to.eq(true, 'with all params');
      });

      it('@release should be able to create a newBlock filter', async function () {
        expect(
          RelayAssertions.validateHash(
            await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_NEW_BLOCK_FILTER, [], requestId),
            32,
          ),
        ).to.eq(true);
      });

      it('should be able to uninstall existing log filter', async function () {
        const filterId = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_NEW_FILTER, [], requestId);
        const result = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_UNINSTALL_FILTER, [filterId], requestId);
        expect(result).to.eq(true);
      });

      it('should be able to uninstall existing newBlock filter', async function () {
        const filterId = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_NEW_BLOCK_FILTER, [], requestId);
        const result = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_UNINSTALL_FILTER, [filterId], requestId);
        expect(result).to.eq(true);
      });

      it('@release should be able to call eth_getFilterChanges for NEW_BLOCK filter', async function () {
        const filterId = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_NEW_BLOCK_FILTER, [], requestId);

        await new Promise((r) => setTimeout(r, 4000));
        const result = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_FILTER_CHANGES, [filterId], requestId);
        expect(result).to.exist;
        expect(result.length).to.gt(0, 'returns the latest block hashes');

        result.forEach((hash: string) => {
          expect(RelayAssertions.validateHash(hash, 96)).to.eq(true);
        });

        await new Promise((r) => setTimeout(r, 2000));
        const result2 = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_GET_FILTER_CHANGES, [filterId], requestId);
        expect(result2).to.exist;
        expect(result2.length).to.be.greaterThanOrEqual(1);
        expect(RelayAssertions.validateHash(result2[0], 96)).to.eq(true);
      });
    });

    describe('Negative', async function () {
      it('should not be able to uninstall not existing filter', async function () {
        const result = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_UNINSTALL_FILTER, [nonExstingFilter], requestId);
        expect(result).to.eq(false);
      });

      it('should not be able to call eth_getFilterChanges for not existing filter', async function () {
        await relay.callFailing(
          RelayCall.ETH_ENDPOINTS.ETH_GET_FILTER_CHANGES,
          [nonExstingFilter],
          predefined.FILTER_NOT_FOUND,
          requestId,
        );
      });

      it('should not support "eth_newPendingTransactionFilter"', async function () {
        await relay.callUnsupported(RelayCalls.ETH_ENDPOINTS.ETH_NEW_PENDING_TRANSACTION_FILTER, [], requestId);
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
      const defaultGasPrice = await relay.gasPrice(requestId);
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
        nonce: await relay.getAccountNonce(accounts[0].address, requestId),
      };

      const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
      const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
      await relay.pollForValidTransactionReceipt(transactionHash);
      estimateGasContractAddress = await mirrorNode.get(`/contracts/results/${transactionHash}`, requestId);
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
      };
      const failingResultCall = {
        ...defaultResponseFields,
        type: 'CALL',
        error: 'CONTRACT_REVERT_EXECUTED',
        revertReason: 'Some revert message',
      };

      describe('Test transactions of type 0', async function () {
        //onlyTopCall:false
        it('should be able to debug a successful CREATE transaction of type Legacy with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionTypeLegacy,
            chainId: Number(CHAIN_ID),
            data: bytecode,
            nonce: await relay.getAccountNonce(accounts[0].address, requestId),
            gasPrice: await relay.gasPrice(requestId),
          };
          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigFalse }],
            requestId,
          );

          successResultCreateWithDepth.from = accounts[0].address;

          Assertions.validateResultDebugValues(
            resultDebug,
            ['to', 'output', 'input', 'calls', 'gas'],
            ['from', 'to', 'input', 'output', 'gas'],
            successResultCreateWithDepth,
          );
          expect(resultDebug.calls).to.have.lengthOf(1);
        });

        it('should be able to debug a successful CALL transaction of type Legacy with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionTypeLegacy,
            from: accounts[0].address,
            to: estimateGasContractAddress.address,
            nonce: await relay.getAccountNonce(accounts[0].address, requestId),
            gasPrice: await relay.gasPrice(requestId),
            data: '0xbbbfb986',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigFalse }],
            requestId,
          );

          successResultCallWithDepth.input = '0xbbbfb986';
          successResultCallWithDepth.from = accounts[0].address;

          Assertions.validateResultDebugValues(
            resultDebug,
            ['to', 'output', 'calls'],
            ['to', 'from', 'output', 'input'],
            successResultCallWithDepth,
          );
          expect(resultDebug.calls).to.have.lengthOf(1);
        });

        it('should be able to debug a failing CREATE transaction of type Legacy with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionTypeLegacy,
            nonce: await relay.getAccountNonce(accounts[0].address, requestId),
            chainId: Number(CHAIN_ID),
            from: accounts[0].address,
            gasPrice: await relay.gasPrice(requestId),
            data: '0x01121212',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigFalse }],
            requestId,
          );

          failingResultCreate.from = accounts[0].address;
          failingResultCreate.input = '0x01121212';

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output'], [], failingResultCreate);
        });

        it('should be able to debug a failing CALL transaction with revert reason of type Legacy with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionTypeLegacy,
            from: accounts[0].address,
            to: reverterContractAddress,
            nonce: await relay.getAccountNonce(accounts[0].address, requestId),
            gasPrice: await relay.gasPrice(requestId),
            data: '0x0323d234',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigFalse }],
            requestId,
          );

          failingResultCall.from = accounts[0].address;
          failingResultCall.input = '0x0323d234';

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output', 'calls'], [], failingResultCall);
        });

        //onlyTopCall:true
        it('should be able to debug a successful CREATE transaction of type Legacy with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionTypeLegacy,
            chainId: Number(CHAIN_ID),
            data: bytecode,
            nonce: await relay.getAccountNonce(accounts[0].address, requestId),
            gasPrice: await relay.gasPrice(requestId),
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);
          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigTrue }],
            requestId,
          );

          defaultResponseFields.from = accounts[0].address;
          defaultResponseFields.input = bytecode;

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output', 'calls'], [], defaultResponseFields);
        });

        it('should be able to debug a successful CALL transaction of type Legacy with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionTypeLegacy,
            from: accounts[0].address,
            to: estimateGasContractAddress.address,
            nonce: await relay.getAccountNonce(accounts[0].address, requestId),
            gasPrice: await relay.gasPrice(requestId),
            data: '0xc648049d0000000000000000000000000000000000000000000000000000000000000001',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigFalse }],
            requestId,
          );

          successResultCall.input = '0xc648049d0000000000000000000000000000000000000000000000000000000000000001';
          successResultCall.from = accounts[0].address;

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output'], [], successResultCall);
        });

        it('should be able to debug a failing CREATE transaction of type Legacy with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionTypeLegacy,
            nonce: await relay.getAccountNonce(accounts[0].address, requestId),
            chainId: Number(CHAIN_ID),
            from: accounts[0].address,
            gasPrice: await relay.gasPrice(requestId),
            data: '0x01121212',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigTrue }],
            requestId,
          );

          failingResultCreate.from = accounts[0].address;
          failingResultCreate.input = '0x01121212';

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output'], [], failingResultCreate);
        });

        it('should be able to debug a failing CALL transaction of type Legacy with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionTypeLegacy,
            from: accounts[0].address,
            to: reverterContractAddress,
            nonce: await relay.getAccountNonce(accounts[0].address, requestId),
            gasPrice: await relay.gasPrice(requestId),
            data: '0x0323d234',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigTrue }],
            requestId,
          );

          failingResultCall.from = accounts[0].address;
          failingResultCall.input = '0x0323d234';

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output', 'calls'], [], failingResultCall);
        });
      });

      describe('Test transaction of type 1', async function () {
        //onlyTopCall:false
        it('should be able to debug a successful CREATE transaction of type 2930 with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionType2930,
            chainId: Number(CHAIN_ID),
            data: bytecode,
            nonce: await relay.getAccountNonce(accounts[0].address, requestId),
            gasPrice: await relay.gasPrice(requestId),
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigFalse }],
            requestId,
          );

          successResultCreateWithDepth.from = accounts[0].address;

          Assertions.validateResultDebugValues(
            resultDebug,
            ['to', 'output', 'input', 'calls', 'gas'],
            ['from', 'to', 'input', 'output', 'gas'],
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
            nonce: await relay.getAccountNonce(accounts[0].address, requestId),
            gasPrice: await relay.gasPrice(requestId),
            data: '0xc648049d0000000000000000000000000000000000000000000000000000000000000001',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigFalse }],
            requestId,
          );

          defaultResponseFields.type = 'CALL';
          defaultResponseFields.input = '0xc648049d0000000000000000000000000000000000000000000000000000000000000001';
          defaultResponseFields.from = accounts[0].address;

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output', 'calls'], [], defaultResponseFields);
        });

        it('should be able to debug a failing CREATE transaction of type 2930 with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionType2930,
            nonce: await relay.getAccountNonce(accounts[2].address, requestId),
            chainId: Number(CHAIN_ID),
            from: accounts[2].address,
            gasPrice: await relay.gasPrice(requestId),
            data: '0x01121212',
          };

          const signedTransaction = await accounts[2].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigFalse }],
            requestId,
          );

          failingResultCreate.from = accounts[2].address;
          failingResultCreate.input = '0x01121212';

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output'], [], failingResultCreate);
        });

        it('should be able to debug a failing CALL transaction of type 2930 with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionType2930,
            from: accounts[0].address,
            to: reverterContractAddress,
            nonce: await relay.getAccountNonce(accounts[0].address, requestId),
            gasPrice: await relay.gasPrice(requestId),
            data: '0x0323d234',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigFalse }],
            requestId,
          );

          failingResultCall.from = accounts[0].address;
          failingResultCall.input = '0x0323d234';

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output', 'calls'], [], failingResultCall);
        });

        //onlyTopCall:true
        it('should be able to debug a successful CREATE transaction of type 2930 with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionType2930,
            chainId: Number(CHAIN_ID),
            data: bytecode,
            nonce: await relay.getAccountNonce(accounts[0].address, requestId),
            gasPrice: await relay.gasPrice(requestId),
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigTrue }],
            requestId,
          );

          defaultResponseFields.from = accounts[0].address;
          defaultResponseFields.input = bytecode;
          defaultResponseFields.type = 'CREATE';

          Assertions.validateResultDebugValues(
            resultDebug,
            ['to', 'output', 'input', 'calls'],
            [],
            defaultResponseFields,
          );
        });

        it('should be able to debug a successful CALL transaction of type 2930 with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionType2930,
            from: accounts[0].address,
            to: estimateGasContractAddress.address,
            nonce: await relay.getAccountNonce(accounts[0].address, requestId),
            gasPrice: await relay.gasPrice(requestId),
            data: '0xc648049d0000000000000000000000000000000000000000000000000000000000000001',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigTrue }],
            requestId,
          );

          successResultCall.input = '0xc648049d0000000000000000000000000000000000000000000000000000000000000001';
          successResultCall.from = accounts[0].address;

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output'], [], successResultCall);
        });

        it('should be able to debug a failing CREATE transaction of type 2930 with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionType2930,
            nonce: await relay.getAccountNonce(accounts[0].address, requestId),
            chainId: Number(CHAIN_ID),
            from: accounts[0].address,
            gasPrice: await relay.gasPrice(requestId),
            data: '0x01121212',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigTrue }],
            requestId,
          );

          failingResultCreate.from = accounts[0].address;
          failingResultCreate.input = '0x01121212';

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output'], [], failingResultCreate);
        });

        it('should be able to debug a failing CALL transaction of type 2930 with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionType2930,
            from: accounts[1].address,
            to: reverterContractAddress,
            nonce: await relay.getAccountNonce(accounts[1].address, requestId),
            gasPrice: await relay.gasPrice(requestId),
            data: '0x0323d234',
          };

          const signedTransaction = await accounts[1].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigTrue }],
            requestId,
          );

          failingResultCall.from = accounts[1].address;
          failingResultCall.input = '0x0323d234';

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output', 'calls'], [], failingResultCall);
        });
      });

      describe('Test transactions of type: 2', async function () {
        //onlyTopCall:false
        it('should be able to debug a successful CREATE transaction of type 1559 with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionType2,
            chainId: Number(CHAIN_ID),
            data: bytecode,
            nonce: await relay.getAccountNonce(accounts[0].address, requestId),
            gasPrice: await relay.gasPrice(requestId),
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigFalse }],
            requestId,
          );

          successResultCreateWithDepth.from = accounts[0].address;

          Assertions.validateResultDebugValues(
            resultDebug,
            ['to', 'output', 'input', 'calls', 'gas'],
            ['from', 'to', 'input', 'output', 'gas'],
            successResultCreateWithDepth,
          );
          expect(resultDebug.calls).to.have.lengthOf(1);
        });

        it('should be able to debug a successful CALL transaction of type 1559 with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionType2,
            to: estimateGasContractAddress.address,
            nonce: await relay.getAccountNonce(accounts[0].address, requestId),
            gasPrice: await relay.gasPrice(requestId),
            data: '0xc648049d0000000000000000000000000000000000000000000000000000000000000001',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigFalse }],
            requestId,
          );
          defaultResponseFields.type = 'CALL';
          defaultResponseFields.input = '0xc648049d0000000000000000000000000000000000000000000000000000000000000001';
          defaultResponseFields.from = accounts[0].address;

          Assertions.validateResultDebugValues(
            resultDebug,
            ['to', 'output', 'calls', 'gas'],
            [],
            defaultResponseFields,
          );
        });

        it('@release should be able to debug a failing CREATE transaction of type 1559 with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionType2,
            nonce: await relay.getAccountNonce(accounts[2].address, requestId),
            chainId: CHAIN_ID,
            from: accounts[2].address,
            gasPrice: await relay.gasPrice(requestId),
            data: '0x01121212',
          };

          const signedTransaction = await accounts[2].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigFalse }],
            requestId,
          );

          failingResultCreate.from = accounts[2].address;
          failingResultCreate.input = '0x01121212';

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output'], [], failingResultCreate);
        });

        it('@release should be able to debug a failing CALL transaction of type 1559 with call depth and onlyTopCall false', async function () {
          const transaction = {
            ...transactionType2,
            to: reverterContractAddress,
            nonce: await relay.getAccountNonce(accounts[0].address, requestId),
            gasPrice: await relay.gasPrice(requestId),
            data: '0x0323d234',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigFalse }],
            requestId,
          );

          failingResultCall.from = accounts[0].address;
          failingResultCall.input = '0x0323d234';

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output', 'calls'], [], failingResultCall);
        });

        //onlyTopCall:true
        it('@release should be able to debug a successful CREATE transaction of type 1559 with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionType2,
            chainId: CHAIN_ID,
            data: bytecode,
            nonce: await relay.getAccountNonce(accounts[0].address, requestId),
            gasPrice: await relay.gasPrice(requestId),
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigTrue }],
            requestId,
          );

          defaultResponseFields.from = accounts[0].address;
          defaultResponseFields.input = bytecode;
          defaultResponseFields.type = 'CREATE';

          Assertions.validateResultDebugValues(
            resultDebug,
            ['to', 'output', 'input', 'calls'],
            [],
            defaultResponseFields,
          );
        });

        it('@release should be able to debug a successful CALL transaction of type 1559 with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionType2,
            to: estimateGasContractAddress.address,
            nonce: await relay.getAccountNonce(accounts[0].address, requestId),
            gasPrice: await relay.gasPrice(requestId),
            data: '0xc648049d0000000000000000000000000000000000000000000000000000000000000001',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigTrue }],
            requestId,
          );

          successResultCall.input = '0xc648049d0000000000000000000000000000000000000000000000000000000000000001';
          successResultCall.from = accounts[0].address;

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output'], [], successResultCall);
        });

        it('should be able to debug a failing CREATE transaction of type 1559 with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionType2,
            nonce: await relay.getAccountNonce(accounts[0].address, requestId),
            chainId: Number(CHAIN_ID),
            gasPrice: await relay.gasPrice(requestId),
            data: '0x01121212',
          };

          const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigTrue }],
            requestId,
          );

          failingResultCreate.from = accounts[0].address;
          failingResultCreate.input = '0x01121212';

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output'], [], failingResultCreate);
        });

        it('should be able to debug a failing CALL transaction of type 1559 with call depth and onlyTopCall true', async function () {
          const transaction = {
            ...transactionType2,
            from: accounts[1].address,
            to: reverterContractAddress,
            nonce: await relay.getAccountNonce(accounts[1].address, requestId),
            gasPrice: await relay.gasPrice(requestId),
            data: '0x0323d234',
          };

          const signedTransaction = await accounts[1].wallet.signTransaction(transaction);
          const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
          await relay.pollForValidTransactionReceipt(transactionHash);

          const resultDebug = await relay.call(
            RelayCalls.ETH_ENDPOINTS.DEBUG_TRACE_TRANSACTION,
            [transactionHash, { tracer: callTracer, tracerConfig: tracerConfigTrue }],
            requestId,
          );

          failingResultCall.from = accounts[1].address;
          failingResultCall.input = '0x0323d234';

          Assertions.validateResultDebugValues(resultDebug, ['to', 'output', 'calls'], [], failingResultCall);
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
          nonce: await relay.getAccountNonce(accounts[0].address, requestId),
          gasPrice: await relay.gasPrice(requestId),
        };

        const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
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
          nonce: await relay.getAccountNonce(accounts[0].address, requestId),
          gasPrice: await relay.gasPrice(requestId),
        };

        const signedTransaction = await accounts[0].wallet.signTransaction(transaction);
        const transactionHash = await relay.sendRawTransaction(signedTransaction, requestId);
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
      const payload: any[] = [];
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
        expect(res[index].error.message).to.equal(
          `Method ${disallowedMethods[index]} is not permitted as part of batch requests`,
        );
      }
    });

    it('Should return a batch of requests', async function () {
      const testAccount = await Utils.createAliasAccount(mirrorNode, accounts[0], requestId);

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
        expect(res.filter((r) => r.id === 1)[0].result).to.be.equal(CHAIN_ID);
        expect(res.filter((r) => r.id === 2)[0].result).to.be.equal('0x0');
        expect(res.filter((r) => r.id === 3)[0].result).to.be.equal('0x' + Assertions.defaultGasPrice.toString(16));
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

        const gasPrice = await relay.gasPrice(requestId);
        const signedTx = await account.signTransaction({
          ...defaultTransaction,
          to: deployContractAddress,
          nonce: await relay.getAccountNonce(account.address, requestId),
          maxPriorityFeePerGas: gasPrice,
          maxFeePerGas: gasPrice,
        });
        transactionHash = await relay.sendRawTransaction(signedTx, requestId);
        await relay.pollForValidTransactionReceipt(transactionHash);

        const res = await relay.call(
          RelayCalls.ETH_ENDPOINTS.ETH_GET_TRANSACTION_COUNT,
          [account.address, 'latest'],
          requestId,
        );
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
        expect(res.filter((r) => r.id === 2)[0].result).to.be.equal('0x1');
        expect(res.filter((r) => r.id === 3)[0].result.transactionHash).to.be.equal(transactionHash);
      }
    });
  });

  describe('Shard Blob Transactions', async function () {
    let defaultLondonTransactionData, defaultGasPrice, defaultGasLimit;
    const defaultBlobVersionedHashes = ['0x6265617665726275696c642e6f7267476265617665726275696c642e6f726747'];

    before(() => {
      defaultGasPrice = numberTo0x(Assertions.defaultGasPrice);
      defaultGasLimit = numberTo0x(3_000_000);

      defaultLondonTransactionData = {
        value: ONE_TINYBAR,
        chainId: Number(CHAIN_ID),
        maxPriorityFeePerGas: defaultGasPrice,
        maxFeePerGas: defaultGasPrice,
        gasLimit: defaultGasLimit,
      };
    });

    it('Type 3 transactions are not supported for eth_sendRawTransaction', async () => {
      const transaction = {
        ...defaultLondonTransactionData,
        type: 3,
        maxFeePerBlobGas: defaultGasPrice,
        blobVersionedHashes: defaultBlobVersionedHashes,
      };

      const signedTx = await accounts[0].wallet.signTransaction(transaction);
      await Assertions.assertPredefinedRpcError(
        predefined.UNSUPPORTED_TRANSACTION_TYPE,
        relay.sendRawTransaction,
        false,
        relay,
        [signedTx, requestId],
      );
    });
  });
});
