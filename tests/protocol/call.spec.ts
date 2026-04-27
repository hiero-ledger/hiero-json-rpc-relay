// SPDX-License-Identifier: Apache-2.0

import { ContractId } from '@hashgraph/sdk';
import { expect } from 'chai';
import { ethers } from 'ethers';

import { ConfigService } from '../../src/config-service/services';
import { JsonRpcError, predefined } from '../../src/relay';
import { numberTo0x } from '../../src/relay/formatters';
import Constants from '../../src/relay/lib/constants';
import MirrorClient from '../server/clients/mirrorClient';
import RelayClient from '../server/clients/relayClient';
import basicContractJson from '../server/contracts/Basic.json';
import callerContractJson from '../server/contracts/Caller.json';
import ERC20MockJson from '../server/contracts/ERC20Mock.json';
import reverterContractJson from '../server/contracts/Reverter.json';
import Address from '../server/helpers/constants';
import { Utils } from '../server/helpers/utils';
import { AliasAccount } from '../server/types/AliasAccount';
import { ALL_PROTOCOL_CLIENTS } from './helpers/protocolClient';

describe('@release @protocol-acceptance eth_call', async function () {
  this.timeout(240 * 1000);
  const METHOD_NAME = 'eth_call';
  const CHAIN_ID = ConfigService.get('CHAIN_ID');
  const ONE_TINYBAR = Utils.add0xPrefix(Utils.toHex(ethers.parseUnits('1', 10)));

  const BASIC_CONTRACT_PING_CALL_DATA = '0x5c36b186';
  const BASIC_CONTRACT_PING_RESULT = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const PURE_METHOD_CALL_DATA = '0xb2e0100c';
  const VIEW_METHOD_CALL_DATA = '0x90e9b875';
  const PURE_METHOD_ERROR_DATA =
    '0x08c379a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000010526576657274526561736f6e5075726500000000000000000000000000000000';
  const VIEW_METHOD_ERROR_DATA =
    '0x08c379a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000010526576657274526561736f6e5669657700000000000000000000000000000000';
  const PURE_METHOD_ERROR_MESSAGE = 'RevertReasonPure';
  const VIEW_METHOD_ERROR_MESSAGE = 'RevertReasonView';
  const ONE_THOUSAND_TINYBARS = Utils.add0xPrefix(Utils.toHex(Constants.TINYBAR_TO_WEIBAR_COEF * 1000));
  const ERROR_MESSAGE_PREFIXED_STR =
    'Expected 0x prefixed string representing the hash (32 bytes) in object, 0x prefixed hexadecimal block number, or the string "latest", "earliest" or "pending"';

  const INVALID_PARAMS: any[][] = [
    ['{}', false, '0x0'],
    ["{ to: '0xabcdef', data: '0x1a2b3c4d' }", 36, ''],
  ];

  const INVALID_TX_INFO: any[][] = [
    [{ to: 123, data: '0x18160ddd' }, 'latest'],
    [{ to: '0x', data: '0x18160ddd' }, 'latest'],
    [{ to: '0xabcdef', data: '0x18160ddd' }, 'latest'],
  ];

  const TOKEN_NAME = Utils.randomString(10);
  const TOKEN_SYMBOL = Utils.randomString(5);
  const TOKEN_INIT_SUPPLY = 10000n;
  const VALID_ERC20_DATA = [
    {
      sighash: '0x06fdde03',
      output: TOKEN_NAME,
    },
    {
      sighash: '0x95d89b41',
      output: TOKEN_SYMBOL,
    },
    {
      sighash: '0x18160ddd',
      output: TOKEN_INIT_SUPPLY,
    },
  ];

  // @ts-ignore
  const { mirrorNode, relay }: { mirrorNode: MirrorClient; relay: RelayClient } = global;

  const accounts: AliasAccount[] = [];
  let basicContractAddress: string;
  let deploymentBlockNumber: number;
  let deploymentBlockHash: string;
  let reverterEvmAddress: string;
  let erc20TokenAddr: string;
  let erc20EtherInterface: ethers.Interface;

  function expectRpcError(
    response: { error?: { code: number; message: string; data?: unknown } },
    expectedError: JsonRpcError,
    checkMessage = true,
  ) {
    expect(response.error).to.exist;
    expect(response.error!.code).to.eq(expectedError.code);
    if (checkMessage) {
      expect(response.error!.message).to.include(expectedError.message);
    }
  }

  before(async () => {
    accounts.push(...(await Utils.createMultipleAliasAccounts(mirrorNode, global.accounts[0], 4, '10000000000')));
    global.accounts.push(...accounts);

    const reverterContract = await Utils.deployContract(
      reverterContractJson.abi,
      reverterContractJson.bytecode,
      accounts[0].wallet,
    );
    reverterEvmAddress = reverterContract.target as string;

    const basicContract = await Utils.deployContract(
      basicContractJson.abi,
      basicContractJson.bytecode,
      accounts[0].wallet,
    );
    basicContractAddress = basicContract.target as string;

    const basicContractTxHash = basicContract.deploymentTransaction()?.hash;
    expect(basicContractTxHash).to.not.be.null;

    const transactionReceipt = await accounts[0].wallet.provider?.getTransactionReceipt(basicContractTxHash!);
    expect(transactionReceipt).to.not.be.null;

    if (transactionReceipt) {
      deploymentBlockNumber = transactionReceipt.blockNumber;
      deploymentBlockHash = transactionReceipt.blockHash;
    }

    const erc20Contract = await Utils.deployContractWithEthers(
      [TOKEN_NAME, TOKEN_SYMBOL, accounts[0].address, TOKEN_INIT_SUPPLY],
      ERC20MockJson,
      accounts[0].wallet,
      relay,
    );
    erc20TokenAddr = await erc20Contract.getAddress();
    erc20EtherInterface = new ethers.Interface(ERC20MockJson.abi);
  });

  after(async () => {
    if (global?.socketServer) {
      expect(global.socketServer._connections).to.eq(0);
    }
  });

  for (const client of ALL_PROTOCOL_CLIENTS) {
    describe(client.label, () => {
      for (const params of INVALID_PARAMS) {
        it(`Should fail eth_call and throw INVALID_PARAMETERS if params are invalid. params=[${params}]`, async () => {
          const response = await client.callRaw(METHOD_NAME, params);
          expect(response.error).to.exist;
          expect(response.error!.code).to.be.oneOf([-32000, -32602, -32603]);
        });
      }

      for (const params of INVALID_TX_INFO) {
        it(`Should fail eth_call and handle invalid TX_INFO. params=[${JSON.stringify(params)}]`, async () => {
          const response = await client.callRaw(METHOD_NAME, params);
          expect(response.error).to.exist;
          expect(response.error!.code).to.be.oneOf([-32000, -32602, -32603]);
        });
      }

      for (const data of VALID_ERC20_DATA) {
        it(`@release Should execute eth_call for ERC20 ${data.sighash}`, async () => {
          const tx = {
            to: erc20TokenAddr,
            data: data.sighash,
          };

          const output = (await client.call(METHOD_NAME, [tx, 'latest'])) as string;
          const outputASCII = erc20EtherInterface.decodeFunctionResult(
            erc20EtherInterface.getFunction(data.sighash)!,
            output,
          );
          expect(outputASCII[0]).to.eq(data.output);
        });
      }

      it('@release should execute "eth_call" request to Basic contract', async () => {
        const callData = {
          from: accounts[0].address,
          to: basicContractAddress,
          gas: numberTo0x(30000),
          data: BASIC_CONTRACT_PING_CALL_DATA,
        };

        const res = await client.call(METHOD_NAME, [callData, 'latest']);
        expect(res).to.eq(BASIC_CONTRACT_PING_RESULT);
      });

      it('@release should execute "eth_call" request to simulate deploying a contract with `to` field being null', async () => {
        const callData = {
          from: accounts[0].address,
          to: null,
          data: basicContractJson.bytecode,
        };
        const res = await client.call(METHOD_NAME, [callData, 'latest']);
        expect(res).to.eq(basicContractJson.deployedBytecode);
      });

      it('@release should execute "eth_call" request to simulate deploying a contract with `to` field being empty/undefined', async () => {
        const callData = {
          from: accounts[0].address,
          data: basicContractJson.bytecode,
        };
        const res = await client.call(METHOD_NAME, [callData, 'latest']);
        expect(res).to.eq(basicContractJson.deployedBytecode);
      });

      it('should fail "eth_call" request without data field', async () => {
        const callData = {
          from: accounts[0].address,
          to: basicContractAddress,
          gas: numberTo0x(30000),
        };

        const res = await client.call(METHOD_NAME, [callData, 'latest']);
        expect(res).to.eq('0x');
      });

      it('"eth_call" for non-existing contract address returns 0x', async () => {
        const callData = {
          from: accounts[0].address,
          to: Address.NON_EXISTING_ADDRESS,
          gas: numberTo0x(30000),
          data: BASIC_CONTRACT_PING_CALL_DATA,
        };

        const res = await client.call(METHOD_NAME, [callData, 'latest']);
        expect(res).to.eq('0x');
      });

      it('should execute "eth_call" without from field', async () => {
        const callData = {
          to: basicContractAddress,
          gas: numberTo0x(30000),
          data: BASIC_CONTRACT_PING_CALL_DATA,
        };

        const res = await client.call(METHOD_NAME, [callData, 'latest']);
        expect(res).to.eq(BASIC_CONTRACT_PING_RESULT);
      });

      it('should execute "eth_call" without gas field', async () => {
        const callData = {
          from: accounts[0].address,
          to: basicContractAddress,
          data: BASIC_CONTRACT_PING_CALL_DATA,
        };

        const res = await client.call(METHOD_NAME, [callData, 'latest']);
        expect(res).to.eq(BASIC_CONTRACT_PING_RESULT);
      });

      it('should execute "eth_call" with correct block number', async () => {
        const callData = {
          from: accounts[0].address,
          to: basicContractAddress,
          data: BASIC_CONTRACT_PING_CALL_DATA,
        };

        const block = numberTo0x(deploymentBlockNumber);
        const res = await client.call(METHOD_NAME, [callData, block]);
        expect(res).to.eq(BASIC_CONTRACT_PING_RESULT);
      });

      it('should execute "eth_call" with incorrect block number, SC should not exist yet', async () => {
        const callData = {
          from: accounts[0].address,
          to: basicContractAddress,
          data: BASIC_CONTRACT_PING_CALL_DATA,
        };

        const block = numberTo0x(deploymentBlockNumber - 1);
        const res = await client.call(METHOD_NAME, [callData, block]);
        expect(res).to.eq('0x');
      });

      it('should execute "eth_call" with incorrect block number as an object, SC should not exist yet', async () => {
        const callData = {
          from: accounts[0].address,
          to: basicContractAddress,
          data: BASIC_CONTRACT_PING_CALL_DATA,
        };

        const block = numberTo0x(deploymentBlockNumber - 1);
        const res = await client.call(METHOD_NAME, [callData, { blockNumber: block }]);
        expect(res).to.eq('0x');
      });

      it('should execute "eth_call" with incorrect block hash object, SC should not exist yet', async () => {
        const callData = {
          from: accounts[0].address,
          to: basicContractAddress,
          data: BASIC_CONTRACT_PING_CALL_DATA,
        };

        const blockNumber = deploymentBlockNumber - 1;
        const nextBlockHash = (await mirrorNode.get(`/blocks/${blockNumber}`)).hash;
        const truncatedHash = nextBlockHash.slice(0, 66);

        const res = await client.call(METHOD_NAME, [callData, { blockHash: truncatedHash }]);
        expect(res).to.eq('0x');
      });

      it('should execute "eth_call" with correct block hash object', async () => {
        const callData = {
          from: accounts[0].address,
          to: basicContractAddress,
          data: BASIC_CONTRACT_PING_CALL_DATA,
        };

        const truncatedHash = deploymentBlockHash.slice(0, 66);
        const res = await client.call(METHOD_NAME, [callData, { blockHash: truncatedHash }]);
        expect(res).to.eq(BASIC_CONTRACT_PING_RESULT);
      });

      it('should execute "eth_call" with correct block number object', async () => {
        const callData = {
          from: accounts[0].address,
          to: basicContractAddress,
          data: BASIC_CONTRACT_PING_CALL_DATA,
        };

        const block = numberTo0x(deploymentBlockNumber);
        const res = await client.call(METHOD_NAME, [callData, { blockNumber: block }]);
        expect(res).to.eq(BASIC_CONTRACT_PING_RESULT);
      });

      it('should execute "eth_call" with both data and input fields', async () => {
        const callData = {
          from: accounts[0].address,
          to: basicContractAddress,
          data: BASIC_CONTRACT_PING_CALL_DATA,
          input: BASIC_CONTRACT_PING_CALL_DATA,
        };

        const block = numberTo0x(deploymentBlockNumber);
        const res = await client.call(METHOD_NAME, [callData, { blockNumber: block }]);
        expect(res).to.eq(BASIC_CONTRACT_PING_RESULT);
      });

      it('should fail to execute "eth_call" with wrong block tag', async () => {
        const callData = {
          from: accounts[0].address,
          to: basicContractAddress,
          data: BASIC_CONTRACT_PING_CALL_DATA,
        };
        const errorType = predefined.INVALID_PARAMETER(1, `${ERROR_MESSAGE_PREFIXED_STR}, value: newest`);

        const response = await client.callRaw(METHOD_NAME, [callData, 'newest']);
        expectRpcError(response, errorType, false);
      });

      it('should fail to execute "eth_call" with wrong block number', async () => {
        const callData = {
          from: accounts[0].address,
          to: basicContractAddress,
          data: BASIC_CONTRACT_PING_CALL_DATA,
        };
        const errorType = predefined.INVALID_PARAMETER(1, `${ERROR_MESSAGE_PREFIXED_STR}, value: 123`);

        const response = await client.callRaw(METHOD_NAME, [callData, '123']);
        expectRpcError(response, errorType, false);
      });

      it('should fail to execute "eth_call" with wrong block hash object', async () => {
        const callData = {
          from: accounts[0].address,
          to: basicContractAddress,
          data: BASIC_CONTRACT_PING_CALL_DATA,
        };
        const errorType = predefined.INVALID_PARAMETER(
          `'blockHash' for BlockHashObject`,
          'Expected 0x prefixed string representing the hash (32 bytes) of a block, value: 0x123',
        );

        const response = await client.callRaw(METHOD_NAME, [callData, { blockHash: '0x123' }]);
        expectRpcError(response, errorType, false);
      });

      it('should fail to execute "eth_call" with wrong block number object', async () => {
        const callData = {
          from: accounts[0].address,
          to: basicContractAddress,
          data: BASIC_CONTRACT_PING_CALL_DATA,
        };
        const errorType = predefined.INVALID_PARAMETER(
          `'blockNumber' for BlockNumberObject`,
          `Expected 0x prefixed hexadecimal block number, or the string "latest", "earliest" or "pending", value: invalid_block_number`,
        );

        const response = await client.callRaw(METHOD_NAME, [callData, { blockNumber: 'invalid_block_number' }]);
        expectRpcError(response, errorType, false);
      });

      describe('Caller contract', () => {
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
              const callerContract = await Utils.deployContract(
                callerContractJson.abi,
                callerContractJson.bytecode,
                activeAccount.wallet,
              );
              const callerMirror = await mirrorNode.get(`/contracts/${callerContract.target}`);

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
              const callerContract = (await Utils.deployContractWithEthers(
                [],
                callerContractJson,
                activeAccount.wallet,
                relay,
              )) as ethers.Contract;
              const callerMirror = await mirrorNode.get(`/contracts/${callerContract.target}`);
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

            it('001 Should call pureMultiply', async () => {
              const callData = {
                ...defaultCallData,
                data: '0x0ec1551d',
              };

              const res = await client.call(METHOD_NAME, [callData, 'latest']);
              expect(res).to.eq('0x0000000000000000000000000000000000000000000000000000000000000004');
            });

            it('002 Should call msgSender', async () => {
              const callData = {
                ...defaultCallData,
                data: '0xd737d0c7',
              };

              const res = await client.call(METHOD_NAME, [callData, 'latest']);
              expect(res).to.eq(`0x${activeAccountAddress.padStart(64, '0')}`);
            });

            it('003 Should call txOrigin', async () => {
              const callData = {
                ...defaultCallData,
                data: '0xf96757d1',
              };

              const res = await client.call(METHOD_NAME, [callData, 'latest']);
              expect(res).to.eq(`0x${activeAccountAddress.padStart(64, '0')}`);
            });

            it('004 Should call msgSig', async () => {
              const callData = {
                ...defaultCallData,
                data: '0xec3e88cf',
              };

              const res = await client.call(METHOD_NAME, [callData, 'latest']);
              expect(res).to.eq('0xec3e88cf00000000000000000000000000000000000000000000000000000000');
            });

            it('005 Should call addressBalance', async () => {
              const callData = {
                ...defaultCallData,
                data: '0x0ec1551d',
              };

              const res = await client.call(METHOD_NAME, [callData, 'latest']);
              expect(res).to.eq('0x0000000000000000000000000000000000000000000000000000000000000004');
            });

            it("006 'data' from request body with wrong method signature", async () => {
              const callData = {
                ...defaultCallData,
                data: '0x3ec4de3800000000000000000000000067d8d32e9bf1a9968a5ff53b87d777aa8ebbee69',
              };

              const response = await client.callRaw(METHOD_NAME, [callData, 'latest']);
              if (response.status !== undefined) {
                expect(response.status).to.equal(200);
              }
              expect(response.error).to.exist;
              expect(response.error!.code).to.eq(predefined.CONTRACT_REVERT().code);
              expect(response.error!.message).to.contain('CONTRACT_REVERT_EXECUTED');
              expect(response.error!.name).to.be.undefined;
            });

            it("007 'data' from request body with wrong encoded parameter", async () => {
              const callData = {
                ...defaultCallData,
                data: '0x3ec4de350000000000000000000000000000000000000000000000000000000000000000',
              };

              const res = await client.call(METHOD_NAME, [callData, 'latest']);
              expect(res).to.eq('0x0000000000000000000000000000000000000000000000000000000000000000');
            });

            it("008 should work for missing 'from' field", async () => {
              const callData = {
                to: callerAddress,
                data: '0x0ec1551d',
              };

              const res = await client.call(METHOD_NAME, [callData, 'latest']);
              expect(res).to.eq('0x0000000000000000000000000000000000000000000000000000000000000004');
            });

            it("009 should work for missing 'to' field", async () => {
              const callData = {
                from: accounts[0].address,
                data: basicContractJson.bytecode,
              };

              const res = await client.call(METHOD_NAME, [callData, 'latest']);
              expect(res).to.eq(basicContractJson.deployedBytecode);
            });

            it('010 Should call msgValue', async () => {
              const callData = {
                ...defaultCallData,
                data: '0xddf363d7',
                value: ONE_THOUSAND_TINYBARS,
              };

              const res = await client.call(METHOD_NAME, [callData, 'latest']);
              expect(res).to.eq('0x00000000000000000000000000000000000000000000000000000000000003e8');
            });

            it("012 should work for wrong 'from' field", async () => {
              const callData = {
                from: '0x0000000000000000000000000000000000000000',
                to: callerAddress,
                data: '0x0ec1551d',
              };

              const res = await client.call(METHOD_NAME, [callData, 'latest']);
              expect(res).to.eq('0x0000000000000000000000000000000000000000000000000000000000000004');
            });
          });
        }
      });

      describe('Get revert details via eth_call for', async () => {
        async function sendAndRevertCall({ value = 0, data }: { value?: string | number; data: string }) {
          const signedTx = await accounts[0].wallet.signTransaction({
            value,
            gasLimit: '0x186a0', // 100_000
            chainId: Number(CHAIN_ID),
            to: reverterEvmAddress,
            nonce: await relay.getAccountNonce(accounts[0].address),
            maxFeePerGas: await relay.gasPrice(),
            data,
          });
          const txHash = await relay.sendRawTransaction(signedTx);
          const receipt = await relay.pollForValidTransactionReceipt(txHash);

          const response = await client.callRaw(METHOD_NAME, [
            {
              from: receipt.from,
              to: receipt.to,
              data,
            },
            receipt.blockNumber,
          ]);

          expect(response.error).to.exist;
          return response.error as { code: number; message: string; data: string };
        }

        it('revert: payable function', async () => {
          const err = await sendAndRevertCall({
            value: ONE_TINYBAR,
            data: '0xd0efd7ef', // revertPayable()
          });

          expect(err.code).to.equal(3);
          expect(err.message).to.include('RevertReasonPayable');
          expect(err.data).to.include('08c379a0');
          expect(err.data).to.include('526576657274526561736f6e50617961626c65');
        });

        it('revert: empty revert()', async () => {
          const err = await sendAndRevertCall({
            data: '0xfe0a3dd7', // revertWithNothing()
          });

          expect(err.code).to.equal(3);
          expect(err.message).to.include('CONTRACT_REVERT_EXECUTED');
          expect(err.data).to.equal('0x');
        });

        it('revert: require(false, "Some revert message")', async () => {
          const err = await sendAndRevertCall({
            data: '0x0323d234', // revertWithString()
          });

          expect(err.code).to.equal(3);
          expect(err.message).to.include('Some revert message');
          expect(err.data).to.include('08c379a0');
          expect(err.data).to.include('536f6d6520726576657274206d657373616765');
        });

        it('revert: custom error', async () => {
          const err = await sendAndRevertCall({
            data: '0x46fc4bb1', // revertWithCustomError()
          });

          expect(err.code).to.equal(3);
          expect(err.message).to.include('CONTRACT_REVERT_EXECUTED');
          expect(err.data).to.include('0bd3d39c');
        });

        it('revert: panic error', async () => {
          const err = await sendAndRevertCall({
            data: '0x33fe3fbd', // revertWithPanic()
          });

          expect(err.code).to.equal(3);
          expect(err.message).to.include('CONTRACT_REVERT_EXECUTED');
          expect(err.data).to.include('4e487b71');
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

          const response = await client.callRaw(METHOD_NAME, [callData, 'latest']);
          expectRpcError(response, predefined.CONTRACT_REVERT(PURE_METHOD_ERROR_MESSAGE, PURE_METHOD_ERROR_DATA));
          expect((response.error as any).data).to.eq(PURE_METHOD_ERROR_DATA);
        });

        it('Returns revert message for view methods', async () => {
          const callData = {
            from: accounts[0].address,
            to: reverterEvmAddress,
            gas: numberTo0x(30000),
            data: VIEW_METHOD_CALL_DATA,
          };

          const response = await client.callRaw(METHOD_NAME, [callData, 'latest']);
          expectRpcError(response, predefined.CONTRACT_REVERT(VIEW_METHOD_ERROR_MESSAGE, VIEW_METHOD_ERROR_DATA));
          expect((response.error as any).data).to.eq(VIEW_METHOD_ERROR_DATA);
        });

        describe('eth_call for reverted pure contract calls', async function () {
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
            it(`Pure method ${element.method} returns tx receipt`, async () => {
              const callData = {
                from: accounts[0].address,
                to: reverterEvmAddress,
                gas: numberTo0x(30000),
                data: element.data,
              };

              const response = await client.callRaw(METHOD_NAME, [callData, 'latest']);
              expectRpcError(response, predefined.CONTRACT_REVERT(element.message, element.errorData));
              expect((response.error as any).data).to.eq(element.errorData);
            });
          }
        });
      });
    });
  }
});
