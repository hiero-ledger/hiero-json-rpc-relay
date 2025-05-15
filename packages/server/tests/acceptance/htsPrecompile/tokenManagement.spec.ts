// SPDX-License-Identifier: Apache-2.0

// external resources
import relayConstants from '@hashgraph/json-rpc-relay/dist/lib/constants';
import { expect } from 'chai';
import { ethers } from 'ethers';

import ERC20MockJson from '../../contracts/ERC20Mock.json';
import TokenManagementJson from '../../contracts/TokenManagementContract.json';
import Assertions from '../../helpers/assertions';
import Constants from '../../helpers/constants';
import { Utils } from '../../helpers/utils';
import { AliasAccount } from '../../types/AliasAccount';

/**
 * Tests for:
 * wipeTokenAccount
 * wipeTokenAccountNFT
 * getTokenKey
 * updateTokenKeys
 * getTokenInfo
 * updateTokenInfo
 * isToken
 * getTokenType
 * getTokenExpiryInfo
 * freezeToken
 * unfreezeToken
 * pauseToken
 * unpauseToken
 * updateTokenExpiryInfo
 */
describe('@tokenmanagement HTS Precompile Token Management Acceptance Tests', async function () {
  this.timeout(240 * 1000); // 240 seconds
  const { servicesNode, mirrorNode, relay }: any = global;

  const TX_SUCCESS_CODE = BigInt(22);

  const accounts: AliasAccount[] = [];
  let mainContractAddress: string;
  let HTSTokenContractAddress: string;
  let NftHTSTokenContractAddress: string;
  let HTSTokenContract: ethers.Contract;
  let mainContract: ethers.Contract;
  let mainContractOwner: ethers.Contract;
  let mainContractReceiverWalletFirst: ethers.Contract;
  let requestId: string;

  this.beforeAll(async () => {
    requestId = Utils.generateRequestId();
    const initialAccount: AliasAccount = global.accounts[0];
    const initialAmount: string = '5000000000'; //50 Hbar

    const contractDeployer = await Utils.createAliasAccount(mirrorNode, initialAccount, requestId, initialAmount);
    mainContract = await Utils.deployContract(
      TokenManagementJson.abi,
      TokenManagementJson.bytecode,
      contractDeployer.wallet,
    );
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
    global.accounts.push(...accounts);
    // allow mirror node a 2 full record stream write windows (2 sec) and a buffer to persist setup details
    await new Promise((r) => setTimeout(r, 2000));
    await mirrorNode.get(`/accounts/${accounts[1].accountId}`, requestId);

    HTSTokenContractAddress = await createHTSToken();
    NftHTSTokenContractAddress = await createNftHTSToken();

    HTSTokenContract = new ethers.Contract(HTSTokenContractAddress, ERC20MockJson.abi, accounts[0].wallet);
    mainContract = new ethers.Contract(mainContractAddress, TokenManagementJson.abi, accounts[0].wallet);

    mainContractOwner = mainContract;
    mainContractReceiverWalletFirst = mainContract.connect(accounts[1].wallet) as ethers.Contract;

    const tx1 = await mainContractOwner.associateTokenPublic(
      mainContractAddress,
      HTSTokenContractAddress,
      Constants.GAS.LIMIT_10_000_000,
    );
    expect(
      (await tx1.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
        .responseCode,
    ).to.equal(TX_SUCCESS_CODE);

    const tx2 = await mainContractReceiverWalletFirst.associateTokenPublic(
      accounts[1].wallet.address,
      HTSTokenContractAddress,
      Constants.GAS.LIMIT_10_000_000,
    );
    expect(
      (await tx2.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
        .responseCode,
    ).to.equal(TX_SUCCESS_CODE);

    const tx3 = await mainContractOwner.associateTokenPublic(
      mainContractAddress,
      NftHTSTokenContractAddress,
      Constants.GAS.LIMIT_10_000_000,
    );
    expect(
      (await tx3.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
        .responseCode,
    ).to.equal(TX_SUCCESS_CODE);

    const tx4 = await mainContractReceiverWalletFirst.associateTokenPublic(
      accounts[1].wallet.address,
      NftHTSTokenContractAddress,
      Constants.GAS.LIMIT_10_000_000,
    );
    expect(
      (await tx4.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
        .responseCode,
    ).to.equal(TX_SUCCESS_CODE);
  });

  this.beforeEach(async () => {
    requestId = Utils.generateRequestId();
  });

  async function createHTSToken() {
    const mainContract = new ethers.Contract(mainContractAddress, TokenManagementJson.abi, accounts[0].wallet);
    const tx = await mainContract.createFungibleTokenPublic(accounts[0].wallet.address, {
      value: BigInt('10000000000000000000'),
      gasLimit: 10000000,
    });
    const { tokenAddress } = (await tx.wait()).logs.filter(
      (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.CreatedToken,
    )[0].args;

    return tokenAddress;
  }

  async function createNftHTSToken() {
    const mainContract = new ethers.Contract(mainContractAddress, TokenManagementJson.abi, accounts[0].wallet);
    const tx = await mainContract.createNonFungibleTokenPublic(accounts[0].wallet.address, {
      value: BigInt('10000000000000000000'),
      gasLimit: 10000000,
    });
    const { tokenAddress } = (await tx.wait()).logs.filter(
      (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.CreatedToken,
    )[0].args;

    return tokenAddress;
  }

  describe('HTS Precompile Wipe Tests', async function () {
    let tokenAddress, tokenContract, nftAddress;

    before(async function () {
      // Create token and nft contracts
      tokenAddress = await createHTSToken();
      nftAddress = await createNftHTSToken();
      tokenContract = new ethers.Contract(tokenAddress, ERC20MockJson.abi, accounts[0].wallet);

      // Associate token and nft to accounts
      const tx1 = await mainContractOwner.associateTokenPublic(
        mainContractAddress,
        tokenAddress,
        Constants.GAS.LIMIT_1_000_000,
      );
      expect(
        (await tx1.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
          .responseCode,
      ).to.equal(TX_SUCCESS_CODE);

      const tx2 = await mainContractReceiverWalletFirst.associateTokenPublic(
        accounts[1].wallet.address,
        tokenAddress,
        Constants.GAS.LIMIT_1_000_000,
      );
      expect(
        (await tx2.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
          .responseCode,
      ).to.equal(TX_SUCCESS_CODE);

      const tx3 = await mainContractOwner.associateTokenPublic(
        mainContractAddress,
        nftAddress,
        Constants.GAS.LIMIT_1_000_000,
      );
      expect(
        (await tx3.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
          .responseCode,
      ).to.equal(TX_SUCCESS_CODE);

      const tx4 = await mainContractReceiverWalletFirst.associateTokenPublic(
        accounts[1].wallet.address,
        nftAddress,
        Constants.GAS.LIMIT_1_000_000,
      );
      expect(
        (await tx4.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0].args
          .responseCode,
      ).to.equal(TX_SUCCESS_CODE);

      // Grant Kyc to receiver account for token
      const grantKycTx = await mainContract.grantTokenKycPublic(
        tokenAddress,
        accounts[1].wallet.address,
        Constants.GAS.LIMIT_1_000_000,
      );
      const responseCodeGrantKyc = (await grantKycTx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      expect(responseCodeGrantKyc).to.equal(TX_SUCCESS_CODE);

      // Grant Kyc to receiver account for nft
      const grantKycNftTx = await mainContract.grantTokenKycPublic(
        nftAddress,
        accounts[1].wallet.address,
        Constants.GAS.LIMIT_1_000_000,
      );
      const responseCodeGrantKycNft = (await grantKycNftTx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      expect(responseCodeGrantKycNft).to.equal(TX_SUCCESS_CODE);
      // Transfer initial token balance to receiver
      const amount = 5;
      const tx = await mainContract.cryptoTransferTokenPublic(
        accounts[1].wallet.address,
        tokenAddress,
        amount,
        Constants.GAS.LIMIT_1_000_000,
      );
      await tx.wait();
    });

    it('should revert if attempting to wipe more tokens than the owned amount', async function () {
      const wipeAmount = 100;
      const balanceBefore = await tokenContract.balanceOf(accounts[1].wallet.address);

      const tx = await mainContract.wipeTokenAccountPublic(
        tokenAddress,
        accounts[1].wallet.address,
        wipeAmount,
        Constants.GAS.LIMIT_50_000,
      );

      await Assertions.expectRevert(tx, Constants.CALL_EXCEPTION);
      const balanceAfter = await tokenContract.balanceOf(accounts[1].wallet.address);
      expect(balanceBefore.toString()).to.eq(balanceAfter.toString());
    });

    it('should be able to execute wipeTokenAccount', async function () {
      const wipeAmount = 3;
      const balanceBefore = await tokenContract.balanceOf(accounts[1].wallet.address);

      const tx = await mainContract.wipeTokenAccountPublic(
        tokenAddress,
        accounts[1].wallet.address,
        wipeAmount,
        Constants.GAS.LIMIT_50_000,
      );
      const { responseCode } = (await tx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args;
      expect(responseCode).to.equal(TX_SUCCESS_CODE);
      await new Promise((r) => setTimeout(r, 2000));

      const balanceAfter = await tokenContract.balanceOf(accounts[1].wallet.address);
      expect(Number(balanceAfter.toString()) + wipeAmount).to.equal(Number(balanceBefore.toString()));
    });

    it('should be able to execute wipeTokenAccountNFT', async function () {
      let NftSerialNumber, serials;

      // Mint an NFT
      {
        const tx = await mainContract.mintTokenPublic(nftAddress, 0, ['0x02'], Constants.GAS.LIMIT_1_000_000);
        const { responseCode } = (await tx.wait()).logs.filter(
          (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
        )[0].args;
        expect(responseCode).to.equal(TX_SUCCESS_CODE);
        const { serialNumbers } = (await tx.wait()).logs.filter(
          (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.MintedToken,
        )[0].args;
        NftSerialNumber = Number(serialNumbers[0]);
        expect(NftSerialNumber).to.be.greaterThan(0);
        serials = serialNumbers;
      }

      // Transfer the NFT to the receiver wallet
      {
        const tx = await mainContract.transferNFTPublic(
          nftAddress,
          accounts[0].wallet.address,
          accounts[1].wallet.address,
          NftSerialNumber,
        );
        const { responseCode } = (await tx.wait()).logs.filter(
          (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
        )[0].args;
        expect(responseCode).to.equal(TX_SUCCESS_CODE);
      }

      // Get token info before
      {
        const tx = await mainContract.getNonFungibleTokenInfoPublic(
          nftAddress,
          NftSerialNumber,
          Constants.GAS.LIMIT_1_000_000,
        );
        const { responseCode } = (await tx.wait()).logs.filter(
          (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
        )[0].args;
        const { tokenInfo } = (await tx.wait()).logs.filter(
          (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.NonFungibleTokenInfo,
        )[0].args;
        expect(responseCode).to.equal(TX_SUCCESS_CODE);
        expect(tokenInfo).to.exist;
      }

      // Wipe the NFT
      {
        const tx = await mainContract.wipeTokenAccountNFTPublic(
          nftAddress,
          accounts[1].wallet.address,
          serials.toArray().map((e) => Number(e)),
          Constants.GAS.LIMIT_50_000,
        );
        const { responseCode } = (await tx.wait()).logs.filter(
          (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
        )[0].args;
        expect(responseCode).to.equal(TX_SUCCESS_CODE);
      }

      // Get token info after
      {
        const tx = await mainContract.getNonFungibleTokenInfoPublic(
          nftAddress,
          NftSerialNumber,
          Constants.GAS.LIMIT_50_000,
        );
        await Assertions.expectRevert(tx, Constants.CALL_EXCEPTION);
      }
    });
  });

  describe('HTS Precompile for token check methods', async function () {
    it('should return false for isToken with passed contract address', async function () {
      const tx = await mainContract.isTokenPublic(mainContractAddress, Constants.GAS.LIMIT_50_000);
      const txReceipt = await tx.wait();

      const responseCode = txReceipt.logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      expect(responseCode).to.equal(TX_SUCCESS_CODE);

      const isTokenFlag = txReceipt.logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.IsToken)[0]
        .args.isToken;
      expect(isTokenFlag).to.equal(false);
    });

    it('should return true for isToken with passed token address', async function () {
      const tx = await mainContract.isTokenPublic(HTSTokenContractAddress, Constants.GAS.LIMIT_50_000);
      const txReceipt = await tx.wait();

      const responseCode = txReceipt.logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      expect(responseCode).to.equal(TX_SUCCESS_CODE);

      const isTokenFlag = txReceipt.logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.IsToken)[0]
        .args.isToken;
      expect(isTokenFlag).to.equal(true);
    });

    it('should return 0 for getTokenType with passed FUNGIBLE_COMMON token', async function () {
      const tx = await mainContract.getTokenTypePublic(HTSTokenContractAddress, Constants.GAS.LIMIT_50_000);
      const txReceipt = await tx.wait();

      const responseCode = txReceipt.logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      expect(responseCode).to.equal(TX_SUCCESS_CODE);

      const tokenType = txReceipt.logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenType)[0]
        .args.tokenType;
      expect(tokenType).to.equal(BigInt(0));
    });

    it('should return 1 for getTokenType with passed HTS NON_FUNGIBLE_UNIQUE token', async function () {
      const tx = await mainContract.getTokenTypePublic(NftHTSTokenContractAddress, Constants.GAS.LIMIT_50_000);
      const txReceipt = await tx.wait();

      const responseCode = txReceipt.logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      expect(responseCode).to.equal(TX_SUCCESS_CODE);

      const tokenType = txReceipt.logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenType)[0]
        .args.tokenType;
      expect(tokenType).to.equal(BigInt(1));
    });

    it('should throw an exception for getTokenType with passed contract address', async function () {
      await Assertions.expectRevert(
        mainContract.getTokenTypePublic(mainContractAddress, Constants.GAS.LIMIT_50_000),
        Constants.CALL_EXCEPTION,
      );
    });
  });

  describe('HTS update token info test', async function () {
    const TOKEN_UPDATE_NAME = 'tokenUpdateName';
    const TOKEN_UPDATE_SYMBOL = 'tokenUpdateSymbol';
    const TOKEN_UPDATE_MEMO = 'tokenUpdateMemo';

    function setUpdatedValues(token) {
      token[0] = TOKEN_UPDATE_NAME;
      token[1] = TOKEN_UPDATE_SYMBOL;
      token[2] = accounts[0].wallet.address;
      token[3] = TOKEN_UPDATE_MEMO;
    }

    async function checkUpdatedTokenInfo(tokenInfo) {
      //token info return treasury as long zero address, we convert it to evm address to compare
      const treasury = await mirrorNodeAddressReq(tokenInfo.treasury);
      expect(tokenInfo.name).to.equal(TOKEN_UPDATE_NAME);
      expect(tokenInfo.symbol).to.equal(TOKEN_UPDATE_SYMBOL);
      expect(treasury.toLowerCase()).to.equal(accounts[0].wallet.address.toLowerCase());
      expect(tokenInfo.memo).to.equal(TOKEN_UPDATE_MEMO);
    }

    async function mirrorNodeAddressReq(address) {
      const accountEvmAddress = await mirrorNode.get(`/accounts/${address}?transactiontype=cryptotransfer`, requestId);
      return accountEvmAddress.evm_address;
    }

    it('should update fungible token properties', async function () {
      const txBeforeInfo = await mainContract.getTokenInfoPublic(
        HTSTokenContractAddress,
        Constants.GAS.LIMIT_1_000_000,
      );
      const tokenInfoBefore = (await txBeforeInfo.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenInfo,
      )[0].args.tokenInfo[0];

      // updating only token info, not token keys
      const token = Utils.convertEthersResultIntoStringsArray(tokenInfoBefore);
      token[7] = [];

      setUpdatedValues(token);

      // update contract properties
      const txUpdate = await mainContractOwner.updateTokenInfoPublic(
        HTSTokenContractAddress,
        token,
        Constants.GAS.LIMIT_1_000_000,
      );
      expect(
        (await txUpdate.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0]
          .args.responseCode,
      ).to.be.equal(TX_SUCCESS_CODE);

      const txAfterInfo = await mainContract.getTokenInfoPublic(HTSTokenContractAddress, Constants.GAS.LIMIT_1_000_000);
      const tokenInfoAfter = (await txAfterInfo.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenInfo,
      )[0].args.tokenInfo[0];
      await checkUpdatedTokenInfo(tokenInfoAfter);
    });

    it('should update non-fungible token properties', async function () {
      const txBeforeInfo = await mainContract.getTokenInfoPublic(
        NftHTSTokenContractAddress,
        Constants.GAS.LIMIT_1_000_000,
      );
      const tokenInfoBefore = (await txBeforeInfo.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenInfo,
      )[0].args.tokenInfo[0];

      // updating only token info, not token keys
      const token = Utils.convertEthersResultIntoStringsArray(tokenInfoBefore);
      token[7] = [];

      setUpdatedValues(token);

      const txUpdate = await mainContractOwner.updateTokenInfoPublic(
        NftHTSTokenContractAddress,
        token,
        Constants.GAS.LIMIT_1_000_000,
      );
      expect(
        (await txUpdate.wait()).logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode)[0]
          .args.responseCode,
      ).to.be.equal(TX_SUCCESS_CODE);

      const txAfterInfo = await mainContract.getTokenInfoPublic(
        NftHTSTokenContractAddress,
        Constants.GAS.LIMIT_1_000_000,
      );
      const tokenInfoAfter = (await txAfterInfo.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenInfo,
      )[0].args.tokenInfo[0];
      await checkUpdatedTokenInfo(tokenInfoAfter);
    });
  });

  describe('HTS Precompile Freeze/Unfreeze Tests', async function () {
    async function checkTokenFrozen(contractOwner, tokenAddress, expectedValue: boolean) {
      const txBefore = await contractOwner.isFrozenPublic(
        tokenAddress,
        accounts[0].wallet.address,
        Constants.GAS.LIMIT_1_000_000,
      );
      const txBeforeReceipt = await txBefore.wait();
      const responseCodeBefore = txBeforeReceipt.logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      const isFrozenBefore = txBeforeReceipt.logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.Frozen,
      )[0].args.frozen;

      expect(responseCodeBefore).to.equal(TX_SUCCESS_CODE);
      expect(isFrozenBefore).to.be.equal(expectedValue);
    }

    async function checkTokenDefaultFreezeStatus(contractOwner, tokenAddress, expectedValue: boolean) {
      const txTokenDefaultStatus = await contractOwner.getTokenDefaultFreezeStatusPublic(
        tokenAddress,
        Constants.GAS.LIMIT_1_000_000,
      );
      const responseCodeTokenDefaultStatus = (await txTokenDefaultStatus.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      const defaultTokenFreezeStatus = (await txTokenDefaultStatus.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenDefaultFreezeStatus,
      )[0].args.defaultFreezeStatus;
      expect(responseCodeTokenDefaultStatus).to.equal(TX_SUCCESS_CODE);
      expect(defaultTokenFreezeStatus).to.equal(expectedValue);
    }

    it('should be able to freeze and unfreeze fungible token transfers', async function () {
      // expect the token to not be frozen
      await checkTokenFrozen(mainContractOwner, HTSTokenContractAddress, false);

      // get token default freeze status
      await checkTokenDefaultFreezeStatus(mainContractOwner, HTSTokenContractAddress, false);

      // freeze token
      const freezeTx = await mainContractOwner.freezeTokenPublic(
        HTSTokenContractAddress,
        accounts[0].wallet.address,
        Constants.GAS.LIMIT_1_000_000,
      );
      const responseCodeFreeze = (await freezeTx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      expect(responseCodeFreeze).to.equal(TX_SUCCESS_CODE);

      // expect the token to be frozen
      await checkTokenFrozen(mainContractOwner, HTSTokenContractAddress, true);

      // unfreeze token
      const unfreezeTx = await mainContractOwner.unfreezeTokenPublic(
        HTSTokenContractAddress,
        accounts[0].wallet.address,
        Constants.GAS.LIMIT_1_000_000,
      );
      const responseCodeUnfreeze = (await unfreezeTx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      expect(responseCodeUnfreeze).to.equal(TX_SUCCESS_CODE);

      // expect the token to not be frozen
      await checkTokenFrozen(mainContractOwner, HTSTokenContractAddress, false);
    });

    it('should be able to freeze and unfreeze non-fungible token transfers', async function () {
      // expect the token to not be frozen
      await checkTokenFrozen(mainContractOwner, NftHTSTokenContractAddress, false);

      // get token default freeze status
      await checkTokenDefaultFreezeStatus(mainContractOwner, NftHTSTokenContractAddress, false);

      // freeze token
      const freezeTx = await mainContractOwner.freezeTokenPublic(
        NftHTSTokenContractAddress,
        accounts[0].wallet.address,
        Constants.GAS.LIMIT_1_000_000,
      );
      const responseCodeFreeze = (await freezeTx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      expect(responseCodeFreeze).to.equal(TX_SUCCESS_CODE);

      // expect the token to be frozen
      await checkTokenFrozen(mainContractOwner, NftHTSTokenContractAddress, true);

      // unfreeze token
      const unfreezeTx = await mainContractOwner.unfreezeTokenPublic(
        NftHTSTokenContractAddress,
        accounts[0].wallet.address,
        Constants.GAS.LIMIT_1_000_000,
      );
      const responseCodeUnfreeze = (await unfreezeTx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      expect(responseCodeUnfreeze).to.equal(TX_SUCCESS_CODE);

      // expect the token to not be frozen
      await checkTokenFrozen(mainContractOwner, NftHTSTokenContractAddress, false);
    });

    it('should create fungible token with default freeze status true', async function () {
      // change default freeze status
      const txSetDefaultFreezeStatus = await mainContractOwner.setFreezeDefaultStatus(
        true,
        Constants.GAS.LIMIT_1_000_000,
      );
      const newDefaultFreezeStatus = (await txSetDefaultFreezeStatus.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.DefaultFreezeStatusChanged,
      )[0].args.freezeStatus;

      expect(newDefaultFreezeStatus).to.equal(true);

      // create token with new default freeze status
      const tx = await mainContractOwner.createFungibleTokenPublic(accounts[0].wallet.address, {
        value: BigInt('10000000000000000000'),
        gasLimit: 10000000,
      });

      const { tokenAddress } = (await tx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.CreatedToken,
      )[0].args;

      // get token default freeze status
      await checkTokenDefaultFreezeStatus(mainContractOwner, tokenAddress, newDefaultFreezeStatus);
    });

    it('should create non fungible token with default freeze status true', async function () {
      // change default freeze status
      const txSetDefaultFreezeStatus = await mainContractOwner.setFreezeDefaultStatus(
        true,
        Constants.GAS.LIMIT_1_000_000,
      );
      const newDefaultFreezeStatus = (await txSetDefaultFreezeStatus.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.DefaultFreezeStatusChanged,
      )[0].args.freezeStatus;

      expect(newDefaultFreezeStatus).to.equal(true);

      // create non fungible token with new default freeze status
      const tx = await mainContract.createNonFungibleTokenPublic(accounts[0].wallet.address, {
        value: BigInt('10000000000000000000'),
        gasLimit: 10000000,
      });
      const { tokenAddress } = (await tx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.CreatedToken,
      )[0].args;

      // get token default freeze status
      await checkTokenDefaultFreezeStatus(mainContractOwner, tokenAddress, newDefaultFreezeStatus);
    });
  });

  describe('HTS Precompile Pause/Unpause Tests', async function () {
    it('should be able to pause fungible token', async () => {
      const txTokenInfoBefore = await mainContract.getTokenInfoPublic(HTSTokenContractAddress);
      const { pauseStatus: pauseStatusBefore } = (await txTokenInfoBefore.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenInfo,
      )[0].args.tokenInfo;

      const txPause = await mainContract.pauseTokenPublic(HTSTokenContractAddress, Constants.GAS.LIMIT_1_000_000);
      const pauseResponse = (await txPause.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.PausedToken,
      )[0].args;

      const txTokenInfoAfter = await mainContract.getTokenInfoPublic(HTSTokenContractAddress);
      const { pauseStatus: pauseStatusAfter } = (await txTokenInfoAfter.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenInfo,
      )[0].args.tokenInfo;

      expect(pauseStatusBefore).to.equal(false);
      expect(pauseResponse.paused).to.equal(true);
      expect(pauseStatusAfter).to.equal(true);
    });

    it('should be able to unpause fungible token', async () => {
      const txTokenInfoBefore = await mainContract.getTokenInfoPublic(HTSTokenContractAddress);
      const { pauseStatus: pauseStatusBefore } = (await txTokenInfoBefore.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenInfo,
      )[0].args.tokenInfo;

      const txPause = await mainContract.unpauseTokenPublic(HTSTokenContractAddress, Constants.GAS.LIMIT_1_000_000);
      const unpauseResponse = (await txPause.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.UnpausedToken,
      )[0].args;

      const txTokenInfoAfter = await mainContract.getTokenInfoPublic(HTSTokenContractAddress);
      const { pauseStatus: pauseStatusAfter } = (await txTokenInfoAfter.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenInfo,
      )[0].args.tokenInfo;

      expect(unpauseResponse.unpaused).to.equal(true);
      expect(pauseStatusBefore).to.equal(true);
      expect(pauseStatusAfter).to.equal(false);
    });

    it('should be able to pause non fungible token', async () => {
      const txTokenInfoBefore = await mainContract.getTokenInfoPublic(NftHTSTokenContractAddress);
      const { pauseStatus: pauseStatusBefore } = (await txTokenInfoBefore.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenInfo,
      )[0].args.tokenInfo;

      const txPause = await mainContract.pauseTokenPublic(NftHTSTokenContractAddress, Constants.GAS.LIMIT_1_000_000);
      const pauseResponse = (await txPause.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.PausedToken,
      )[0].args;

      const txTokenInfoAfter = await mainContract.getTokenInfoPublic(NftHTSTokenContractAddress);
      const { pauseStatus: pauseStatusAfter } = (await txTokenInfoAfter.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenInfo,
      )[0].args.tokenInfo;

      expect(pauseResponse.paused).to.equal(true);
      expect(pauseStatusBefore).to.equal(false);
      expect(pauseStatusAfter).to.equal(true);
    });

    it('should be able to unpause non fungible token', async () => {
      const mainContract = new ethers.Contract(mainContractAddress, TokenManagementJson.abi, accounts[0].wallet);

      const txTokenInfoBefore = await mainContract.getTokenInfoPublic(NftHTSTokenContractAddress);
      const { pauseStatus: pauseStatusBefore } = (await txTokenInfoBefore.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenInfo,
      )[0].args.tokenInfo;

      const txPause = await mainContract.unpauseTokenPublic(NftHTSTokenContractAddress, Constants.GAS.LIMIT_1_000_000);
      const unpauseResponse = (await txPause.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.UnpausedToken,
      )[0].args;

      const txTokenInfoAfter = await mainContract.getTokenInfoPublic(NftHTSTokenContractAddress);
      const { pauseStatus: pauseStatusAfter } = (await txTokenInfoAfter.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenInfo,
      )[0].args.tokenInfo;

      expect(unpauseResponse.unpaused).to.equal(true);
      expect(pauseStatusBefore).to.equal(true);
      expect(pauseStatusAfter).to.equal(false);
    });
  });

  describe('HTS Precompile Token Expiry Info Tests', async function () {
    const AUTO_RENEW_PERIOD = BigInt(8000000);
    const NEW_AUTO_RENEW_PERIOD = 7999900;
    const AUTO_RENEW_SECOND = 0;

    //Expiry Info auto renew account returns account id from type - 0x000000000000000000000000000000000000048C
    //We expect account to be evm address, but because we can't compute one address for the other, we have to make a mirror node query to get expiry info auto renew evm address
    async function mirrorNodeAddressReq(address) {
      const accountEvmAddress = await mirrorNode.get(`/accounts/${address}?transactiontype=cryptotransfer`, requestId);
      return accountEvmAddress.evm_address;
    }

    it('should be able to get and update fungible token expiry info', async function () {
      //get current epoch + auto renew period , which result to expiry info second
      const epoch = parseInt((Date.now() / 1000 + Number(NEW_AUTO_RENEW_PERIOD)).toFixed(0));

      // get current expiry info
      const getTokenExpiryInfoTxBefore = await mainContract.getTokenExpiryInfoPublic(HTSTokenContractAddress);
      const responseCode = (await getTokenExpiryInfoTxBefore.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      const tokenExpiryInfoBefore = (await getTokenExpiryInfoTxBefore.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenExpiryInfo,
      )[0].args.expiryInfo;

      const renewAccountEvmAddress = await mirrorNodeAddressReq(tokenExpiryInfoBefore.autoRenewAccount);

      expect(responseCode).to.equal(TX_SUCCESS_CODE);
      expect(tokenExpiryInfoBefore.autoRenewPeriod).to.equal(AUTO_RENEW_PERIOD);
      expect(renewAccountEvmAddress).to.equal(accounts[0].address);

      const expiryInfo = {
        second: AUTO_RENEW_SECOND,
        autoRenewAccount: mainContractAddress,
        autoRenewPeriod: NEW_AUTO_RENEW_PERIOD,
      };
      // update expiry info
      const updateTokenExpiryInfoTx = await mainContract.updateTokenExpiryInfoPublic(
        HTSTokenContractAddress,
        expiryInfo,
        Constants.GAS.LIMIT_1_000_000,
      );
      const updateExpiryInfoResponseCode = (await updateTokenExpiryInfoTx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;

      // get updated expiryInfo
      const getTokenExpiryInfoTxAfter = await mainContract.getTokenExpiryInfoPublic(HTSTokenContractAddress);
      const getExpiryInfoResponseCode = (await getTokenExpiryInfoTxAfter.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      const tokenExpiryInfoAfter = (await getTokenExpiryInfoTxAfter.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenExpiryInfo,
      )[0].args.expiryInfo;

      const newRenewAccountEvmAddress = await mirrorNodeAddressReq(tokenExpiryInfoAfter.autoRenewAccount);
      const expectedRenewAddress = mainContractAddress;

      expect(updateExpiryInfoResponseCode).to.equal(TX_SUCCESS_CODE);
      expect(getExpiryInfoResponseCode).to.equal(TX_SUCCESS_CODE);
      expect(tokenExpiryInfoAfter.autoRenewPeriod).to.equal(BigInt(expiryInfo.autoRenewPeriod));
      expect(newRenewAccountEvmAddress.toLowerCase()).to.equal(expectedRenewAddress.toLowerCase());

      //use close to with delta 400 seconds, because we don't know the exact second it was set to expiry
      expect(Number(tokenExpiryInfoAfter.second)).to.be.closeTo(epoch, 400);
    });

    it('should be able to get and update non fungible token expiry info', async function () {
      //get current epoch + auto renew period , which result to expiry info second
      const epoch = parseInt((Date.now() / 1000 + NEW_AUTO_RENEW_PERIOD).toFixed(0));
      // get current expiry info
      const getTokenExpiryInfoTxBefore = await mainContract.getTokenExpiryInfoPublic(NftHTSTokenContractAddress);
      const responseCode = (await getTokenExpiryInfoTxBefore.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      const tokenExpiryInfoBefore = (await getTokenExpiryInfoTxBefore.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenExpiryInfo,
      )[0].args.expiryInfo;

      //Expiry Info auto renew account returns account id from type - 0x000000000000000000000000000000000000048C
      //We expect account to be evm address, but because we can't compute one address for the other, we have to make a mirror node query to get expiry info auto renew evm address
      const renewAccountEvmAddress = await mirrorNodeAddressReq(tokenExpiryInfoBefore.autoRenewAccount);

      expect(responseCode).to.equal(TX_SUCCESS_CODE);
      expect(tokenExpiryInfoBefore.autoRenewPeriod).to.equal(AUTO_RENEW_PERIOD);
      expect(renewAccountEvmAddress).to.equal(accounts[0].address);

      // update expiry info
      const expiryInfo = {
        second: AUTO_RENEW_SECOND,
        autoRenewAccount: mainContractAddress,
        autoRenewPeriod: NEW_AUTO_RENEW_PERIOD,
      };

      const updateTokenExpiryInfoTx = await mainContract.updateTokenExpiryInfoPublic(
        NftHTSTokenContractAddress,
        expiryInfo,
        Constants.GAS.LIMIT_1_000_000,
      );
      const updateExpiryInfoResponseCode = (await updateTokenExpiryInfoTx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;

      // get updated expiryInfo
      const getTokenExpiryInfoTxAfter = await mainContract.getTokenExpiryInfoPublic(NftHTSTokenContractAddress);
      const getExpiryInfoResponseCode = (await getTokenExpiryInfoTxAfter.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      const tokenExpiryInfoAfter = (await getTokenExpiryInfoTxAfter.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenExpiryInfo,
      )[0].args.expiryInfo;

      const newRenewAccountEvmAddress = await mirrorNodeAddressReq(tokenExpiryInfoAfter.autoRenewAccount);
      const expectedRenewAddress = `0x${mainContractAddress.substring(2)}`;

      expect(updateExpiryInfoResponseCode).to.equal(TX_SUCCESS_CODE);
      expect(getExpiryInfoResponseCode).to.equal(TX_SUCCESS_CODE);
      expect(tokenExpiryInfoAfter.autoRenewPeriod).to.equal(BigInt(expiryInfo.autoRenewPeriod));
      expect(newRenewAccountEvmAddress.toLowerCase()).to.equal(expectedRenewAddress.toLowerCase());

      //use close to with delta 400 seconds, because we don't know the exact second it was set to expiry
      expect(Number(tokenExpiryInfoAfter.second)).to.be.closeTo(epoch, 400);
    });
  });

  describe('HTS Precompile Key management Tests', async function () {
    it('should be able to execute updateTokenKeys', async function () {
      // Get key value before update
      const getKeyTx = await mainContract.getTokenKeyPublic(HTSTokenContractAddress, 2);
      const originalKey = (await getKeyTx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenKey,
      )[0].args.key;
      const updateKey = [
        false,
        Constants.ZERO_HEX,
        '0x',
        '0x03dfcc94dfd843649cc594ada5ac6627031454602aa190223f996de25a05828f36',
        Constants.ZERO_HEX,
      ];

      // Update keys. After updating there should be only one key with keyValue = 6. Other keys are removed
      const updateTx = await mainContract.updateTokenKeysPublic(HTSTokenContractAddress, [[2, updateKey]]);
      const updateResponseCode = (await updateTx.wait()).logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args.responseCode;
      expect(updateResponseCode).to.equal(TX_SUCCESS_CODE);

      // Assert updated key
      const tx = await mainContract.getTokenKeyPublic(HTSTokenContractAddress, 2);
      const result = await tx.wait();
      const { responseCode } = result.logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args;
      expect(responseCode).to.equal(TX_SUCCESS_CODE);
      const updatedKey = result.logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenKey)[0].args
        .key;

      expect(updatedKey).to.exist;
      expect(updatedKey.inheritAccountKey).to.eq(updateKey[0]);
      expect(updatedKey.contractId).to.eq(updateKey[1]);
      expect(updatedKey.ed25519).to.eq(updateKey[2]);
      expect(updatedKey.ECDSA_secp256k1).to.eq(updateKey[3]);
      expect(updatedKey.delegatableContractId).to.eq(updateKey[4]);
      expect(updatedKey.ECDSA_secp256k1).to.not.eq(originalKey.ECDSA_secp256k1);
    });

    it('should be able to execute getTokenKey', async function () {
      const tx = await mainContract.getTokenKeyPublic(HTSTokenContractAddress, 2);
      const result = await tx.wait();
      const { responseCode } = result.logs.filter(
        (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.ResponseCode,
      )[0].args;
      expect(responseCode).to.equal(TX_SUCCESS_CODE);
      const { key } = result.logs.filter((e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.TokenKey)[0].args;

      expect(key).to.exist;
      expect(key.inheritAccountKey).to.eq(false);
      expect(key.contractId).to.eq(Constants.ZERO_HEX);
      expect(key.ed25519).to.eq('0x');
      expect(key.ECDSA_secp256k1).to.exist;
      expect(key.delegatableContractId).to.eq(Constants.ZERO_HEX);
    });
  });
});
