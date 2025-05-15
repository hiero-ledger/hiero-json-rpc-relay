// SPDX-License-Identifier: Apache-2.0

// External resources
import { RequestDetails } from '@hashgraph/json-rpc-relay/dist/lib/types';
import { expect } from 'chai';
import { ethers } from 'ethers';

// Constants from local resources
import Constants from '../../tests/helpers/constants';
import MirrorClient from '../clients/mirrorClient';
import RelayClient from '../clients/relayClient';
import ServicesClient from '../clients/servicesClient';
import BaseHTSJson from '../contracts/contracts_v1/BaseHTS.json';
import { Utils } from '../helpers/utils';
// Local resources
import { AliasAccount } from '../types/AliasAccount';

describe('@htsprecompilev1 HTS Precompile V1 Acceptance Tests', async function () {
  this.timeout(240 * 1000); // 240 seconds

  // @ts-ignore
  const {
    servicesNode,
    relay,
    mirrorNode,
  }: { servicesNode: ServicesClient; relay: RelayClient; mirrorNode: MirrorClient } = global;

  const requestDetails = new RequestDetails({ requestId: 'htsPrecompile_v1Test', ipAddress: '0.0.0.0' });

  const TX_SUCCESS_CODE = BigInt(22);

  const accounts: AliasAccount[] = [];
  let BaseHTSContractAddress;
  let HTSTokenContractAddress;
  let NftHTSTokenContractAddress;
  let baseHTSContract;
  let baseHTSContractOwner;
  let baseHTSContractReceiverWalletFirst;
  let baseHTSContractReceiverWalletSecond;
  let HTSTokenWithCustomFeesContractAddress;

  this.beforeAll(async () => {
    const initialAccount: AliasAccount = global.accounts[0];
    const initialAmount: string = '5000000000'; //50 Hbar

    const contractDeployer = await Utils.createAliasAccount(
      mirrorNode,
      initialAccount,
      requestDetails.requestId,
      initialAmount,
    );
    const BaseHTSContract = await Utils.deployContract(BaseHTSJson.abi, BaseHTSJson.bytecode, contractDeployer.wallet);
    BaseHTSContractAddress = BaseHTSContract.target;
    const contractMirror = await mirrorNode.get(`/contracts/${BaseHTSContractAddress}`, requestDetails.requestId);

    accounts[0] = await servicesNode.createAccountWithContractIdKey(
      contractMirror.contract_id,
      70,
      relay.provider,
      requestDetails.requestId,
    );
    accounts[1] = await servicesNode.createAccountWithContractIdKey(
      contractMirror.contract_id,
      25,
      relay.provider,
      requestDetails.requestId,
    );
    accounts[2] = await servicesNode.createAccountWithContractIdKey(
      contractMirror.contract_id,
      25,
      relay.provider,
      requestDetails.requestId,
    );

    // allow mirror node a 2 full record stream write windows (2 sec) and a buffer to persist setup details
    await new Promise((r) => setTimeout(r, 5000));

    baseHTSContract = new ethers.Contract(BaseHTSContractAddress, BaseHTSJson.abi, accounts[0].wallet);

    baseHTSContractOwner = baseHTSContract;
    baseHTSContractReceiverWalletFirst = baseHTSContract.connect(accounts[1].wallet);
    baseHTSContractReceiverWalletSecond = baseHTSContract.connect(accounts[2].wallet);
  });

  async function createHTSToken() {
    const baseHTSContract = new ethers.Contract(BaseHTSContractAddress, BaseHTSJson.abi, accounts[0].wallet);
    const tx = await baseHTSContract.createFungibleTokenPublic(accounts[0].wallet.address, {
      value: BigInt('10000000000000000000'),
      gasLimit: 1_000_000,
    });
    const { tokenAddress } = (await tx.wait()).logs.filter(
      (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.CreatedToken,
    )[0].args;

    return tokenAddress;
  }

  async function createNftHTSToken() {
    const baseHTSContract = new ethers.Contract(BaseHTSContractAddress, BaseHTSJson.abi, accounts[0].wallet);
    const tx = await baseHTSContract.createNonFungibleTokenPublic(accounts[0].wallet.address, {
      value: BigInt('10000000000000000000'),
      gasLimit: 1_000_000,
    });
    const { tokenAddress } = (await tx.wait()).logs.filter(
      (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.CreatedToken,
    )[0].args;

    return tokenAddress;
  }

  async function createHTSTokenWithCustomFees() {
    const baseHTSContract = new ethers.Contract(BaseHTSContractAddress, BaseHTSJson.abi, accounts[0].wallet);
    const tx = await baseHTSContract.createFungibleTokenWithCustomFeesPublic(
      accounts[0].wallet.address,
      HTSTokenContractAddress,
      {
        value: BigInt('20000000000000000000'),
        gasLimit: 1_000_000,
      },
    );
    const txReceipt = await tx.wait();
    const { tokenAddress } = txReceipt.logs.filter(
      (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.CreatedToken,
    )[0].args;

    return tokenAddress;
  }

  it('should create associate to a fungible token', async function () {
    HTSTokenContractAddress = await createHTSToken();

    const txCO = await baseHTSContractOwner.associateTokenPublic(
      BaseHTSContractAddress,
      HTSTokenContractAddress,
      Constants.GAS.LIMIT_1_000_000,
    );
    expect(
      (await txCO.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
        .responseCode,
    ).to.equal(TX_SUCCESS_CODE);

    const txRWF = await baseHTSContractReceiverWalletFirst.associateTokenPublic(
      accounts[1].wallet.address,
      HTSTokenContractAddress,
      Constants.GAS.LIMIT_1_000_000,
    );
    expect(
      (await txRWF.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
        .responseCode,
    ).to.equal(TX_SUCCESS_CODE);

    const txRWS = await baseHTSContractReceiverWalletSecond.associateTokenPublic(
      accounts[2].wallet.address,
      HTSTokenContractAddress,
      Constants.GAS.LIMIT_1_000_000,
    );
    expect(
      (await txRWS.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
        .responseCode,
    ).to.equal(TX_SUCCESS_CODE);
  });

  it('should create and associate to an nft', async function () {
    NftHTSTokenContractAddress = await createNftHTSToken();

    const txCO = await baseHTSContractOwner.associateTokenPublic(
      BaseHTSContractAddress,
      NftHTSTokenContractAddress,
      Constants.GAS.LIMIT_1_000_000,
    );
    expect(
      (await txCO.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
        .responseCode,
    ).to.equal(TX_SUCCESS_CODE);

    const txRWF = await baseHTSContractReceiverWalletFirst.associateTokenPublic(
      accounts[1].wallet.address,
      NftHTSTokenContractAddress,
      Constants.GAS.LIMIT_1_000_000,
    );
    expect(
      (await txRWF.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
        .responseCode,
    ).to.equal(TX_SUCCESS_CODE);

    const txRWS = await baseHTSContractReceiverWalletSecond.associateTokenPublic(
      accounts[2].wallet.address,
      NftHTSTokenContractAddress,
      Constants.GAS.LIMIT_1_000_000,
    );
    expect(
      (await txRWS.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
        .responseCode,
    ).to.equal(TX_SUCCESS_CODE);
  });

  it('should create and associate to a fungible token with custom fees', async function () {
    HTSTokenWithCustomFeesContractAddress = await createHTSTokenWithCustomFees();

    const baseHTSContractOwner = new ethers.Contract(BaseHTSContractAddress, BaseHTSJson.abi, accounts[0].wallet);
    const txCO = await baseHTSContractOwner.associateTokenPublic(
      BaseHTSContractAddress,
      HTSTokenWithCustomFeesContractAddress,
      Constants.GAS.LIMIT_1_000_000,
    );
    expect(
      (await txCO.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
        .responseCode,
    ).to.equal(TX_SUCCESS_CODE);

    const baseHTSContractReceiverWalletFirst = new ethers.Contract(
      BaseHTSContractAddress,
      BaseHTSJson.abi,
      accounts[1].wallet,
    );
    const txRWF = await baseHTSContractReceiverWalletFirst.associateTokenPublic(
      accounts[1].wallet.address,
      HTSTokenWithCustomFeesContractAddress,
      Constants.GAS.LIMIT_1_000_000,
    );
    expect(
      (await txRWF.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
        .responseCode,
    ).to.equal(TX_SUCCESS_CODE);

    const baseHTSContractReceiverWalletSecond = new ethers.Contract(
      BaseHTSContractAddress,
      BaseHTSJson.abi,
      accounts[2].wallet,
    );
    const txRWS = await baseHTSContractReceiverWalletSecond.associateTokenPublic(
      accounts[2].wallet.address,
      HTSTokenWithCustomFeesContractAddress,
      Constants.GAS.LIMIT_1_000_000,
    );
    expect(
      (await txRWS.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
        .responseCode,
    ).to.equal(TX_SUCCESS_CODE);
  });
});
