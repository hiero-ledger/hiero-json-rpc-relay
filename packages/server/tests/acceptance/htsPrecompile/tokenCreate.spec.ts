// SPDX-License-Identifier: Apache-2.0

// external resources
import relayConstants from '@hashgraph/json-rpc-relay/dist/lib/constants';
import { expect } from 'chai';
import { ethers } from 'ethers';

import ERC20MockJson from '../../contracts/ERC20Mock.json';
import ERC721MockJson from '../../contracts/ERC721Mock.json';
import TokenCreateJson from '../../contracts/TokenCreateContract.json';
import Assertions from '../../helpers/assertions';
import Constants from '../../helpers/constants';
import { Utils } from '../../helpers/utils';
import { AliasAccount } from '../../types/AliasAccount';

/**
 * Tests for:
 * allowance
 * approve
 * approveNFT
 * associateToken
 * createFungibleToken
 * createFungibleTokenWithCustomFees
 * createNonFungibleToken
 * cryptoTransfer
 * cryptoTransferToken
 * deleteToken
 * getFungibleTokenInfo
 * getNonFungibleTokenInfo
 * getTokenCustomFees
 * getTokenInfo
 * grantTokenKyc
 * isApprovedForAll
 * mintToken
 * revokeTokenKyc
 * setApprovalForAll
 */
