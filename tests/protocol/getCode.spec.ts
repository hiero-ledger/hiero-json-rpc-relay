// SPDX-License-Identifier: Apache-2.0

import { ContractId } from '@hashgraph/sdk';
import { expect } from 'chai';
import { ethers } from 'ethers';

import { numberTo0x } from '../../src/relay/formatters';
import { CommonService } from '../../src/relay/lib/services';
import MirrorClient from '../server/clients/mirrorClient';
import RelayClient from '../server/clients/relayClient';
import ServicesClient from '../server/clients/servicesClient';
import basicContractJson from '../server/contracts/Basic.json';
import TokenCreateJson from '../server/contracts/TokenCreateContract.json';
import Address from '../server/helpers/constants';
import Helper from '../server/helpers/constants';
import RelayCalls from '../server/helpers/constants';
import constants from '../server/helpers/constants';
import { Utils } from '../server/helpers/utils';
import { AliasAccount } from '../server/types/AliasAccount';
import { ALL_PROTOCOL_CLIENTS } from './helpers/protocolClient';

describe('@release @protocol-acceptance eth_getCode', async function () {
  this.timeout(240 * 1000);
  const METHOD_NAME = 'eth_getCode';

  // @ts-ignore
  const {
    mirrorNode,
    relay,
    servicesNode,
    initialBalance,
  }: {
    mirrorNode: MirrorClient;
    relay: RelayClient;
    servicesNode: ServicesClient;
    initialBalance: string;
  } = global;

  const accounts: AliasAccount[] = [];
  let basicContractAddress: string;
  let mainContractAddress: string;
  let NftHTSTokenContractAddress: string;
  let blockBeforeContractCreation: number;

  async function createNftHTSToken(account: AliasAccount): Promise<string> {
    const main = new ethers.Contract(mainContractAddress, TokenCreateJson.abi, accounts[0].wallet);
    const tx = await (main as any).createNonFungibleTokenPublic(account.wallet.address, {
      value: BigInt('30000000000000000000'),
      ...Helper.GAS.LIMIT_5_000_000,
    });
    const receipt = await tx.wait();
    await relay.pollForValidTransactionReceipt(receipt.hash);

    const { tokenAddress } = (receipt.logs as any[]).filter(
      (e) => e.fragment?.name === RelayCalls.HTS_CONTRACT_EVENTS.CreatedToken,
    )[0].args;

    return tokenAddress;
  }

  before(async () => {
    accounts.push(...(await Utils.createMultipleAliasAccounts(mirrorNode, global.accounts[0], 4, initialBalance)));
    global.accounts.push(...accounts);

    const basicContract = await Utils.deployContract(
      basicContractJson.abi,
      basicContractJson.bytecode,
      accounts[0].wallet,
    );
    basicContractAddress = basicContract.target as string;

    blockBeforeContractCreation = (await mirrorNode.get(`/blocks?limit=1&order=desc`)).blocks[0].number;

    const mainContract = await Utils.deployContract(TokenCreateJson.abi, TokenCreateJson.bytecode, accounts[3].wallet);
    mainContractAddress = mainContract.target as string;

    const accountWithContractIdKey = await servicesNode.createAccountWithContractIdKey(
      ContractId.fromEvmAddress(0, 0, mainContractAddress),
      60,
      relay.provider,
    );
    NftHTSTokenContractAddress = await createNftHTSToken(accountWithContractIdKey);
  });

  after(async () => {
    if (global?.socketServer) {
      expect(global.socketServer._connections).to.eq(0);
    }
  });

  for (const client of ALL_PROTOCOL_CLIENTS) {
    describe(client.label, () => {
      it('should execute "eth_getCode" for hts token', async () => {
        const res = (await client.call(METHOD_NAME, [NftHTSTokenContractAddress, 'latest'])) as string;
        expect(res).to.be.equal(CommonService.redirectBytecodeAddressReplace(NftHTSTokenContractAddress));
      });

      it('@release should return empty bytecode for HTS token when a block earlier than the token creation is passed', async () => {
        const earlierBlock = numberTo0x(blockBeforeContractCreation);
        const res = (await client.call(METHOD_NAME, [NftHTSTokenContractAddress, earlierBlock])) as string;
        expect(res).to.equal(constants.EMPTY_HEX);
      });

      it('@release should return empty bytecode for contract when a block earlier than the contract creation is passed', async () => {
        const earlierBlock = numberTo0x(blockBeforeContractCreation);
        const res = (await client.call(METHOD_NAME, [mainContractAddress, earlierBlock])) as string;
        expect(res).to.equal(constants.EMPTY_HEX);
      });

      it('@release should execute "eth_getCode" for contract evm_address', async () => {
        const res = (await client.call(METHOD_NAME, [basicContractAddress, 'latest'])) as string;
        expect(res).to.eq(basicContractJson.deployedBytecode);
      });

      // Fixed during migration: the HTTP original (rpc_batch2.spec.ts:358) was a copy-paste
      // bug that reused basicContractAddress without any id→evm conversion. Applying the
      // same ContractId.fromString pattern used by the sibling eth_getBalance test.
      it('@release should execute "eth_getCode" for contract with id converted to evm_address', async () => {
        const mirrorNodeContractRes = await mirrorNode.get(`/contracts/${basicContractAddress}`);
        const contractId = ContractId.fromString(mirrorNodeContractRes.contract_id);
        const res = (await client.call(METHOD_NAME, [`0x${contractId.toSolidityAddress()}`, 'latest'])) as string;
        expect(res).to.eq(basicContractJson.deployedBytecode);
      });

      it('should return 0x0 for non-existing contract on eth_getCode', async () => {
        const res = (await client.call(METHOD_NAME, [Address.NON_EXISTING_ADDRESS, 'latest'])) as string;
        expect(res).to.eq(constants.EMPTY_HEX);
      });

      it('should return 0x0 for account evm_address on eth_getCode', async () => {
        const evmAddress = Utils.idToEvmAddress(accounts[2].accountId.toString());
        const res = (await client.call(METHOD_NAME, [evmAddress, 'latest'])) as string;
        expect(res).to.eq(constants.EMPTY_HEX);
      });

      it('should return 0x0 for account alias on eth_getCode', async () => {
        const alias = Utils.idToEvmAddress(accounts[2].accountId.toString());
        const res = (await client.call(METHOD_NAME, [alias, 'latest'])) as string;
        expect(res).to.eq(constants.EMPTY_HEX);
      });

      // Issue # 2619 https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/2619
      // Refactor to consider HIP-868
      xit('should not return contract bytecode after sefldestruct', async () => {
        const bytecodeBefore = (await client.call(METHOD_NAME, [basicContractAddress, 'latest'])) as string;
        // When this test is un-skipped, re-add the selfdestruct call here using a fresh
        // ethers.Contract handle:
        //   const basic = new ethers.Contract(basicContractAddress, basicContractJson.abi, accounts[0].wallet);
        //   await (basic as any).destroy();
        // Skipped pending #2619 / HIP-868.
        const bytecodeAfter = (await client.call(METHOD_NAME, [basicContractAddress, 'latest'])) as string;
        expect(bytecodeAfter).to.not.eq(bytecodeBefore);
        expect(bytecodeAfter).to.eq('0x');
      });
    });
  }
});
