// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { ethers } from 'ethers';

import { predefined } from '../../src/relay';
import { numberTo0x } from '../../src/relay/formatters';
import Constants from '../../src/relay/lib/constants';
import MirrorClient from '../server/clients/mirrorClient';
import RelayClient from '../server/clients/relayClient';
import basicContractJson from '../server/contracts/Basic.json';
import reverterContractJson from '../server/contracts/Reverter.json';
import { Utils } from '../server/helpers/utils';
import { AliasAccount } from '../server/types/AliasAccount';
import { ALL_PROTOCOL_CLIENTS } from './helpers/protocolClient';

describe('@release @protocol-acceptance eth_estimateGas', async function () {
  this.timeout(240 * 1000);
  const METHOD_NAME = 'eth_estimateGas';

  const BASIC_CONTRACT_PING_CALL_DATA = '0x5c36b186';
  const PING_CALL_ESTIMATED_GAS = '0x6122';
  const NON_EXISTENT_ACCOUNT = '0x114f60009ee6b84861c0cdae8829751e517bc4d7';
  // Function selectors on the Reverter contract
  const REVERT_WITH_STRING_CALL_DATA = '0x0323d234';
  const REVERT_WITH_CUSTOM_ERROR_CALL_DATA = '0x46fc4bb1';
  const REVERT_WITH_PANIC_CALL_DATA = '0x33fe3fbd';
  const REVERT_WITH_NOTHING_CALL_DATA = '0xfe0a3dd7';

  // @ts-ignore
  const { mirrorNode, relay }: { mirrorNode: MirrorClient; relay: RelayClient } = global;

  const accounts: AliasAccount[] = [];
  let basicContractAddress: string;
  let reverterContractAddress: string;

  before(async () => {
    accounts.push(...(await Utils.createMultipleAliasAccounts(mirrorNode, global.accounts[0], 2, '2500000000')));
    global.accounts.push(...accounts);

    const basic = await Utils.deployContract(basicContractJson.abi, basicContractJson.bytecode, accounts[0].wallet);
    basicContractAddress = basic.target as string;

    const reverter = await Utils.deployContract(
      reverterContractJson.abi,
      reverterContractJson.bytecode,
      accounts[0].wallet,
    );
    reverterContractAddress = reverter.target as string;
  });

  after(async () => {
    if (global?.socketServer) {
      expect(global.socketServer._connections).to.eq(0);
    }
  });

  for (const client of ALL_PROTOCOL_CLIENTS) {
    describe(client.label, () => {
      it('@release-light, @release should execute "eth_estimateGas" with empty object and throw error', async () => {
        const response = await client.callRaw(METHOD_NAME, [{}]);
        expect(response.error).to.exist;
        expect(response.error!.code).to.eq(-32000);
        expect(response.error!.message).to.include('Error occurred during transaction simulation');
      });

      it('@release should execute "eth_estimateGas" for contract call', async () => {
        const currentPrice = await relay.gasPrice();
        const expectedGas = parseInt(PING_CALL_ESTIMATED_GAS, 16);

        const gasPriceDeviation = parseFloat(expectedGas.toString() ?? '0.2');

        const estimatedGas = (await client.call(METHOD_NAME, [
          {
            to: basicContractAddress,
            from: accounts[0].address,
            data: BASIC_CONTRACT_PING_CALL_DATA,
          },
        ])) as string;
        expect(estimatedGas).to.contain('0x');
        // handle deviation in gas price
        expect(parseInt(estimatedGas)).to.be.lessThan(currentPrice * (1 + gasPriceDeviation));
        expect(parseInt(estimatedGas)).to.be.greaterThan(currentPrice * (1 - gasPriceDeviation));
      });

      it('@release should execute "eth_estimateGas" for existing account', async () => {
        const res = (await client.call(METHOD_NAME, [
          {
            from: accounts[0].address,
            to: accounts[1].address,
            value: '0x1',
          },
        ])) as string;
        const gasTxBaseCost = numberTo0x(Constants.TX_BASE_COST);
        const gasPriceDeviation = parseFloat((Number(gasTxBaseCost) * 0.2).toString());
        expect(res).to.contain('0x');
        expect(parseInt(res)).to.be.lessThan(Number(gasTxBaseCost) * (1 + gasPriceDeviation));
        expect(parseInt(res)).to.be.greaterThan(Number(gasTxBaseCost) * (1 - gasPriceDeviation));
      });

      it('@release should execute "eth_estimateGas" hollow account creation', async () => {
        const hollowAccount = ethers.Wallet.createRandom();
        const minGasTxHollowAccountCreation = numberTo0x(Constants.MIN_TX_HOLLOW_ACCOUNT_CREATION_GAS);

        const res = (await client.call(METHOD_NAME, [
          {
            from: accounts[0].address,
            to: hollowAccount.address,
            value: '0x1',
          },
        ])) as string;
        expect(res).to.contain('0x');
        expect(Number(res)).to.be.greaterThanOrEqual(Number(minGasTxHollowAccountCreation));
      });

      it('should execute "eth_estimateGas" with to, from, value and gas field', async () => {
        const res = (await client.call(METHOD_NAME, [
          {
            from: accounts[0].address,
            to: accounts[1].address,
            value: '0x1',
            gas: '0xd97010',
          },
        ])) as string;
        expect(res).to.contain('0x');
        expect(res).to.not.be.equal('0x');
        expect(res).to.not.be.equal('0x0');
      });

      it('should execute "eth_estimateGas" with to, from, value, accessList and gas field', async () => {
        const res = (await client.call(METHOD_NAME, [
          {
            from: accounts[0].address,
            to: accounts[1].address,
            value: '0x1',
            gas: '0xd97010',
            accessList: [],
          },
        ])) as string;
        expect(res).to.contain('0x');
        expect(res).to.not.be.equal('0x');
        expect(res).to.not.be.equal('0x0');
      });

      it('should execute "eth_estimateGas" with `to` field set to null (deployment transaction)', async () => {
        // Use the Basic contract bytecode for a valid deployment transaction
        const res = (await client.call(METHOD_NAME, [
          {
            from: accounts[0].address,
            to: null,
            data: basicContractJson.bytecode,
          },
        ])) as string;
        expect(res).to.contain('0x');
        expect(res).to.not.be.equal('0x');
        expect(res).to.not.be.equal('0x0');
      });

      it('should not be able to execute "eth_estimateGas" with no transaction object', async () => {
        const expected = predefined.MISSING_REQUIRED_PARAMETER(0);
        const response = await client.callRaw(METHOD_NAME, []);
        expect(response.error).to.exist;
        expect(response.error!.code).to.eq(expected.code);
        expect(response.error!.message).to.include(expected.message);
      });

      it('should not be able to execute "eth_estimateGas" with wrong from field', async () => {
        const expected = predefined.INVALID_PARAMETER(
          `'from' for TransactionObject`,
          `Expected 0x prefixed string representing the address (20 bytes), value: 0x114f60009ee6b84861c0cdae8829751e517b`,
        );
        const response = await client.callRaw(METHOD_NAME, [
          {
            from: '0x114f60009ee6b84861c0cdae8829751e517b',
            to: '0xae410f34f7487e2cd03396499cebb09b79f45d6e',
            value: '0xa688906bd8b00000',
            gas: '0xd97010',
            accessList: [],
          },
        ]);
        expect(response.error).to.exist;
        expect(response.error!.code).to.eq(expected.code);
        expect(response.error!.message).to.include(expected.message);
      });

      it('should not be able to execute "eth_estimateGas" with wrong to field', async () => {
        const expected = predefined.INVALID_PARAMETER(
          `'to' for TransactionObject`,
          `Expected 0x prefixed string representing the address (20 bytes), value: 0xae410f34f7487e2cd03396499cebb09b79f45`,
        );
        const response = await client.callRaw(METHOD_NAME, [
          {
            from: NON_EXISTENT_ACCOUNT,
            to: '0xae410f34f7487e2cd03396499cebb09b79f45',
            value: '0xa688906bd8b00000',
            gas: '0xd97010',
            accessList: [],
          },
        ]);
        expect(response.error).to.exist;
        expect(response.error!.code).to.eq(expected.code);
        expect(response.error!.message).to.include(expected.message);
      });

      it('should not be able to execute "eth_estimateGas" with wrong value field', async () => {
        const expected = predefined.INVALID_PARAMETER(
          `'value' for TransactionObject`,
          `Expected 0x prefixed hexadecimal value, value: 123`,
        );
        const response = await client.callRaw(METHOD_NAME, [
          {
            from: NON_EXISTENT_ACCOUNT,
            to: '0xae410f34f7487e2cd03396499cebb09b79f45d6e',
            value: '123',
            gas: '0xd97010',
            accessList: [],
          },
        ]);
        expect(response.error).to.exist;
        expect(response.error!.code).to.eq(expected.code);
        expect(response.error!.message).to.include(expected.message);
      });

      it('should not be able to execute "eth_estimateGas" with wrong gas field', async () => {
        const expected = predefined.INVALID_PARAMETER(
          `'gas' for TransactionObject`,
          `Expected 0x prefixed hexadecimal value, value: 123`,
        );
        const response = await client.callRaw(METHOD_NAME, [
          {
            from: NON_EXISTENT_ACCOUNT,
            to: '0xae410f34f7487e2cd03396499cebb09b79f45d6e',
            value: '0xa688906bd8b00000',
            gas: '123',
            accessList: [],
          },
        ]);
        expect(response.error).to.exist;
        expect(response.error!.code).to.eq(expected.code);
        expect(response.error!.message).to.include(expected.message);
      });

      it('should execute "eth_estimateGas" with data as 0x instead of null', async () => {
        const res = (await client.call(METHOD_NAME, [
          {
            from: accounts[0].address,
            to: accounts[1].address,
            value: '0x1',
            gas: '0xd97010',
            data: '0x',
          },
        ])) as string;
        expect(res).to.contain('0x');
        expect(res).to.not.be.equal('0x');
        expect(res).to.not.be.equal('0x0');
      });

      it('should execute "eth_estimateGas" with input as 0x instead of data', async () => {
        const res = (await client.call(METHOD_NAME, [
          {
            from: accounts[0].address,
            to: accounts[1].address,
            value: '0x1',
            gas: '0xd97010',
            input: '0x',
          },
        ])) as string;
        expect(res).to.contain('0x');
        expect(res).to.not.be.equal('0x');
        expect(res).to.not.be.equal('0x0');
      });

      it('should execute "eth_estimateGas" with both input and data fields present in the txObject', async () => {
        const res = (await client.call(METHOD_NAME, [
          {
            from: accounts[0].address,
            to: accounts[1].address,
            value: '0x1',
            gas: '0xd97010',
            input: '0x',
            data: '0x',
          },
        ])) as string;
        expect(res).to.contain('0x');
        expect(res).to.not.be.equal('0x');
        expect(res).to.not.be.equal('0x0');
      });

      describe('Contract call reverts during gas estimation', async () => {
        it('should throw error when eth_estimateGas is called with a contract that reverts with string message', async () => {
          // With the new behavior, contract reverts should throw errors instead of returning predefined gas
          const expected = predefined.CONTRACT_REVERT('Some revert message');
          const response = await client.callRaw(METHOD_NAME, [
            {
              from: accounts[0].address,
              to: reverterContractAddress,
              data: REVERT_WITH_STRING_CALL_DATA,
            },
          ]);
          expect(response.error).to.exist;
          expect(response.error!.code).to.eq(expected.code);
          expect(response.error!.message).to.include(expected.message);
        });

        it('should throw error when eth_estimateGas is called with a contract that reverts with custom error', async () => {
          const expected = predefined.CONTRACT_REVERT();
          const response = await client.callRaw(METHOD_NAME, [
            {
              from: accounts[0].address,
              to: reverterContractAddress,
              data: REVERT_WITH_CUSTOM_ERROR_CALL_DATA,
            },
          ]);
          expect(response.error).to.exist;
          expect(response.error!.code).to.eq(expected.code);
          expect(response.error!.message).to.include(expected.message);
        });

        it('should throw error when eth_estimateGas is called with a contract that reverts with panic error', async () => {
          const expected = predefined.CONTRACT_REVERT();
          const response = await client.callRaw(METHOD_NAME, [
            {
              from: accounts[0].address,
              to: reverterContractAddress,
              data: REVERT_WITH_PANIC_CALL_DATA,
            },
          ]);
          expect(response.error).to.exist;
          expect(response.error!.code).to.eq(expected.code);
          expect(response.error!.message).to.include(expected.message);
        });

        it('should throw error when eth_estimateGas is called with a contract that reverts without message', async () => {
          const expected = predefined.CONTRACT_REVERT();
          const response = await client.callRaw(METHOD_NAME, [
            {
              from: accounts[0].address,
              to: reverterContractAddress,
              data: REVERT_WITH_NOTHING_CALL_DATA,
            },
          ]);
          expect(response.error).to.exist;
          expect(response.error!.code).to.eq(expected.code);
          expect(response.error!.message).to.include(expected.message);
        });
      });

      describe('Gas estimation errors (non-contract revert)', async () => {
        it('should throw COULD_NOT_SIMULATE_TRANSACTION error when sender account does not exist', async () => {
          const response = await client.callRaw(METHOD_NAME, [
            {
              from: NON_EXISTENT_ACCOUNT,
              to: basicContractAddress,
              data: BASIC_CONTRACT_PING_CALL_DATA,
            },
          ]);
          expect(response.error).to.exist;
          expect(response.error!.code).to.eq(-32000);
          expect(response.error!.message).to.include('Error occurred during transaction simulation');
          expect(response.error!.message).to.include('Sender account not found');
        });

        it('should throw COULD_NOT_SIMULATE_TRANSACTION error when "to" field is empty for contract call', async () => {
          const response = await client.callRaw(METHOD_NAME, [
            {
              from: accounts[0].address,
              data: BASIC_CONTRACT_PING_CALL_DATA,
            },
          ]);
          expect(response.error).to.exist;
          expect(response.error!.code).to.eq(-32000);
          expect(response.error!.message).to.include('Error occurred during transaction simulation');
        });

        it('should throw error when gas estimation fails with invalid transaction value', async () => {
          // Using a string that can't be converted to a valid hex value
          const response = await client.callRaw(METHOD_NAME, [
            {
              from: accounts[0].address,
              to: accounts[1].address,
              value: 'invalid_value',
            },
          ]);
          expect(response.error).to.exist;
        });
      });
    });
  }
});