describe('@tokencreate HTS Precompile Token Create Acceptance Tests', async function () {
  this.timeout(240 * 1000); // 240 seconds
  const { servicesNode, mirrorNode, relay }: any = global;

  const TX_SUCCESS_CODE = BigInt(22);
  const TOKEN_NAME = 'tokenName';
  const TOKEN_SYMBOL = 'tokenSymbol';
  const TOKEN_MAX_SUPPLY = BigInt(1000);
  const TOKEN_DECIMALS = BigInt(8);

  const accounts: AliasAccount[] = [];
  let mainContractAddress: string;
  let HTSTokenContractAddress: string;
  let NftHTSTokenContractAddress: string;
  let NftSerialNumber: number;
  let HTSTokenContract: ethers.Contract;
  let NFTokenContract: ethers.Contract;
  let mainContract: ethers.Contract;
  let mainContractOwner: ethers.Contract;
  let mainContractReceiverWalletFirst: ethers.Contract;
  let mainContractReceiverWalletSecond: ethers.Contract;
  let HTSTokenWithCustomFeesContractAddress: string;
  let requestId: string;

  before(async () => {
    requestId = Utils.generateRequestId();
    const initialAccount: AliasAccount = global.accounts[0];
    const initialAmount: string = '5000000000'; //50 Hbar

    const contractDeployer = await Utils.createAliasAccount(mirrorNode, initialAccount, requestId, initialAmount);
    mainContract = await Utils.deployContract(TokenCreateJson.abi, TokenCreateJson.bytecode, contractDeployer.wallet);
    mainContractAddress = mainContract.target as string;
    const mainContractMirror = await mirrorNode.get(`/contracts/${mainContractAddress}`, requestId);

    accounts[0] = await servicesNode.createAccountWithContractIdKey(
      mainContractMirror.contract_id,
      200,
      relay.provider,
      requestId,
    );
    accounts[1] = await servicesNode.createAccountWithContractIdKey(
      mainContractMirror.contract_id,
      30,
      relay.provider,
      requestId,
    );
    accounts[2] = await servicesNode.createAccountWithContractIdKey(
      mainContractMirror.contract_id,
      30,
      relay.provider,
      requestId,
    );

    // wait for mirror node to catch up continuing running tests
    await new Promise((r) => setTimeout(r, 5000));

    HTSTokenContractAddress = await createHTSToken();
    NftHTSTokenContractAddress = await createNftHTSToken();
    HTSTokenWithCustomFeesContractAddress = await createHTSTokenWithCustomFees();

    HTSTokenContract = new ethers.Contract(HTSTokenContractAddress, ERC20MockJson.abi, accounts[0].wallet);
    NFTokenContract = new ethers.Contract(NftHTSTokenContractAddress, ERC721MockJson.abi, accounts[0].wallet);
    mainContract = new ethers.Contract(mainContractAddress, TokenCreateJson.abi, accounts[0].wallet);

    mainContractOwner = mainContract;
    mainContractReceiverWalletFirst = mainContract.connect(accounts[1].wallet);
    mainContractReceiverWalletSecond = mainContract.connect(accounts[2].wallet);

    // wait for mirror node to catch up before running tests
    await new Promise((r) => setTimeout(r, 5000));
  });

  this.beforeEach(async () => {
    requestId = Utils.generateRequestId();
  });

  async function createHTSToken() {
    const mainContract = new ethers.Contract(mainContractAddress, TokenCreateJson.abi, accounts[0].wallet);
    const gasOptions = await Utils.gasOptions(requestId, 15_000_000);
    const tx = await mainContract.createFungibleTokenPublic(accounts[0].wallet.address, {
      value: BigInt('10000000000000000000'),
      ...gasOptions,
    });
    const { tokenAddress } = (await tx.wait()).logs.filter(
      (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.CreatedToken,
    )[0].args;

    return tokenAddress;
  }

  async function createNftHTSToken() {
    const mainContract = new ethers.Contract(mainContractAddress, TokenCreateJson.abi, accounts[0].wallet);
    const gasOptions = await Utils.gasOptions(requestId, 15_000_000);
    const tx = await mainContract.createNonFungibleTokenPublic(accounts[0].wallet.address, {
      value: BigInt('10000000000000000000'),
      ...gasOptions,
    });
    const { tokenAddress } = (await tx.wait()).logs.filter(
      (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.CreatedToken,
    )[0].args;

    return tokenAddress;
  }

  async function createHTSTokenWithCustomFees() {
    const mainContract = new ethers.Contract(mainContractAddress, TokenCreateJson.abi, accounts[0].wallet);
    const gasOptions = await Utils.gasOptions(requestId, 15_000_000);
    const tx = await mainContract.createFungibleTokenWithCustomFeesPublic(
      accounts[0].wallet.address,
      HTSTokenContractAddress,
      {
        value: BigInt('20000000000000000000'),
        ...gasOptions,
      },
    );
    const txReceipt = await tx.wait();
    const { tokenAddress } = txReceipt.logs.filter(
      (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.CreatedToken,
    )[0].args;

    return tokenAddress;
  }

  it('should associate to a token', async function () {
    const txCO = await mainContractOwner.associateTokenPublic(
      mainContractAddress,
      HTSTokenContractAddress,
      Constants.GAS.LIMIT_5_000_000,
    );
    expect(
      (await txCO.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
        .responseCode,
    ).to.equal(TX_SUCCESS_CODE);

    const txRWF = await mainContractReceiverWalletFirst.associateTokenPublic(
      accounts[1].wallet.address,
      HTSTokenContractAddress,
      Constants.GAS.LIMIT_5_000_000,
    );
    expect(
      (await txRWF.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
        .responseCode,
    ).to.equal(TX_SUCCESS_CODE);

    const txRWS = await mainContractReceiverWalletSecond.associateTokenPublic(
      accounts[2].wallet.address,
      HTSTokenContractAddress,
      Constants.GAS.LIMIT_5_000_000,
    );
    expect(
      (await txRWS.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
        .responseCode,
    ).to.equal(TX_SUCCESS_CODE);
  });

  it('should associate to a nft', async function () {
    const txCO = await mainContractOwner.associateTokenPublic(
      mainContractAddress,
      NftHTSTokenContractAddress,
      Constants.GAS.LIMIT_5_000_000,
    );
    expect(
      (await txCO.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
        .responseCode,
    ).to.equal(TX_SUCCESS_CODE);

    const txRWF = await mainContractReceiverWalletFirst.associateTokenPublic(
      accounts[1].wallet.address,
      NftHTSTokenContractAddress,
      Constants.GAS.LIMIT_5_000_000,
    );
    expect(
      (await txRWF.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
        .responseCode,
    ).to.equal(TX_SUCCESS_CODE);

    const txRWS = await mainContractReceiverWalletSecond.associateTokenPublic(
      accounts[2].wallet.address,
      NftHTSTokenContractAddress,
      Constants.GAS.LIMIT_5_000_000,
    );
    expect(
      (await txRWS.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
        .responseCode,
    ).to.equal(TX_SUCCESS_CODE);
  });

  it('should associate to a token with custom fees', async function () {
    const mainContractOwner = new ethers.Contract(mainContractAddress, TokenCreateJson.abi, accounts[0].wallet);
    const txCO = await mainContractOwner.associateTokenPublic(
      mainContractAddress,
      HTSTokenWithCustomFeesContractAddress,
      Constants.GAS.LIMIT_10_000_000,
    );
    expect(
      (await txCO.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
        .responseCode,
    ).to.equal(TX_SUCCESS_CODE);

    const mainContractReceiverWalletFirst = new ethers.Contract(
      mainContractAddress,
      TokenCreateJson.abi,
      accounts[1].wallet,
    );
    const txRWF = await mainContractReceiverWalletFirst.associateTokenPublic(
      accounts[1].wallet.address,
      HTSTokenWithCustomFeesContractAddress,
      Constants.GAS.LIMIT_10_000_000,
    );
    expect(
      (await txRWF.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
        .responseCode,
    ).to.equal(TX_SUCCESS_CODE);

    const mainContractReceiverWalletSecond = new ethers.Contract(
      mainContractAddress,
      TokenCreateJson.abi,
      accounts[2].wallet,
    );
    const txRWS = await mainContractReceiverWalletSecond.associateTokenPublic(
      accounts[2].wallet.address,
      HTSTokenWithCustomFeesContractAddress,
      Constants.GAS.LIMIT_10_000_000,
    );
    expect(
      (await txRWS.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
        .responseCode,
    ).to.equal(TX_SUCCESS_CODE);
  });

  it('should check initial balances', async function () {
    expect(await HTSTokenContract.balanceOf(accounts[0].wallet.address)).to.equal(BigInt(1000));
    expect(await HTSTokenContract.balanceOf(accounts[1].wallet.address)).to.equal(BigInt(0));
    expect(await HTSTokenContract.balanceOf(accounts[2].wallet.address)).to.equal(BigInt(0));
  });

  it('should be able to mint a nft', async function () {
    const tx = await mainContract.mintTokenPublic(
      NftHTSTokenContractAddress,
      0,
      ['0x01'],
      Constants.GAS.LIMIT_5_000_000,
    );
    const { responseCode } = (await tx.wait()).logs.filter(
      (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
    )[0].args;
    expect(responseCode).to.equal(TX_SUCCESS_CODE);

    const { serialNumbers } = (await tx.wait()).logs.filter(
      (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.MintedToken,
    )[0].args;
    NftSerialNumber = Number(serialNumbers[0]);
    expect(NftSerialNumber).to.be.greaterThan(0);
  });

  describe('HTS Precompile Approval Tests', async function () {
    //When we use approve from our mainContract, it always gives approval only from itself (mainContract is owner).
    it('should be able to approve anyone to spend tokens', async function () {
      const amount = BigInt(13);

      const txBefore = await mainContract.allowancePublic(
        HTSTokenContractAddress,
        mainContractAddress,
        accounts[2].wallet.address,
      );
      const beforeAmount = (await txBefore.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.AllowanceValue,
      )[0].args.amount;
      const { responseCode } = (await txBefore.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args;
      expect(responseCode).to.equal(TX_SUCCESS_CODE);

      // grant KYC
      {
        const grantKycTx = await mainContractOwner.grantTokenKycPublic(
          HTSTokenContractAddress,
          accounts[1].wallet.address,
          Constants.GAS.LIMIT_1_000_000,
        );
        const responseCodeGrantKyc = (await grantKycTx.wait()).logs.filter(
          (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
        )[0].args.responseCode;
        expect(responseCodeGrantKyc).to.equal(TX_SUCCESS_CODE);
      }
      {
        const grantKycTx = await mainContractOwner.grantTokenKycPublic(
          HTSTokenContractAddress,
          mainContract.target,
          Constants.GAS.LIMIT_1_000_000,
        );
        const responseCodeGrantKyc = (await grantKycTx.wait()).logs.filter(
          (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
        )[0].args.responseCode;
        expect(responseCodeGrantKyc).to.equal(TX_SUCCESS_CODE);
      }

      //Transfer some hbars to the contract address
      await mainContract.cryptoTransferTokenPublic(
        mainContract.target,
        HTSTokenContractAddress,
        amount,
        Constants.GAS.LIMIT_1_000_000,
      );
      await new Promise((r) => setTimeout(r, 5000));
      expect(await HTSTokenContract.balanceOf(mainContract.target)).to.equal(amount);
      expect(await HTSTokenContract.balanceOf(accounts[2].wallet.address)).to.be.equal(BigInt(0));

      //Give approval for account[2] to use HTSTokens which are owned by mainContract
      const approvalTx = await mainContract.approvePublic(
        HTSTokenContractAddress,
        accounts[2].wallet.address,
        amount,
        Constants.GAS.LIMIT_1_000_000,
      );
      const responseCodeApproval = (await approvalTx.wait()).logs.filter(
        (e) => e?.fragment?.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      expect(responseCodeApproval).to.equal(TX_SUCCESS_CODE);

      //Check if approval was given
      const txAfter = await mainContract.allowancePublic(
        HTSTokenContractAddress,
        mainContractAddress,
        accounts[2].wallet.address,
      );
      const afterAmount = (await txAfter.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.AllowanceValue,
      )[0].args.amount;
      expect(beforeAmount).to.equal(BigInt(0));
      expect(afterAmount).to.equal(amount);

      //transfer token which are owned by mainContract using signer account[2] with transferFrom to account[1]
      await HTSTokenContract.connect(accounts[2].wallet).transferFrom(
        mainContract.target,
        accounts[1].wallet.address,
        amount,
        Constants.GAS.LIMIT_1_000_000,
      );
      await new Promise((r) => setTimeout(r, 5000));
      expect(await HTSTokenContract.balanceOf(accounts[1].wallet.address)).to.be.equal(amount);

      {
        const revokeKycTx = await mainContractOwner.revokeTokenKycPublic(
          HTSTokenContractAddress,
          accounts[1].wallet.address,
          Constants.GAS.LIMIT_1_000_000,
        );
        const responseCodeRevokeKyc = (await revokeKycTx.wait()).logs.filter(
          (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
        )[0].args.responseCode;
        expect(responseCodeRevokeKyc).to.equal(TX_SUCCESS_CODE);
      }
      {
        const revokeKycTx = await mainContractOwner.revokeTokenKycPublic(
          HTSTokenContractAddress,
          mainContract.target,
          Constants.GAS.LIMIT_1_000_000,
        );
        const responseCodeRevokeKyc = (await revokeKycTx.wait()).logs.filter(
          (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
        )[0].args.responseCode;
        expect(responseCodeRevokeKyc).to.equal(TX_SUCCESS_CODE);
      }
    });

    it('should be able to execute setApprovalForAllPublic', async function () {
      const txBefore = await mainContract.isApprovedForAllPublic(
        NftHTSTokenContractAddress,
        mainContractAddress,
        accounts[1].wallet.address,
      );
      const txBeforeReceipt = await txBefore.wait();
      const beforeFlag = txBeforeReceipt.logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.Approved,
      )[0].args.approved;
      const responseCodeTxBefore = txBeforeReceipt.logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      expect(responseCodeTxBefore).to.equal(TX_SUCCESS_CODE);

      const tx = await mainContract.setApprovalForAllPublic(
        NftHTSTokenContractAddress,
        accounts[1].wallet.address,
        true,
        Constants.GAS.LIMIT_5_000_000,
      );
      const { responseCode } = (await tx.wait()).logs.filter(
        (e) => e?.fragment?.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args;
      expect(responseCode).to.equal(TX_SUCCESS_CODE);

      const txAfter = await mainContract.isApprovedForAllPublic(
        NftHTSTokenContractAddress,
        mainContractAddress,
        accounts[1].wallet.address,
      );
      const afterFlag = (await txAfter.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.Approved,
      )[0].args.approved;

      expect(beforeFlag).to.equal(false);
      expect(afterFlag).to.equal(true);
    });

    it('should be able to execute getApproved on nft', async function () {
      const tx = await mainContractReceiverWalletFirst.getApprovedPublic(
        NftHTSTokenContractAddress,
        NftSerialNumber,
        Constants.GAS.LIMIT_5_000_000,
      );
      const { responseCode } = (await tx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args;
      expect(responseCode).to.equal(TX_SUCCESS_CODE);

      const { approved } = (await tx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ApprovedAddress,
      )[0].args;
      expect(approved).to.equal(Constants.ZERO_HEX);
    });

    it('should be able to transfer nft with transferFrom', async function () {
      expect(await NFTokenContract.balanceOf(accounts[0].wallet.address)).to.equal(BigInt(1));
      expect(await NFTokenContract.balanceOf(accounts[1].wallet.address)).to.equal(BigInt(0));

      // grant KYC
      {
        const grantKycTx = await mainContractOwner.grantTokenKycPublic(
          NftHTSTokenContractAddress,
          accounts[0].wallet.address,
          Constants.GAS.LIMIT_1_000_000,
        );
        const responseCodeGrantKyc = (await grantKycTx.wait()).logs.filter(
          (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
        )[0].args.responseCode;
        expect(responseCodeGrantKyc).to.equal(TX_SUCCESS_CODE);
      }
      {
        const grantKycTx = await mainContractOwner.grantTokenKycPublic(
          NftHTSTokenContractAddress,
          accounts[1].wallet.address,
          Constants.GAS.LIMIT_1_000_000,
        );
        const responseCodeGrantKyc = (await grantKycTx.wait()).logs.filter(
          (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
        )[0].args.responseCode;
        expect(responseCodeGrantKyc).to.equal(TX_SUCCESS_CODE);
      }
      {
        const grantKycTx = await mainContractOwner.grantTokenKycPublic(
          NftHTSTokenContractAddress,
          mainContract.target,
          Constants.GAS.LIMIT_1_000_000,
        );
        const responseCodeGrantKyc = (await grantKycTx.wait()).logs.filter(
          (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
        )[0].args.responseCode;
        expect(responseCodeGrantKyc).to.equal(TX_SUCCESS_CODE);
      }

      //transfer NFT to contract address
      const tokenTransferList = [
        {
          token: `${NftHTSTokenContractAddress}`,
          transfers: [],
          nftTransfers: [
            {
              senderAccountID: `${accounts[0].wallet.address}`,
              receiverAccountID: `${mainContract.target}`,
              serialNumber: NftSerialNumber,
            },
          ],
        },
      ];
      const txXfer = await mainContract.cryptoTransferPublic(tokenTransferList);
      expect(
        (await txXfer.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
          .responseCode,
      ).to.equal(TX_SUCCESS_CODE);

      // delay
      await new Promise((r) => setTimeout(r, 5000));

      expect(await NFTokenContract.balanceOf(mainContract.target)).to.equal(BigInt(1));
      expect(await NFTokenContract.balanceOf(accounts[1].wallet.address)).to.equal(BigInt(0));
      expect(await NFTokenContract.balanceOf(accounts[2].wallet.address)).to.equal(BigInt(0));

      //approval for accounts[2] to use this NFT
      await mainContract.approveNFTPublic(
        NftHTSTokenContractAddress,
        accounts[2].address,
        NftSerialNumber,
        Constants.GAS.LIMIT_1_000_000,
      );
      await new Promise((r) => setTimeout(r, 5000));
      expect((await NFTokenContract.getApproved(NftSerialNumber)).toLowerCase()).to.be.oneOf([
        accounts[2].wallet.address.toLowerCase(),
        Utils.idToEvmAddress(accounts[2].accountId.toString()).toLowerCase(),
      ]);

      //transfer NFT to accounts[1] with accounts[2] as signer
      await NFTokenContract.connect(accounts[2].wallet).transferFrom(
        mainContract.target,
        accounts[1].wallet.address,
        NftSerialNumber,
        Constants.GAS.LIMIT_1_000_000,
      );
      await new Promise((r) => setTimeout(r, 5000));
      expect(await NFTokenContract.balanceOf(mainContract.target)).to.equal(BigInt(0));
      expect(await NFTokenContract.balanceOf(accounts[1].wallet.address)).to.equal(BigInt(1));

      // revoking kyc for the next tests
      {
        const revokeKycTx = await mainContractOwner.revokeTokenKycPublic(
          NftHTSTokenContractAddress,
          accounts[0].wallet.address,
          Constants.GAS.LIMIT_1_000_000,
        );
        const responseCodeRevokeKyc = (await revokeKycTx.wait()).logs.filter(
          (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
        )[0].args.responseCode;
        expect(responseCodeRevokeKyc).to.equal(TX_SUCCESS_CODE);
      }

      {
        const revokeKycTx = await mainContractOwner.revokeTokenKycPublic(
          NftHTSTokenContractAddress,
          accounts[1].wallet.address,
          Constants.GAS.LIMIT_1_000_000,
        );
        const responseCodeRevokeKyc = (await revokeKycTx.wait()).logs.filter(
          (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
        )[0].args.responseCode;
        expect(responseCodeRevokeKyc).to.equal(TX_SUCCESS_CODE);
      }

      {
        const revokeKycTx = await mainContractOwner.revokeTokenKycPublic(
          NftHTSTokenContractAddress,
          mainContract.target,
          Constants.GAS.LIMIT_1_000_000,
        );
        const responseCodeRevokeKyc = (await revokeKycTx.wait()).logs.filter(
          (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
        )[0].args.responseCode;
        expect(responseCodeRevokeKyc).to.equal(TX_SUCCESS_CODE);
      }
    });
  });

  describe('HTS Precompile Get Token Info Tests', async function () {
    it('should be able to get fungible token info', async () => {
      const tx = await mainContract.getFungibleTokenInfoPublic(HTSTokenContractAddress);

      const { tokenInfo, decimals } = (await tx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.FungibleTokenInfo,
      )[0].args.tokenInfo;

      expect(tokenInfo.totalSupply).to.equal(TOKEN_MAX_SUPPLY);
      expect(decimals).to.equal(TOKEN_DECIMALS);
      expect(tokenInfo.token.maxSupply).to.equal(TOKEN_MAX_SUPPLY);
      expect(tokenInfo.token.name).to.equal(TOKEN_NAME);
      expect(tokenInfo.token.symbol).to.equal(TOKEN_SYMBOL);
    });

    it('should be able to get token info', async () => {
      const tx = await mainContract.getTokenInfoPublic(HTSTokenContractAddress);

      const { token, totalSupply } = (await tx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenInfo,
      )[0].args.tokenInfo;

      expect(totalSupply).to.equal(TOKEN_MAX_SUPPLY);
      expect(token.maxSupply).to.equal(TOKEN_MAX_SUPPLY);
      expect(token.name).to.equal(TOKEN_NAME);
      expect(token.symbol).to.equal(TOKEN_SYMBOL);
    });

    it('should be able to get non-fungible token info', async () => {
      const tx = await mainContract.getNonFungibleTokenInfoPublic(NftHTSTokenContractAddress, NftSerialNumber);

      const { tokenInfo, serialNumber } = (await tx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.NonFungibleTokenInfo,
      )[0].args.tokenInfo;

      expect(tokenInfo.totalSupply).to.equal(BigInt(1));
      expect(Number(serialNumber)).to.equal(NftSerialNumber);
      expect(tokenInfo.token.name).to.equal(TOKEN_NAME);
      expect(tokenInfo.token.symbol).to.equal(TOKEN_SYMBOL);
    });
  });

  describe('HTS Precompile KYC Tests', async function () {
    async function checkKyc(contractOwner, tokenAddress, accountAddress, expectedValue: boolean) {
      const tx = await contractOwner.isKycPublic(tokenAddress, accountAddress, Constants.GAS.LIMIT_1_000_000);
      const responseCodeIsKyc = (await tx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      expect(responseCodeIsKyc).to.equal(TX_SUCCESS_CODE);

      const isKycGranted = (await tx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.KycGranted,
      )[0].args.kycGranted;
      expect(isKycGranted).to.equal(expectedValue);
    }

    async function checkTokenDefaultKYCStatus(contractOwner, tokenAddress, expectedValue: boolean) {
      const txTokenDefaultStatus = await contractOwner.getTokenDefaultKycStatusPublic(
        tokenAddress,
        Constants.GAS.LIMIT_1_000_000,
      );
      const responseCodeTokenDefaultStatus = (await txTokenDefaultStatus.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      const defaultTokenKYCStatus = (await txTokenDefaultStatus.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenDefaultKycStatus,
      )[0].args.defaultKycStatus;
      expect(responseCodeTokenDefaultStatus).to.equal(TX_SUCCESS_CODE);
      expect(defaultTokenKYCStatus).to.equal(expectedValue);
    }

    it('should be able to get default KYC status for fungible token', async function () {
      await checkTokenDefaultKYCStatus(mainContractOwner, HTSTokenContractAddress, false);
    });

    it('should be able to get default KYC status for non fungible token', async function () {
      await checkTokenDefaultKYCStatus(mainContractOwner, NftHTSTokenContractAddress, false);
    });

    it('should be able to grant KYC, tranfer hts tokens and revoke KYC', async function () {
      // check if KYC is revoked
      await checkKyc(mainContractOwner, HTSTokenContractAddress, accounts[2].wallet.address, false);

      // grant KYC
      const grantKycTx = await mainContractOwner.grantTokenKycPublic(
        HTSTokenContractAddress,
        accounts[2].wallet.address,
        Constants.GAS.LIMIT_1_000_000,
      );
      const responseCodeGrantKyc = (await grantKycTx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      expect(responseCodeGrantKyc).to.equal(TX_SUCCESS_CODE);

      // check if KYC is granted
      await checkKyc(mainContractOwner, HTSTokenContractAddress, accounts[2].wallet.address, true);

      // transfer hts
      const amount = BigInt(10);
      const balanceBefore = await HTSTokenContract.balanceOf(accounts[2].wallet.address);
      await mainContract
        .connect(accounts[0].wallet)
        .cryptoTransferTokenPublic(
          accounts[2].wallet.address,
          HTSTokenContractAddress,
          amount,
          Constants.GAS.LIMIT_1_000_000,
        );
      await new Promise((r) => setTimeout(r, 5000));
      const balanceAfter = await HTSTokenContract.balanceOf(accounts[2].wallet.address);

      expect(balanceBefore + amount).to.equal(balanceAfter);

      // revoke KYC
      const revokeKycTx = await mainContractOwner.revokeTokenKycPublic(
        HTSTokenContractAddress,
        accounts[2].wallet.address,
        Constants.GAS.LIMIT_1_000_000,
      );
      const responseCodeRevokeKyc = (await revokeKycTx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      expect(responseCodeRevokeKyc).to.equal(TX_SUCCESS_CODE);

      // check if KYC is revoked
      await checkKyc(mainContractOwner, HTSTokenContractAddress, accounts[2].wallet.address, false);
    });
  });

  describe('HTS Precompile Custom Fees Tests', async function () {
    it('should be able to get a custom token fees', async function () {
      const mainContract = new ethers.Contract(mainContractAddress, TokenCreateJson.abi, accounts[0].wallet);

      const tx = await mainContract.getTokenCustomFeesPublic(HTSTokenWithCustomFeesContractAddress);
      const { fixedFees, fractionalFees } = (await tx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenCustomFees,
      )[0].args;

      expect(fixedFees[0].amount).to.equal(BigInt(1));
      expect(fixedFees[0].tokenId).to.equal(HTSTokenContractAddress);
      expect(fixedFees[0].useHbarsForPayment).to.equal(false);
      expect(fixedFees[0].useCurrentTokenForPayment).to.equal(false);

      expect(fractionalFees[0].numerator).to.equal(BigInt(4));
      expect(fractionalFees[0].denominator).to.equal(BigInt(5));
      expect(fractionalFees[0].minimumAmount).to.equal(BigInt(10));
      expect(fractionalFees[0].maximumAmount).to.equal(BigInt(30));
      expect(fractionalFees[0].netOfTransfers).to.equal(false);
    });
  });

  describe('HTS Precompile Delete Token Tests', async function () {
    it('should be able to delete a token', async function () {
      const createdTokenAddress = await createHTSToken();

      const txBefore = await mainContract.getTokenInfoPublic(createdTokenAddress, Constants.GAS.LIMIT_1_000_000);
      const tokenInfoBefore = (await txBefore.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenInfo,
      )[0].args.tokenInfo;

      const tx = await mainContract.deleteTokenPublic(createdTokenAddress, Constants.GAS.LIMIT_1_000_000);
      const responseCode = (await tx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      expect(responseCode).to.equal(TX_SUCCESS_CODE);

      const txAfter = await mainContract.getTokenInfoPublic(createdTokenAddress, Constants.GAS.LIMIT_1_000_000);
      const tokenInfoAfter = (await txAfter.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenInfo,
      )[0].args.tokenInfo;

      expect(tokenInfoBefore.deleted).to.equal(false);
      expect(tokenInfoAfter.deleted).to.equal(true);
    });
  });

  describe('CryptoTransfer Tests', async function () {
    let NftSerialNumber;
    let NftSerialNumber2;

    async function setKyc(tokenAddress) {
      const grantKycTx = await mainContractOwner.grantTokenKycPublic(
        tokenAddress,
        accounts[0].wallet.address,
        Constants.GAS.LIMIT_1_000_000,
      );
      expect(
        (await grantKycTx.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0]
          .args.responseCode,
      ).to.equal(TX_SUCCESS_CODE);

      const grantKycTx1 = await mainContractOwner.grantTokenKycPublic(
        tokenAddress,
        accounts[1].wallet.address,
        Constants.GAS.LIMIT_1_000_000,
      );
      expect(
        (await grantKycTx1.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0]
          .args.responseCode,
      ).to.equal(TX_SUCCESS_CODE);

      const grantKycTx2 = await mainContractOwner.grantTokenKycPublic(
        tokenAddress,
        accounts[2].wallet.address,
        Constants.GAS.LIMIT_1_000_000,
      );
      expect(
        (await grantKycTx2.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0]
          .args.responseCode,
      ).to.equal(TX_SUCCESS_CODE);
    }

    it('should be able to transfer fungible tokens', async function () {
      await setKyc(HTSTokenContractAddress);

      // setup the transfer
      const tokenTransferList = [
        {
          token: `${HTSTokenContractAddress}`,
          transfers: [
            {
              accountID: `${accounts[1].wallet.address}`,
              amount: 4,
            },
            {
              accountID: `${accounts[2].wallet.address}`,
              amount: 6,
            },
            {
              accountID: `${accounts[0].wallet.address}`,
              amount: -10,
            },
          ],
          nftTransfers: [],
        },
      ];
      const txXfer = await mainContract.cryptoTransferPublic(tokenTransferList, Constants.GAS.LIMIT_1_000_000);
      expect(
        (await txXfer.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
          .responseCode,
      ).to.equal(TX_SUCCESS_CODE);
    });

    it('should be able to transfer non-fungible tokens', async function () {
      await setKyc(NftHTSTokenContractAddress);
      // Mint an NFT
      const txMint = await mainContract.mintTokenPublic(
        NftHTSTokenContractAddress,
        0,
        ['0x03', '0x04'],
        Constants.GAS.LIMIT_1_000_000,
      );
      expect(
        (await txMint.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
          .responseCode,
      ).to.be.equal(TX_SUCCESS_CODE);
      const { serialNumbers } = (await txMint.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.MintedToken,
      )[0].args;
      NftSerialNumber = Number(serialNumbers[0]);
      NftSerialNumber2 = Number(serialNumbers[1]);

      // setup the transfer
      const tokenTransferList = [
        {
          token: `${NftHTSTokenContractAddress}`,
          transfers: [],
          nftTransfers: [
            {
              senderAccountID: `${accounts[0].wallet.address}`,
              receiverAccountID: `${accounts[1].wallet.address}`,
              serialNumber: NftSerialNumber,
            },
            {
              senderAccountID: `${accounts[0].wallet.address}`,
              receiverAccountID: `${accounts[2].wallet.address}`,
              serialNumber: NftSerialNumber2,
            },
          ],
        },
      ];
      const txXfer = await mainContract.cryptoTransferPublic(tokenTransferList, Constants.GAS.LIMIT_1_000_000);
      expect(
        (await txXfer.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
          .responseCode,
      ).to.equal(TX_SUCCESS_CODE);
    });

    it('should be able to transfer both fungible and non-fungible tokens in single cryptoTransfer', async function () {
      // Mint an NFT
      const txMint = await mainContract.mintTokenPublic(
        NftHTSTokenContractAddress,
        0,
        ['0x05'],
        Constants.GAS.LIMIT_1_000_000,
      );
      expect(
        (await txMint.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
          .responseCode,
      ).to.be.equal(TX_SUCCESS_CODE);
      const { serialNumbers } = (await txMint.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.MintedToken,
      )[0].args;
      const NftSerialNumber = serialNumbers[0];

      // setup the transfer
      const tokenTransferList = [
        {
          token: `${NftHTSTokenContractAddress}`,
          transfers: [],
          nftTransfers: [
            {
              senderAccountID: `${accounts[0].wallet.address}`,
              receiverAccountID: `${accounts[1].wallet.address}`,
              serialNumber: NftSerialNumber,
            },
          ],
        },
        {
          token: `${HTSTokenContractAddress}`,
          transfers: [
            {
              accountID: `${accounts[1].wallet.address}`,
              amount: 10,
            },
            {
              accountID: `${accounts[0].wallet.address}`,
              amount: -10,
            },
          ],
          nftTransfers: [],
        },
      ];
      const txXfer = await mainContract.cryptoTransferPublic(tokenTransferList, Constants.GAS.LIMIT_1_000_000);
      expect(
        (await txXfer.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
          .responseCode,
      ).to.equal(TX_SUCCESS_CODE);
    });

    it('should fail to swap approved fungible tokens', async function () {
      const txApproval1 = await mainContract.setApprovalForAllPublic(
        NftHTSTokenContractAddress,
        accounts[1].wallet.address,
        true,
        Constants.GAS.LIMIT_1_000_000,
      );
      expect(
        (await txApproval1.wait()).logs.filter(
          (e) => e?.fragment?.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
        )[0].args.responseCode,
      ).to.equal(TX_SUCCESS_CODE);

      const txApproval2 = await mainContract.setApprovalForAllPublic(
        NftHTSTokenContractAddress,
        accounts[2].wallet.address,
        true,
        Constants.GAS.LIMIT_1_000_000,
      );
      expect(
        (await txApproval2.wait()).logs.filter(
          (e) => e?.fragment?.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
        )[0].args.responseCode,
      ).to.equal(TX_SUCCESS_CODE);

      // setup the transfer
      const tokenTransferList = [
        {
          token: `${HTSTokenContractAddress}`,
          transfers: [
            {
              accountID: `${accounts[1].wallet.address}`,
              amount: 2,
            },
            {
              accountID: `${accounts[2].wallet.address}`,
              amount: -2,
            },
            {
              accountID: `${accounts[1].wallet.address}`,
              amount: -2,
            },
            {
              accountID: `${accounts[2].wallet.address}`,
              amount: 2,
            },
          ],
          nftTransfers: [],
        },
      ];

      await Assertions.expectRevert(mainContract.cryptoTransferPublic(tokenTransferList), Constants.CALL_EXCEPTION);
    });

    it('should fail to swap approved non-fungible tokens', async function () {
      const txApprove1 = await mainContract.setApprovalForAllPublic(
        NftHTSTokenContractAddress,
        accounts[1].wallet.address,
        true,
        Constants.GAS.LIMIT_1_000_000,
      );
      expect(
        (await txApprove1.wait()).logs.filter(
          (e) => e?.fragment?.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
        )[0].args.responseCode,
      ).to.equal(TX_SUCCESS_CODE);

      const txApprove2 = await mainContract.setApprovalForAllPublic(
        NftHTSTokenContractAddress,
        accounts[2].wallet.address,
        true,
        Constants.GAS.LIMIT_1_000_000,
      );
      expect(
        (await txApprove2.wait()).logs.filter(
          (e) => e?.fragment?.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
        )[0].args.responseCode,
      ).to.equal(TX_SUCCESS_CODE);

      const tokenTransferList = [
        {
          token: `${NftHTSTokenContractAddress}`,
          transfers: [],
          nftTransfers: [
            {
              senderAccountID: `${accounts[1].wallet.address}`,
              receiverAccountID: `${accounts[2].wallet.address}`,
              serialNumber: NftSerialNumber,
            },
            {
              senderAccountID: `${accounts[2].wallet.address}`,
              receiverAccountID: `${accounts[1].wallet.address}`,
              serialNumber: NftSerialNumber2,
            },
          ],
        },
      ];

      await Assertions.expectRevert(mainContract.cryptoTransferPublic(tokenTransferList), Constants.CALL_EXCEPTION);
    });

    it('should fail to transfer fungible and non-fungible tokens in a single tokenTransferList', async function () {
      // setup the transfer
      const xferAmount = 10;
      const tokenTransferList = [
        {
          token: `${NftHTSTokenContractAddress}`,
          transfers: [
            {
              accountID: `${accounts[1].wallet.address}`,
              amount: `${xferAmount}`,
            },
            {
              accountID: `${accounts[0].wallet.address}`,
              amount: `-${xferAmount}`,
            },
          ],
          nftTransfers: [
            {
              senderAccountID: `${accounts[0].wallet.address}`,
              receiverAccountID: `${accounts[1].wallet.address}`,
              serialNumber: NftSerialNumber,
            },
          ],
        },
      ];

      await Assertions.expectRevert(mainContract.cryptoTransferPublic(tokenTransferList), Constants.CALL_EXCEPTION);
    });
  });
});
