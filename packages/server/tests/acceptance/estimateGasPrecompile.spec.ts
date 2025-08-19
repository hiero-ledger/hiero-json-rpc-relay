// SPDX-License-Identifier: Apache-2.0

// External resources
import { numberTo0x } from '@hashgraph/json-rpc-relay/dist/formatters';
import { expect } from 'chai';
import { ethers } from 'ethers';

import RelayCalls from '../../../../packages/server/tests/helpers/constants';
// Constants from local resources
import Constants from '../../tests/helpers/constants';
import MirrorClient from '../clients/mirrorClient';
// Other imports
import RelayClient from '../clients/relayClient';
import ServicesClient from '../clients/servicesClient';
import ERC20MockJson from '../contracts/ERC20Mock.json';
import ERC721MockJson from '../contracts/ERC721Mock.json';
import ERCTestContractJson from '../contracts/ERCTestContract.json';
import EstimatePrecompileContractJson from '../contracts/EstimatePrecompileContract.json';
import PrecompileTestContractJson from '../contracts/PrecompileTestContract.json';
// Local resources
import { Utils } from '../helpers/utils';
import { AliasAccount } from '../types/AliasAccount';

describe('EstimatePrecompileContract tests', function () {
  const signers: AliasAccount[] = [];
  const prefix = '0x';
  const CALL_EXCEPTION = 'CALL_EXCEPTION';
  let contract: ethers.Contract;
  let contractAccount1: ethers.Contract;

  let contractReceipt;
  let EstimatePrecompileContractAddress;
  let tokenAddress;
  let nftAddress;
  let nftSerialNumber;
  let estimateContractSigner0;
  let estimateContractSigner1;
  let estimateContractSigner2;
  let estimateContractSigner3;
  let estimateContractSigner4;
  let nftTokenContract;
  let tokenContract;
  let precompileTestContract;
  let estimateContract;
  const lowerPercentBound = 5;
  const upperPercentBound = 30;
  let ERCcontractReceipt;
  let ERCEstimatePrecompileContractAddress;
  let ERCContract: ethers.Contract;
  let estimateContractAc0;
  let PrecompileContractReceipt;
  let PrecompileContractAddress;

  const usdFee1 = 1;
  const usdFee2 = 2;
  const accounts: AliasAccount[] = [];

  // @ts-ignore
  const {
    servicesNode,
    mirrorNode,
    relay,
  }: { servicesNode: ServicesClient; mirrorNode: MirrorClient; relay: RelayClient } = global;

  async function createFungibleToken() {
    estimateContract = new ethers.Contract(
      prefix + EstimatePrecompileContractAddress,
      EstimatePrecompileContractJson.abi,
      accounts[0].wallet,
    );
    const tx = await estimateContract.createFungibleTokenPublic(accounts[0].wallet.address, {
      value: BigInt('50000000000000000000'),
      gasLimit: 10_000_000,
    });

    const tokenAddress = (await tx.wait()).logs.filter(
      (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.CreatedToken,
    )[0].args[0];
    return tokenAddress;
  }

  async function createNft() {
    const tx = await estimateContract.createNonFungibleTokenPublic(accounts[0].wallet.address, {
      value: BigInt('10000000000000000000'),
      gasLimit: 10_000_000,
    });
    const tokenAddress = (await tx.wait()).logs.filter(
      (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.CreatedToken,
    )[0].args[0];

    return tokenAddress;
  }

  async function mintNFT() {
    // Mint an NFT
    const tx = await estimateContract.mintTokenExternal(nftAddress, 0, ['0x02'], Constants.GAS.LIMIT_1_000_000);

    const serialNumbers = (await tx.wait()).logs.filter(
      (e) => e.fragment.name === Constants.HTS_CONTRACT_EVENTS.MintedToken,
    )[0].args[0];
    nftSerialNumber = Number(serialNumbers[0]);
    expect(nftSerialNumber).to.be.greaterThan(0);
    return nftSerialNumber;
  }

  before(async function () {
    signers[0] = await servicesNode.createAliasAccount(150, relay.provider);
    signers[1] = await servicesNode.createAliasAccount(150, relay.provider);

    contractReceipt = await servicesNode.deployContract(
      EstimatePrecompileContractJson,
      Constants.GAS_AS_NUMBER.LIMIT_5_000_000,
    );
    EstimatePrecompileContractAddress = contractReceipt.contractId.toSolidityAddress();

    ERCcontractReceipt = await servicesNode.deployContract(
      ERCTestContractJson,
      Constants.GAS_AS_NUMBER.LIMIT_5_000_000,
    );
    ERCEstimatePrecompileContractAddress = ERCcontractReceipt.contractId.toSolidityAddress();

    PrecompileContractReceipt = await servicesNode.deployContract(
      PrecompileTestContractJson,
      Constants.GAS_AS_NUMBER.LIMIT_5_000_000,
    );
    PrecompileContractAddress = PrecompileContractReceipt.contractId.toSolidityAddress();

    contract = new ethers.Contract(
      prefix + EstimatePrecompileContractAddress,
      EstimatePrecompileContractJson.abi,
      signers[0].wallet,
    );

    //ERC Contract:
    ERCContract = new ethers.Contract(
      prefix + EstimatePrecompileContractAddress,
      ERCTestContractJson.abi,
      signers[0].wallet,
    );

    const contractMirror = await mirrorNode.get(`/contracts/${EstimatePrecompileContractAddress}`);

    accounts[0] = await servicesNode.createAccountWithContractIdKey(contractMirror.contract_id, 200, relay.provider);

    accounts[1] = await servicesNode.createAccountWithContractIdKey(contractMirror.contract_id, 30, relay.provider);

    accounts[2] = await servicesNode.createAccountWithContractIdKey(contractMirror.contract_id, 30, relay.provider);

    contract = new ethers.Contract(
      prefix + EstimatePrecompileContractAddress,
      EstimatePrecompileContractJson.abi,
      accounts[0].wallet,
    );

    accounts[3] = await servicesNode.createAccountWithContractIdKey(contractMirror.contract_id, 30, relay.provider);

    accounts[4] = await servicesNode.createAccountWithContractIdKey(contractMirror.contract_id, 30, relay.provider);

    tokenAddress = await createFungibleToken();
    nftAddress = await createNft();

    // Create contracts with signers
    estimateContractAc0 = new ethers.Contract(
      prefix + EstimatePrecompileContractAddress,
      EstimatePrecompileContractJson.abi,
      accounts[0].wallet,
    );

    estimateContractSigner0 = new ethers.Contract(
      prefix + EstimatePrecompileContractAddress,
      EstimatePrecompileContractJson.abi,
      accounts[0].wallet,
    );

    estimateContractSigner1 = new ethers.Contract(
      prefix + EstimatePrecompileContractAddress,
      EstimatePrecompileContractJson.abi,
      accounts[1].wallet,
    );

    estimateContractSigner2 = new ethers.Contract(
      prefix + EstimatePrecompileContractAddress,
      EstimatePrecompileContractJson.abi,
      accounts[2].wallet,
    );

    estimateContractSigner3 = new ethers.Contract(
      prefix + EstimatePrecompileContractAddress,
      EstimatePrecompileContractJson.abi,
      accounts[3].wallet,
    );

    estimateContractSigner4 = new ethers.Contract(
      prefix + EstimatePrecompileContractAddress,
      EstimatePrecompileContractJson.abi,
      accounts[4].wallet,
    );

    nftTokenContract = new ethers.Contract(nftAddress, ERC721MockJson.abi, accounts[0].wallet);

    tokenContract = new ethers.Contract(tokenAddress, ERC20MockJson.abi, accounts[0].wallet);

    precompileTestContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[4].wallet,
    );

    //Associating accounts[2] and accounts[3] with fungible token and NFT
    const tx2_ft = await estimateContractSigner2.associateTokenExternal(
      accounts[2].wallet.address,
      tokenAddress,
      Constants.GAS.LIMIT_1_000_000,
    );
    await tx2_ft.wait();

    const tx2_nft = await estimateContractSigner2.associateTokenExternal(
      accounts[2].wallet.address,
      nftAddress,
      Constants.GAS.LIMIT_1_000_000,
    );
    await tx2_nft.wait();

    const tx3_ft = await estimateContractSigner3.associateTokenExternal(
      accounts[3].wallet.address,
      tokenAddress,
      Constants.GAS.LIMIT_1_000_000,
    );
    await tx3_ft.wait();

    const tx3_nft = await estimateContractSigner3.associateTokenExternal(
      accounts[3].wallet.address,
      nftAddress,
      Constants.GAS.LIMIT_1_000_000,
    );
    await tx3_nft.wait();

    //NFT
    await contract.grantTokenKycExternal(nftAddress, accounts[0].wallet.address, Constants.GAS.LIMIT_500_000);
    await contract.grantTokenKycExternal(nftAddress, accounts[1].wallet.address, Constants.GAS.LIMIT_500_000);
    await contract.grantTokenKycExternal(nftAddress, accounts[2].wallet.address, Constants.GAS.LIMIT_500_000);
    await contract.grantTokenKycExternal(nftAddress, accounts[3].wallet.address, Constants.GAS.LIMIT_500_000);
    await contract.grantTokenKycExternal(nftAddress, accounts[4].wallet.address, Constants.GAS.LIMIT_500_000);
    await contract.grantTokenKycExternal(
      nftAddress,
      prefix + EstimatePrecompileContractAddress,
      Constants.GAS.LIMIT_500_000,
    );

    //Fungible
    await contract.grantTokenKycExternal(tokenAddress, accounts[0].wallet.address, Constants.GAS.LIMIT_500_000);
    await contract.grantTokenKycExternal(tokenAddress, accounts[1].wallet.address, Constants.GAS.LIMIT_500_000);
    await contract.grantTokenKycExternal(tokenAddress, accounts[2].wallet.address, Constants.GAS.LIMIT_500_000);
    await contract.grantTokenKycExternal(tokenAddress, accounts[3].wallet.address, Constants.GAS.LIMIT_500_000);
    await contract.grantTokenKycExternal(tokenAddress, accounts[4].wallet.address, Constants.GAS.LIMIT_500_000);
    await contract.grantTokenKycExternal(tokenAddress, prefix + EstimatePrecompileContractAddress, {
      gasLimit: 500_000,
    });
  });

  const baseGasCheck = (estimatedGasValue, expectedValue: number) => {
    expect(Number(estimatedGasValue)).to.be.lessThan(expectedValue * 1.4);
  };

  async function getExchangeRates() {
    const exchangeRateResult = await mirrorNode.get(`/network/exchangerate`);
    return exchangeRateResult;
  }

  function calculateCreateTokenFees(
    usdFee: number,
    exchangeRateCentEquivalent: number,
    exhangeRateHbarEquivalent,
  ): number {
    const hbarPriceInCents = exchangeRateCentEquivalent / exhangeRateHbarEquivalent;
    const usdInCents = 100;
    const feeResult = ((usdInCents * usdFee) / hbarPriceInCents + 1) * 100000000;
    const feeResultInt: number = Math.floor(feeResult);
    return feeResultInt;
  }

  const isWithinDeviation = (
    actualGasUsed: bigint,
    expectedGasUsed: number,
    lowerPercentBound: number,
    upperPercentBound: number,
  ) => {
    const lowerDeviation = (Number(actualGasUsed) * lowerPercentBound) / 100;
    const upperDeviation = (Number(actualGasUsed) * upperPercentBound) / 100;
    const lowerBound = Number(actualGasUsed) + lowerDeviation;
    const upperBound = Number(actualGasUsed) + upperDeviation;
    expect(Number(expectedGasUsed)).to.be.within(
      lowerBound,
      upperBound,
      'expectedGasUsed is not within the deviation of ' + lowerBound + ' to ' + upperBound,
    );
  };

  const isEqualWithDeviation = (actualGasUsed: bigint, expectedGasUsed: number, percentDeviation: number) => {
    const deviation = (Number(actualGasUsed) * percentDeviation) / 100;
    const lowerBound = Number(actualGasUsed) - deviation;
    const upperBound = Number(actualGasUsed) + deviation;
    expect(Number(expectedGasUsed)).to.be.within(
      lowerBound,
      upperBound,
      'expectedGasUsed is not within the deviation of ' + lowerBound + ' to ' + upperBound,
    );
  };

  it('should call estimateGas with transferRedirect function', async function () {
    const spender = prefix + PrecompileContractAddress;

    const precompiletTestContractAssociate = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[4].wallet,
    );

    const associateTx = await precompiletTestContractAssociate.associateTokenExternal(spender, tokenAddress, {
      gasLimit: 1_000_000,
    });
    await associateTx.wait();
    const grantTokenKYCTx = await estimateContractSigner0.grantTokenKycExternal(tokenAddress, spender, {
      gasLimit: 1_000_000,
    });
    await grantTokenKYCTx.wait();

    const approveTx = await tokenContract.approve(spender, Constants.AMOUNT.AMOUNT_10, Constants.GAS.LIMIT_1_000_000);
    await approveTx.wait();

    const transferTx = await tokenContract.transfer(spender, Constants.AMOUNT.AMOUNT_10, Constants.GAS.LIMIT_1_000_000);
    await transferTx.wait();

    const tx = await precompileTestContract.transferRedirect.populateTransaction(
      tokenAddress,
      accounts[2].wallet.address,
      Constants.AMOUNT.AMOUNT_10,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);
    isWithinDeviation(
      BigInt(Constants.ACTUAL_GAS_USED.REDIRECT_TRANSFER),
      estimateGasResponse,
      lowerPercentBound,
      upperPercentBound,
    );
  });

  it('should call estimateGas with transferFromRedirect function', async function () {
    const spender = prefix + PrecompileContractAddress;

    const nftApproveTx = await tokenContract.approve(
      spender,
      Constants.AMOUNT.AMOUNT_10,
      Constants.GAS.LIMIT_1_000_000,
    );
    await nftApproveTx.wait();

    const tx = await precompileTestContract.transferFromRedirect.populateTransaction(
      tokenAddress,
      accounts[0].wallet.address,
      accounts[3].wallet.address,
      Constants.AMOUNT.AMOUNT_10,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);
    isWithinDeviation(
      BigInt(Constants.ACTUAL_GAS_USED.REDIRECT_TRANSFER_FROM),
      estimateGasResponse,
      lowerPercentBound,
      upperPercentBound,
    );
  });

  it('should call estimateGas with approveRedirect function', async function () {
    const spender = prefix + PrecompileContractAddress;

    const grantTokenKYCTx = await estimateContractSigner0.grantTokenKycExternal(
      tokenAddress,
      spender,
      Constants.GAS.LIMIT_1_000_000,
    );
    await grantTokenKYCTx.wait();
    const approveTx = await tokenContract.approve(spender, Constants.AMOUNT.AMOUNT_10, Constants.GAS.LIMIT_1_000_000);
    await approveTx.wait();
    const transferTx = await tokenContract.transfer(spender, Constants.AMOUNT.AMOUNT_10, Constants.GAS.LIMIT_1_000_000);
    await transferTx.wait();

    const associateTx = await estimateContractSigner4.associateTokenExternal(accounts[4].wallet.address, tokenAddress, {
      gasLimit: 1_000_000,
    });
    await associateTx.wait();

    const tx = await precompileTestContract.approveRedirect.populateTransaction(
      tokenAddress,
      accounts[4].wallet.address,
      Constants.AMOUNT.AMOUNT_10,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const disociateResult = await estimateContractSigner4.dissociateTokenExternal(
      accounts[4].wallet.address,
      tokenAddress,
      {
        gasLimit: 1_000_000,
      },
    );
    await disociateResult.wait();

    isWithinDeviation(
      BigInt(Constants.ACTUAL_GAS_USED.REDIRECT_APPROVE),
      estimateGasResponse,
      lowerPercentBound,
      upperPercentBound,
    );
  });

  it('should call estimateGas with redirect transferFromNFT function', async function () {
    const spender = prefix + PrecompileContractAddress;
    const nftSerial = await mintNFT();

    const txResult = await estimateContractSigner4.associateTokenExternal(accounts[4].wallet.address, nftAddress, {
      gasLimit: 1_000_000,
    });
    await txResult.wait();
    const grantTokenKYCTx = await estimateContractSigner0.grantTokenKycExternal(
      nftAddress,
      accounts[4].wallet.address,
      {
        gasLimit: 1_000_000,
      },
    );
    await grantTokenKYCTx.wait();
    const nftApproveTx = await nftTokenContract.approve(
      accounts[4].wallet.address,
      nftSerial,
      Constants.GAS.LIMIT_1_000_000,
    );
    await nftApproveTx.wait();
    const nftApprovePrecompileTx = await nftTokenContract.approve(spender, nftSerial, Constants.GAS.LIMIT_1_000_000);
    await nftApprovePrecompileTx.wait();

    const tx = await precompileTestContract.transferFromRedirect.populateTransaction(
      nftAddress,
      accounts[0].wallet.address,
      accounts[4].wallet.address,
      nftSerial,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const dissociateTxResult = await estimateContractSigner4.dissociateTokenExternal(
      accounts[4].wallet.address,
      nftAddress,
      {
        gasLimit: 1_000_000,
      },
    );
    await dissociateTxResult.wait();
    isWithinDeviation(
      BigInt(Constants.ACTUAL_GAS_USED.REDIRECT_TRANSFER_FROM_NFT),
      estimateGasResponse,
      lowerPercentBound,
      upperPercentBound,
    );
  });

  it('should call estimateGas with associate function for fungible token', async function () {
    const tx = await estimateContractSigner1.associateTokenExternal.populateTransaction(
      accounts[1].wallet.address,
      tokenAddress,
    );

    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);
    const gasResult = await associateAcc(estimateContractSigner1, accounts[1].wallet.address, tokenAddress);
    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with associate function for NFT', async function () {
    const tx = await estimateContractSigner1.associateTokenExternal.populateTransaction(
      accounts[1].wallet.address,
      nftAddress,
    );

    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);
    const gasResult = await associateAcc(estimateContractSigner1, accounts[1].wallet.address, nftAddress);
    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with dissociate token function without association for fungible token - negative', async function () {
    const tx = await contract.dissociateTokenExternal.populateTransaction(accounts[0].wallet.address, tokenAddress);
    await negativeScenarioVerification(tx, CALL_EXCEPTION);
  });

  it('should call estimateGas with dissociate token function without association for NFT - negative', async function () {
    const tx = await contract.dissociateTokenExternal.populateTransaction(accounts[0].wallet.address, nftAddress);
    await negativeScenarioVerification(tx, CALL_EXCEPTION);
  });

  it('should call estimateGas with nested associate function that executes it twice for fungible token - negative', async function () {
    const tx = await contract.nestedAssociateTokenExternal.populateTransaction(
      accounts[0].wallet.address,
      tokenAddress,
    );
    await negativeScenarioVerification(tx, CALL_EXCEPTION);
  });

  it('should call estimateGas with nested associate function that executes it twice for NFT - negative', async function () {
    const tx = await contract.nestedAssociateTokenExternal.populateTransaction(accounts[0].wallet.address, nftAddress);
    await negativeScenarioVerification(tx, CALL_EXCEPTION);
  });

  it('should call estimateGas with approve function without association - negative', async function () {
    const tx = await contract.approveExternal.populateTransaction(
      tokenAddress,
      accounts[1].wallet.address,
      Constants.AMOUNT.AMOUNT_1,
    );
    await negativeScenarioVerification(tx, CALL_EXCEPTION);
  });

  it('should call estimateGas with approveNFT function without association - negative', async function () {
    const nftSerial = await mintNFT();
    const tx = await contract.approveNFTExternal.populateTransaction(nftAddress, accounts[1].wallet.address, nftSerial);
    await negativeScenarioVerification(tx, CALL_EXCEPTION);
  });

  it('should call estimateGas with dissociate token function for fungible token', async function () {
    const tx = await estimateContractSigner1.dissociateTokenExternal.populateTransaction(
      accounts[1].wallet.address,
      tokenAddress,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const gasResult = await dissociateAcc(estimateContractSigner1, accounts[1].wallet.address, tokenAddress);
    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with dissociate token function for NFT', async function () {
    const tx = await estimateContractSigner1.dissociateTokenExternal.populateTransaction(
      accounts[1].wallet.address,
      nftAddress,
    );

    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const gasResult = await dissociateAcc(estimateContractSigner1, accounts[1].wallet.address, nftAddress);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with dissociate and associate nested function for fungible token', async function () {
    const tx = await contract.dissociateAndAssociateTokenExternal.populateTransaction(
      accounts[3].wallet.address,
      tokenAddress,
    );

    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);
    const txResult = await contract.dissociateAndAssociateTokenExternal(accounts[3].wallet.address, tokenAddress);
    const gasResult = await txResult.wait();
    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with dissociate and associate nested function for NFT', async function () {
    const tx = await contract.dissociateAndAssociateTokenExternal.populateTransaction(
      accounts[3].wallet.address,
      nftAddress,
    );

    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);
    const txResult = await contract.dissociateAndAssociateTokenExternal(accounts[3].wallet.address, nftAddress);
    const gasResult = await txResult.wait();
    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with setApprovalForAll function without association - negative', async function () {
    const tx = await contract.setApprovalForAllExternal.populateTransaction(
      tokenAddress,
      accounts[1].wallet.address,
      true,
    );
    await negativeScenarioVerification(tx, CALL_EXCEPTION);
  });

  it('should call estimateGas with approve function', async function () {
    const spender = prefix + EstimatePrecompileContractAddress;

    await associateAcc(estimateContractSigner1, spender, tokenAddress);
    const gasResult = await approveAcc(estimateContractSigner0, tokenAddress, spender, Constants.AMOUNT.AMOUNT_10);

    const tx = await estimateContractSigner0.approveExternal.populateTransaction(
      tokenAddress,
      spender,
      Constants.AMOUNT.AMOUNT_10,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with approveNFT function', async function () {
    const spender = prefix + EstimatePrecompileContractAddress;
    const nftSerial = await mintNFT();

    //approve EstimatePrecompileContract to use the NFT
    const nftApproveTX = await nftTokenContract.approve(spender, nftSerial, Constants.GAS.LIMIT_1_000_000);
    await nftApproveTX.wait();

    //associate EstimatePrecompileContract to with the NFT
    const accountAssociateTX = await estimateContractSigner0.associateTokenExternal(spender, nftAddress);
    await accountAssociateTX.wait();

    //Grant token KYC for EstimatePrecompileContract
    const grantTokenKYCTX = await estimateContractSigner0.grantTokenKycExternal(nftAddress, spender);
    await grantTokenKYCTX.wait();

    //Transfer the NFT to EstimatePrecompileContract
    const nftTransferTX = await nftTokenContract.transferFrom(accounts[0].wallet.address, spender, nftSerial, {
      gasLimit: 1_000_000,
    });
    await nftTransferTX.wait();

    //Perform approveNFTExternal with EstimatePreocmpileContract
    const txResult = await estimateContractSigner0.approveNFTExternal(
      nftAddress,
      accounts[2].wallet.address,
      nftSerial,
    );
    const gasResult = await txResult.wait();

    const tx = await estimateContractSigner0.approveNFTExternal.populateTransaction(
      nftAddress,
      accounts[2].wallet.address,
      nftSerial,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with setApprovalForAll function', async function () {
    const txResult = await estimateContractSigner0.setApprovalForAllExternal(
      nftAddress,
      accounts[3].wallet.address,
      true,
    );
    const gasResult = await txResult.wait();

    const tx = await estimateContractSigner0.setApprovalForAllExternal.populateTransaction(
      nftAddress,
      accounts[1].wallet.address,
      true,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);
    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with transferFromNFT function', async function () {
    const spender = prefix + EstimatePrecompileContractAddress;
    const nftSerial = await mintNFT();

    const nftApproveTX = await nftTokenContract.approve(spender, nftSerial, Constants.GAS.LIMIT_1_000_000);
    await nftApproveTX.wait();

    const grantTokenKYCTX = await estimateContractSigner0.grantTokenKycExternal(nftAddress, spender);
    await grantTokenKYCTX.wait();

    //perform estimate gas for transferFromNFT
    const tx = await estimateContractSigner0.transferFromNFTExternal.populateTransaction(
      nftAddress,
      accounts[0].wallet.address,
      accounts[2].wallet.address,
      nftSerial,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    //perform real transaction for transferFromNFT
    const txResult = await estimateContractSigner0.transferFromNFTExternal(
      nftAddress,
      accounts[0].wallet.address,
      accounts[2].wallet.address,
      nftSerial,
    );
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with transferFrom function without approval - negative', async function () {
    const tx = await contract.transferFromExternal.populateTransaction(
      tokenAddress,
      accounts[0].wallet.address,
      accounts[1].wallet.address,
      Constants.AMOUNT.AMOUNT_1,
    );
    negativeScenarioVerification(tx, CALL_EXCEPTION);
  });

  it('should call estimateGas with transferFrom function', async function () {
    const spender = prefix + EstimatePrecompileContractAddress;

    const approveTx = await tokenContract.approve(
      accounts[1].wallet.address,
      Constants.AMOUNT.AMOUNT_10,
      Constants.GAS.LIMIT_1_000_000,
    );
    await approveTx.wait();

    const approveContractTx = await tokenContract.approve(
      spender,
      Constants.AMOUNT.AMOUNT_10,
      Constants.GAS.LIMIT_1_000_000,
    );
    await approveContractTx.wait();

    const tx = await estimateContractSigner1.transferFromExternal.populateTransaction(
      tokenAddress,
      accounts[0].wallet.address,
      accounts[2].wallet.address,
      Constants.AMOUNT.AMOUNT_10,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const transferFromTx = await estimateContractSigner1.transferFromExternal(
      tokenAddress,
      accounts[0].wallet.address,
      accounts[2].wallet.address,
      Constants.AMOUNT.AMOUNT_10,
    );
    const gasResult = await transferFromTx.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with transferFrom function with more than the approved allowance - negative', async function () {
    const tx = await contract.transferFromExternal.populateTransaction(
      tokenAddress,
      contract.target,
      accounts[0].wallet.address,
      Constants.AMOUNT.AMOUNT_100,
    );
    negativeScenarioVerification(tx, CALL_EXCEPTION);
  });

  it('should call estimateGas with transferFromNFT with invalid serial number - negative', async function () {
    const wrongNFTSerial = 10;

    const tx = await contract.transferFromNFTExternal.populateTransaction(
      nftAddress,
      accounts[0].wallet.address,
      accounts[1].wallet.address,
      wrongNFTSerial,
    );
    negativeScenarioVerification(tx, CALL_EXCEPTION);
  });

  it('should call estimateGas with transferToken function', async function () {
    const tx = await contract.transferTokenExternal.populateTransaction(
      tokenAddress,
      accounts[0].wallet.address,
      accounts[2].wallet.address,
      Constants.AMOUNT.AMOUNT_1,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await contract.transferTokenExternal(
      tokenAddress,
      accounts[0].wallet.address,
      accounts[2].wallet.address,
      Constants.AMOUNT.AMOUNT_1,
    );
    const gasResult = await txResult.wait();
    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with transferNFT function', async function () {
    const nftSerial = await mintNFT();

    const tx = await contract.transferNFTExternal.populateTransaction(
      nftAddress,
      accounts[0].wallet.address,
      accounts[2].wallet.address,
      nftSerial,
    );

    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);
    const txResult = await contract.transferNFTExternal(
      nftAddress,
      accounts[0].wallet.address,
      accounts[2].wallet.address,
      nftSerial,
    );
    const gasResult = await txResult.wait();
    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with approveERC function for fungible token', async function () {
    const txResult = await tokenContract.approve(accounts[1].wallet.address, Constants.AMOUNT.AMOUNT_10);
    const gasResult = await txResult.wait();
    const tx = await tokenContract.approve.populateTransaction(accounts[1].wallet.address, Constants.AMOUNT.AMOUNT_10);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with approveERC function without approval for fungible token', async function () {
    const tokenContract = new ethers.Contract(
      prefix + ERCcontractReceipt.contractId.toSolidityAddress(),
      ERCTestContractJson.abi,
      accounts[1].wallet,
    );

    const tx = await tokenContract.transferFrom.populateTransaction(
      tokenAddress,
      accounts[0].wallet.address,
      accounts[2].wallet.address,
      Constants.AMOUNT.AMOUNT_10,
    );
    negativeScenarioVerification(tx, CALL_EXCEPTION);
  });

  it('Should call estimateGas with ERC transferFrom function for fungible token', async function () {
    const tokenContract1 = new ethers.Contract(tokenAddress, ERC20MockJson.abi, accounts[1].wallet);

    const txResultApprove = await tokenContract.approve(accounts[1].wallet.address, 10);
    await txResultApprove.wait();

    const tx = await tokenContract1.transferFrom.populateTransaction(
      accounts[0].wallet.address,
      accounts[3].wallet.address,
      9,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(
      BigInt(Constants.ACTUAL_GAS_USED.ERC_TRANSFER_FROM),
      estimateGasResponse,
      lowerPercentBound,
      upperPercentBound,
    );
  });

  it('Should call estimateGas with ERC transferFrom function with more than the approved allowance for fungible token', async function () {
    const tokenContract1 = new ethers.Contract(tokenAddress, ERC20MockJson.abi, accounts[1].wallet);
    const txResultApprove = await tokenContract.approve(accounts[1].wallet.address, 10);
    await txResultApprove.wait();

    const allowance = await tokenContract.allowance(accounts[0].wallet.address, accounts[1].wallet.address);

    const tx = await tokenContract1.transferFrom.populateTransaction(
      accounts[0].wallet.address,
      accounts[3].wallet.address,
      50,
    );
    tx.from = accounts[1].wallet.address;
    await negativeScenarioVerification(tx, CALL_EXCEPTION);
  });

  it('Should call estimateGas with ERC transfer function for fungible token', async function () {
    const txResult = await tokenContract.transfer(accounts[2].wallet.address, 10);
    const gasResult = await txResult.wait();

    const tx = await tokenContract.transfer.populateTransaction(accounts[2].wallet.address, 10);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('Should call estimateGas with ERC getApproved function for NFT', async function () {
    const nftSerial = await mintNFT();
    const tokenContract = new ethers.Contract(nftAddress, ERC721MockJson.abi, accounts[1].wallet);

    const txResult = await tokenContract.getApproved(nftSerial);

    const tx = await tokenContract.getApproved.populateTransaction(nftSerial);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isEqualWithDeviation(
      BigInt(Constants.ACTUAL_GAS_USED.ERC_GET_APPROVED_NFT),
      estimateGasResponse,
      lowerPercentBound,
    );
  });

  it('Should call estimateGas with ERC isApprovedForAll', async function () {
    const tokenContract = new ethers.Contract(tokenAddress, ERC721MockJson.abi, accounts[0].wallet);

    const txResult = await tokenContract.isApprovedForAll(accounts[0].wallet.address, accounts[1].wallet.address);

    const tx = await tokenContract.isApprovedForAll.populateTransaction(
      accounts[0].wallet.address,
      accounts[1].wallet.address,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isEqualWithDeviation(
      BigInt(Constants.ACTUAL_GAS_USED.ERC_IS_APPROVED_FOR_ALL),
      estimateGasResponse,
      lowerPercentBound,
    );
  });

  it('should call estimateGas with associate function for fungible tokens', async function () {
    const tokens: string[] = [tokenAddress];

    const tx = await estimateContractSigner1.associateTokensExternal.populateTransaction(
      accounts[1].wallet.address,
      tokens,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractSigner1.associateTokensExternal(accounts[1].wallet.address, tokens);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with associate function for NFTs', async function () {
    const tokens: string[] = [nftAddress];

    const tx = await estimateContractSigner1.associateTokensExternal.populateTransaction(
      accounts[1].wallet.address,
      tokens,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractSigner1.associateTokensExternal(accounts[1].wallet.address, tokens);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with dissociateTokens function for fungible token', async function () {
    const tokens: string[] = [tokenAddress];
    await associateAcc(estimateContractSigner4, accounts[4].wallet.address, tokenAddress);

    const tx = await estimateContractSigner4.dissociateTokensExternal.populateTransaction(
      accounts[4].wallet.address,
      tokens,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);
    const txResult = await estimateContractSigner4.dissociateTokensExternal(accounts[4].wallet.address, tokens);
    const gasResult = await txResult.wait();
    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with dissociateTokens function for NFT', async function () {
    const tokens: string[] = [nftAddress];
    await associateAcc(estimateContractSigner4, accounts[4].wallet.address, nftAddress);

    const tx = await estimateContractSigner4.dissociateTokensExternal.populateTransaction(
      accounts[4].wallet.address,
      tokens,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);
    const txResult = await estimateContractSigner4.dissociateTokensExternal(accounts[4].wallet.address, tokens);
    const gasResult = await txResult.wait();
    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with transferTokens function for fungible token', async function () {
    const amounts: number[] = [-10, 10];
    const transferAccounts: string[] = [accounts[0].wallet.address, accounts[2].wallet.address];

    const tx = await estimateContractSigner0.transferTokensExternal.populateTransaction(
      tokenAddress,
      transferAccounts,
      amounts,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractSigner0.transferTokensExternal(tokenAddress, transferAccounts, amounts);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with transferNFTs function', async function () {
    const nftSerial = await mintNFT();
    const nftSerial2 = await mintNFT();
    const serialNumbers: number[] = [nftSerial, nftSerial2];
    const receiverAccounts: string[] = [accounts[2].wallet.address, accounts[3].wallet.address];
    const senderAccounts: string[] = [accounts[0].wallet.address];

    const tx = await contract.transferNFTsExternal.populateTransaction(
      nftAddress,
      senderAccounts,
      receiverAccounts,
      serialNumbers,
    );

    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await contract.transferNFTsExternal(nftAddress, senderAccounts, receiverAccounts, serialNumbers);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with cryptoTransfer function for hbars', async function () {
    const cryptoTransfers = {
      transfers: [
        {
          accountID: accounts[0].wallet.address,
          amount: -10_000,
          isApproval: false,
        },
        {
          accountID: accounts[1].wallet.address,
          amount: 10_000,
          isApproval: false,
        },
      ],
    };
    const tokenTransferList = [];

    const tx = await estimateContractAc0.cryptoTransferExternal.populateTransaction(cryptoTransfers, tokenTransferList);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractAc0.cryptoTransferExternal(cryptoTransfers, tokenTransferList);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with cryptoTransfer function for NFT', async function () {
    const nftSerial = await mintNFT();

    const cryptoTransfers = {
      transfers: [],
    };

    const tokenTransferList = [
      {
        token: nftAddress,
        transfers: [],
        nftTransfers: [
          {
            senderAccountID: accounts[0].wallet.address,
            receiverAccountID: accounts[2].wallet.address,
            serialNumber: nftSerial,
            isApproval: false,
          },
        ],
      },
    ];

    const tx = await estimateContractAc0.cryptoTransferExternal.populateTransaction(cryptoTransfers, tokenTransferList);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractAc0.cryptoTransferExternal(cryptoTransfers, tokenTransferList);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with cryptoTransfer function for fungible token', async function () {
    const cryptoTransfers = {
      transfers: [],
    };

    const tokenTransferList = [
      {
        token: tokenAddress,
        transfers: [
          {
            accountID: accounts[2].wallet.address,
            amount: 10,
            isApproval: false,
          },
          {
            accountID: accounts[0].wallet.address,
            amount: -10,
            isApproval: false,
          },
        ],
        nftTransfers: [],
      },
    ];

    const tx = await estimateContractAc0.cryptoTransferExternal.populateTransaction(cryptoTransfers, tokenTransferList);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractAc0.cryptoTransferExternal(cryptoTransfers, tokenTransferList);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with mintToken function for fungible token', async function () {
    const txResult = await contract.mintTokenExternal(tokenAddress, 0, ['0x02']);
    const gasResult = await txResult.wait();

    const tx = await contract.mintTokenExternal.populateTransaction(tokenAddress, 0, ['0x02']);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with mintToken function for NFT', async function () {
    const txResult = await contract.mintTokenExternal(nftAddress, 0, ['0x02']);
    const gasResult = await txResult.wait();

    const tx = await contract.mintTokenExternal.populateTransaction(nftAddress, 0, ['0x02']);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with burnToken function for fungible token', async function () {
    const txResult = await contract.burnTokenExternal(tokenAddress, 0, ['0x02']);
    const gasResult = await txResult.wait();

    const tx = await contract.burnTokenExternal.populateTransaction(tokenAddress, 0, ['0x02']);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with burnToken function for NFT', async function () {
    const nftSerial = await mintNFT();
    const serialNumbers: number[] = [nftSerial];
    const tx = await contract.burnTokenExternal.populateTransaction(nftAddress, 0, serialNumbers);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);
    const txResult = await contract.burnTokenExternal(nftAddress, 0, serialNumbers);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with createFungible token function', async function () {
    const exchangeRatesResult = await getExchangeRates();
    const calculateFee = calculateCreateTokenFees(
      usdFee1,
      exchangeRatesResult.current_rate.cent_equivalent,
      exchangeRatesResult.current_rate.hbar_equivalent,
    );
    const hexNumber = numberTo0x(calculateFee * 10000000000);

    const accountWallet = await mirrorNode.get(`/accounts/${accounts[0].wallet.address}`);
    const accountLongZero = Utils.idToEvmAddress(accountWallet.account);

    const NewestimateContract = new ethers.Contract(
      prefix + EstimatePrecompileContractAddress,
      EstimatePrecompileContractJson.abi,
      accounts[0].wallet,
    );

    const txs = await NewestimateContract.createFungibleTokenPublic(accounts[0].wallet.address, {
      value: hexNumber,
    });
    const gasResult = await txs.wait();

    const populate: any = await NewestimateContract.createFungibleTokenPublic.populateTransaction(
      accounts[0].wallet.address,
      {
        value: hexNumber,
      },
    );
    populate.from = accountLongZero;
    populate.value = hexNumber;

    const estimateGasResponse2 = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [populate]);
    isWithinDeviation(gasResult.gasUsed, estimateGasResponse2, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with createNonFungibleToken function', async function () {
    const exchangeRatesResult = await getExchangeRates();
    const calculateFee = calculateCreateTokenFees(
      usdFee1,
      exchangeRatesResult.current_rate.cent_equivalent,
      exchangeRatesResult.current_rate.hbar_equivalent,
    );
    const hexNumber = numberTo0x(calculateFee * 10000000000);

    const accountWallet = await mirrorNode.get(`/accounts/${accounts[0].wallet.address}`);
    const accountLongZero = Utils.idToEvmAddress(accountWallet.account);

    const NewestimateContract = new ethers.Contract(
      prefix + EstimatePrecompileContractAddress,
      EstimatePrecompileContractJson.abi,
      accounts[0].wallet,
    );

    const txs = await NewestimateContract.createNonFungibleTokenPublic(accounts[0].wallet.address, {
      value: hexNumber,
    });
    const gasResult = await txs.wait();

    const populate: any = await NewestimateContract.createNonFungibleTokenPublic.populateTransaction(
      accounts[0].wallet.address,
      {
        value: hexNumber,
      },
    );
    populate.from = accountLongZero;
    populate.value = hexNumber;

    const estimateGasResponse2 = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [populate]);
    isWithinDeviation(gasResult.gasUsed, estimateGasResponse2, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with createFungibleToken with custom fees function', async function () {
    const exchangeRatesResult = await getExchangeRates();
    const calculateFee = calculateCreateTokenFees(
      usdFee2,
      exchangeRatesResult.current_rate.cent_equivalent,
      exchangeRatesResult.current_rate.hbar_equivalent,
    );
    const hexNumber = numberTo0x(calculateFee * 10000000000);

    const accountWallet = await mirrorNode.get(`/accounts/${accounts[0].wallet.address}`);
    const accountLongZero = Utils.idToEvmAddress(accountWallet.account);

    const txs = await estimateContractSigner0.createFungibleTokenWithCustomFeesPublic(
      accounts[0].wallet.address,
      tokenAddress,
      {
        value: hexNumber,
      },
    );
    const gasResult = await txs.wait();

    const populate: any = await estimateContractSigner0.createFungibleTokenWithCustomFeesPublic.populateTransaction(
      accounts[0].wallet.address,
      tokenAddress,
      {
        value: hexNumber,
      },
    );
    populate.from = accountLongZero;
    populate.value = hexNumber;

    const estimateGasResponse2 = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [populate]);
    isWithinDeviation(gasResult.gasUsed, estimateGasResponse2, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with createNonFungibleToken with custom fees function', async function () {
    const exchangeRatesResult = await getExchangeRates();
    const calculateFee = calculateCreateTokenFees(
      usdFee2,
      exchangeRatesResult.current_rate.cent_equivalent,
      exchangeRatesResult.current_rate.hbar_equivalent,
    );
    const hexNumber = numberTo0x(calculateFee * 10000000000);

    const accountWallet = await mirrorNode.get(`/accounts/${accounts[0].wallet.address}`);
    const accountLongZero = Utils.idToEvmAddress(accountWallet.account);

    const txs = await estimateContractSigner0.createNonFungibleTokenWithCustomFeesPublic(
      accounts[0].wallet.address,
      tokenAddress,
      {
        value: hexNumber,
      },
    );
    const gasResult = await txs.wait();

    const populate: any = await estimateContractSigner0.createNonFungibleTokenWithCustomFeesPublic.populateTransaction(
      accounts[0].wallet.address,
      tokenAddress,
      {
        value: hexNumber,
      },
    );
    populate.from = accountLongZero;
    populate.value = hexNumber;

    const estimateGasResponse2 = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [populate]);
    isWithinDeviation(gasResult.gasUsed, estimateGasResponse2, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with WipeTokenAccount token function', async function () {
    const grantTokenKYCTx = await estimateContractSigner0.grantTokenKycExternal(
      tokenAddress,
      accounts[3].wallet.address,
      {
        gasLimit: 1_000_000,
      },
    );
    await grantTokenKYCTx.wait();

    const transferTx = await tokenContract.transfer(
      accounts[3].wallet.address,
      Constants.AMOUNT.AMOUNT_10,
      Constants.GAS.LIMIT_1_000_000,
    );
    await transferTx.wait();

    const txs = await contract.wipeTokenAccountExternal(tokenAddress, accounts[3].wallet.address, 0x02);
    const gasResult = await txs.wait();

    const populate: any = await estimateContractSigner0.wipeTokenAccountExternal.populateTransaction(
      tokenAddress,
      accounts[3].wallet.address,
      2,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [populate]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with WipeTokenAccount token function with invalid amount', async function () {
    const grantTokenKYCTx = await estimateContractSigner0.grantTokenKycExternal(
      nftAddress,
      accounts[3].wallet.address,
      {
        gasLimit: 1_000_000,
      },
    );
    await grantTokenKYCTx.wait();

    const transferTx = await tokenContract.transfer(
      accounts[3].wallet.address,
      Constants.AMOUNT.AMOUNT_10,
      Constants.GAS.LIMIT_1_000_000,
    );
    await transferTx.wait();

    const populate: any = await estimateContractSigner0.wipeTokenAccountExternal.populateTransaction(
      tokenAddress,
      accounts[3].wallet.address,
      Constants.AMOUNT.INVALID_AMOUNT,
    );
    await negativeScenarioVerification(populate, CALL_EXCEPTION);
  });

  it('should call estimateGas with wipeTokenAccountNFT function', async function () {
    const nftSerial = await mintNFT();
    const serialNumbers: number[] = [nftSerial];
    const transferTx = await nftTokenContract.transferFrom(
      accounts[0].wallet.address,
      accounts[3].wallet.address,
      nftSerial,
      {
        gasLimit: 1_000_000,
      },
    );
    await transferTx.wait();

    const populate: any = await contract.wipeTokenAccountNFTExternal.populateTransaction(
      nftAddress,
      accounts[3].wallet.address,
      serialNumbers,
    );

    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [populate]);

    const txs = await contract.wipeTokenAccountNFTExternal(nftAddress, accounts[3].wallet.address, serialNumbers);
    const gasResult = await txs.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with wipeTokenAccountNFT function with invalid serial number', async function () {
    const nftSerial = await mintNFT();
    const invalidSerialNumbers: number[] = [100];

    const transferTx = await nftTokenContract.transferFrom(
      accounts[0].wallet.address,
      accounts[3].wallet.address,
      nftSerial,
      {
        gasLimit: 1_000_000,
      },
    );
    await transferTx.wait();

    const populate: any = await contract.wipeTokenAccountNFTExternal.populateTransaction(
      nftAddress,
      accounts[3].wallet.address,
      invalidSerialNumbers,
    );

    await negativeScenarioVerification(populate, CALL_EXCEPTION);
  });

  it('should call estimateGas with grantTokenKycExternal function for fungible token', async function () {
    const tx = await contract.grantTokenKycExternal.populateTransaction(tokenAddress, accounts[2].wallet.address);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await contract.grantTokenKycExternal(tokenAddress, accounts[2].wallet.address);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with grantTokenKycExternal function for NFT', async function () {
    const tx = await contract.grantTokenKycExternal.populateTransaction(nftAddress, accounts[2].wallet.address);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await contract.grantTokenKycExternal(nftAddress, accounts[2].wallet.address);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with revokeTokenKycExternal function for fungible token', async function () {
    const tx = await contract.revokeTokenKycExternal.populateTransaction(tokenAddress, accounts[2].wallet.address);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await contract.revokeTokenKycExternal(tokenAddress, accounts[2].wallet.address);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with revokeTokenKycExternal function for NFT', async function () {
    const tx = await contract.revokeTokenKycExternal.populateTransaction(nftAddress, accounts[2].wallet.address);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await contract.revokeTokenKycExternal(nftAddress, accounts[2].wallet.address);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with Grant and Revoke KYC nested function', async function () {
    const tx = await contract.nestedGrantAndRevokeTokenKYCExternal.populateTransaction(
      tokenAddress,
      accounts[2].wallet.address,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await contract.nestedGrantAndRevokeTokenKYCExternal(tokenAddress, accounts[2].wallet.address);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with Freeze function for fungible token', async function () {
    const tx = await contract.freezeTokenExternal.populateTransaction(tokenAddress, accounts[0].wallet.address);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await contract.freezeTokenExternal(tokenAddress, accounts[0].wallet.address);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with Freeze function for NFT', async function () {
    const tx = await contract.freezeTokenExternal.populateTransaction(nftAddress, accounts[0].wallet.address);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await contract.freezeTokenExternal(nftAddress, accounts[0].wallet.address);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with Unfreeze function for fungible token', async function () {
    const tx = await contract.unfreezeTokenExternal.populateTransaction(tokenAddress, accounts[0].wallet.address);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await contract.unfreezeTokenExternal(tokenAddress, accounts[0].wallet.address);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with Unfreeze function for NFT', async function () {
    const tx = await contract.unfreezeTokenExternal.populateTransaction(nftAddress, accounts[0].wallet.address);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await contract.unfreezeTokenExternal(nftAddress, accounts[0].wallet.address);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with Nested Freeze and Unfreeze function for fungible token', async function () {
    const tx = await contract.nestedFreezeUnfreezeTokenExternal.populateTransaction(
      tokenAddress,
      accounts[0].wallet.address,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await contract.nestedFreezeUnfreezeTokenExternal(tokenAddress, accounts[0].wallet.address);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with nested Freeze and Unfreeze function for NFT', async function () {
    const tx = await contract.nestedFreezeUnfreezeTokenExternal.populateTransaction(
      nftAddress,
      accounts[0].wallet.address,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await contract.nestedFreezeUnfreezeTokenExternal(nftAddress, accounts[0].wallet.address);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with delete function with invalid token serial', async function () {
    const tx = await contract.deleteTokenExternal.populateTransaction(Constants.NON_EXISTING_ADDRESS);

    await negativeScenarioVerification(tx, CALL_EXCEPTION);
  });

  it('should call estimateGas with updateTokenExpiryInfo function', async function () {
    const tx = await estimateContractAc0.updateTokenExpiryInfoExternal.populateTransaction(
      tokenAddress,
      accounts[0].wallet.address,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(
      BigInt(Constants.ACTUAL_GAS_USED.UPDATE_TOKEN_EXPIRY_INFO),
      estimateGasResponse,
      lowerPercentBound,
      upperPercentBound,
    );
  });

  it('should call estimateGas with updateTokenInfo function', async function () {
    const tx = await estimateContractAc0.updateTokenInfoExternal.populateTransaction(
      tokenAddress,
      accounts[0].wallet.address,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(
      BigInt(Constants.ACTUAL_GAS_USED.UPDATE_TOKEN_INFO),
      estimateGasResponse,
      lowerPercentBound,
      upperPercentBound,
    );
  });

  it('should call estimateGas with updateTokenKeys function', async function () {
    const tx = await estimateContractAc0.updateTokenKeysExternal.populateTransaction(tokenAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(
      BigInt(Constants.ACTUAL_GAS_USED.UPDATE_TOKEN_KEYS),
      estimateGasResponse,
      lowerPercentBound,
      upperPercentBound,
    );
  });

  it('should call estimateGas with pause function for fungible token', async function () {
    const tx = await estimateContractAc0.pauseTokenExternal.populateTransaction(tokenAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractAc0.pauseTokenExternal(tokenAddress);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with pause function for NFT', async function () {
    const tx = await estimateContractAc0.pauseTokenExternal.populateTransaction(nftAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractAc0.pauseTokenExternal(nftAddress);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with pause function for fungible token', async function () {
    const tx = await estimateContractAc0.unpauseTokenExternal.populateTransaction(tokenAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractAc0.unpauseTokenExternal(tokenAddress);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with pause function for fungible token', async function () {
    const tx = await estimateContractAc0.unpauseTokenExternal.populateTransaction(nftAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractAc0.unpauseTokenExternal(nftAddress);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with nested pause and unpause function for fungible token', async function () {
    const tx = await estimateContractAc0.nestedPauseUnpauseTokenExternal.populateTransaction(tokenAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractAc0.nestedPauseUnpauseTokenExternal(tokenAddress);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with nested pause and unpause function for NFT', async function () {
    const tx = await estimateContractAc0.nestedPauseUnpauseTokenExternal.populateTransaction(nftAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractAc0.nestedPauseUnpauseTokenExternal(nftAddress);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with getTokenExpiryInfo function', async function () {
    const tx = await estimateContractAc0.getTokenExpiryInfoExternal.populateTransaction(tokenAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractAc0.getTokenExpiryInfoExternal(tokenAddress);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with isToken  function', async function () {
    const tx = await estimateContractAc0.isTokenExternal.populateTransaction(tokenAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractAc0.isTokenExternal(tokenAddress);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with getTokenKey  function for supply', async function () {
    const tx = await estimateContractAc0.getTokenKeyExternal.populateTransaction(tokenAddress, 16);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractAc0.getTokenKeyExternal(tokenAddress, 16);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with getTokenKey  function for KYC', async function () {
    const tx = await estimateContractAc0.getTokenKeyExternal.populateTransaction(tokenAddress, 2);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractAc0.getTokenKeyExternal(tokenAddress, 2);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with getTokenKey  function for freeze', async function () {
    const tx = await estimateContractAc0.getTokenKeyExternal.populateTransaction(tokenAddress, 4);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractAc0.getTokenKeyExternal(tokenAddress, 4);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with getTokenKey  function for admin', async function () {
    const tx = await estimateContractAc0.getTokenKeyExternal.populateTransaction(tokenAddress, 1);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractAc0.getTokenKeyExternal(tokenAddress, 1);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with getTokenKey  function for wipe', async function () {
    const tx = await estimateContractAc0.getTokenKeyExternal.populateTransaction(tokenAddress, 8);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractAc0.getTokenKeyExternal(tokenAddress, 8);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with getTokenKey function for fee', async function () {
    const tx = await estimateContractSigner1.getTokenKeyExternal.populateTransaction(tokenAddress, 32);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractSigner1.getTokenKeyExternal(tokenAddress, 32);

    isWithinDeviation(
      BigInt(Constants.ACTUAL_GAS_USED.GET_TOKEN_KEY_FEE),
      estimateGasResponse,
      lowerPercentBound,
      upperPercentBound,
    );
  });

  it('should call estimateGas with getTokenKey  function for pause', async function () {
    const tx = await estimateContractAc0.getTokenKeyExternal.populateTransaction(tokenAddress, 64);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractAc0.getTokenKeyExternal(tokenAddress, 64);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with allowance function for fungible token', async function () {
    const spender = prefix + EstimatePrecompileContractAddress;

    const approveTx = await tokenContract.approve(spender, 10, Constants.GAS.LIMIT_1_000_000);
    await approveTx.wait();

    const tx = await estimateContractAc0.allowanceExternal.populateTransaction(
      tokenAddress,
      accounts[1].wallet.address,
      spender,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractAc0.allowanceExternal(tokenAddress, accounts[3].wallet.address, spender);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with allowance function for NFT', async function () {
    const spender = prefix + EstimatePrecompileContractAddress;

    const nftSerial = await mintNFT();

    const nftApproveTX = await nftTokenContract.approve(spender, nftSerialNumber, Constants.GAS.LIMIT_1_000_000);
    await nftApproveTX.wait();

    const txResult = await estimateContractSigner0.allowanceExternal(nftAddress, accounts[0].wallet.address, spender);
    const gasResult = await txResult.wait();

    const tx = await estimateContractSigner0.allowanceExternal.populateTransaction(
      nftAddress,
      accounts[0].wallet.address,
      spender,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with getApproved function for NFT', async function () {
    const nftSerial = await mintNFT();

    const tx = await estimateContractSigner2.getApprovedExternal.populateTransaction(nftAddress, nftSerial);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractSigner2.getApprovedExternal(nftAddress, nftSerial);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with isApprovedForAll  function', async function () {
    const tx = await estimateContractAc0.isApprovedForAllExternal.populateTransaction(
      tokenAddress,
      accounts[0].wallet.address,
      accounts[1].wallet.address,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await estimateContractAc0.isApprovedForAllExternal(
      tokenAddress,
      accounts[0].wallet.address,
      accounts[1].wallet.address,
    );
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with ERC name function for fungible token', async function () {
    const tx = await tokenContract.name.populateTransaction();
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isEqualWithDeviation(BigInt(Constants.ACTUAL_GAS_USED.ERC_NAME), estimateGasResponse, lowerPercentBound);
  });

  it('should call estimateGas with ERC name function for fungible NFT', async function () {
    const txResult = await nftTokenContract.name();
    const tx = await nftTokenContract.name.populateTransaction();
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isEqualWithDeviation(BigInt(Constants.ACTUAL_GAS_USED.ERC_NAME_NFT), estimateGasResponse, lowerPercentBound);
  });

  it('should call estimateGas with ERC symbol function for fungible token', async function () {
    const txResult = await tokenContract.symbol();
    const tx = await tokenContract.symbol.populateTransaction();
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isEqualWithDeviation(BigInt(Constants.ACTUAL_GAS_USED.ERC_SYMBOL), estimateGasResponse, lowerPercentBound);
  });

  it('should call estimateGas with ERC symbol function for NFT', async function () {
    const txResult = await nftTokenContract.symbol();
    const tx = await nftTokenContract.symbol.populateTransaction();
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isEqualWithDeviation(BigInt(Constants.ACTUAL_GAS_USED.ERC_SYMBOL_NFT), estimateGasResponse, lowerPercentBound);
  });

  it('should call estimateGas with ERC decimals function for fungible token', async function () {
    const txResult = await tokenContract.decimals();
    const tx = await tokenContract.decimals.populateTransaction();
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isEqualWithDeviation(BigInt(Constants.ACTUAL_GAS_USED.ERC_DECIMALS), estimateGasResponse, lowerPercentBound);
  });

  it('should call estimateGas with ERC totalSupply function for fungible token', async function () {
    const txResult = await tokenContract.totalSupply();
    const tx = await tokenContract.totalSupply.populateTransaction();
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isEqualWithDeviation(BigInt(Constants.ACTUAL_GAS_USED.ERC_TOTAL_SUPPLY), estimateGasResponse, lowerPercentBound);
  });

  it('should call estimateGas with ERC totalSupply function for NFT', async function () {
    const ERCTestContract = new ethers.Contract(
      prefix + ERCcontractReceipt.contractId.toSolidityAddress(),
      ERCTestContractJson.abi,
      accounts[0].wallet,
    );

    const txResult = await ERCTestContract.totalSupplyIERC721(nftAddress);
    const tx = await ERCTestContract.totalSupplyIERC721.populateTransaction(nftAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isEqualWithDeviation(
      BigInt(Constants.ACTUAL_GAS_USED.ERC_TOTAL_SUPPLY_NFT),
      estimateGasResponse,
      lowerPercentBound,
    );
  });

  it('should call estimateGas with ERC balanceOf function for fungible token', async function () {
    const txResult = await tokenContract.balanceOf(accounts[0].wallet.address);
    const tx = await tokenContract.balanceOf.populateTransaction(accounts[0].wallet.address);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isEqualWithDeviation(BigInt(Constants.ACTUAL_GAS_USED.ERC_BALANCE_OF), estimateGasResponse, lowerPercentBound);
  });

  it('should call estimateGas with ERC balanceOf function for NFT', async function () {
    const txResult = await nftTokenContract.balanceOf(accounts[0].wallet.address);
    const tx = await nftTokenContract.balanceOf.populateTransaction(accounts[0].wallet.address);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isEqualWithDeviation(BigInt(Constants.ACTUAL_GAS_USED.ERC_BALANCE_OF_NFT), estimateGasResponse, lowerPercentBound);
  });

  it('should call estimateGas with ERC ownerOf function for NFT', async function () {
    const txResult = await nftTokenContract.ownerOf(nftAddress);
    const tx = await nftTokenContract.ownerOf.populateTransaction(nftAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isEqualWithDeviation(BigInt(Constants.ACTUAL_GAS_USED.ERC_OWNER_OF_NFT), estimateGasResponse, lowerPercentBound);
  });

  it('should call estimateGas with ERC tokenURI function for NFT', async function () {
    const txResult = await nftTokenContract.tokenURI(nftAddress);
    const tx = await nftTokenContract.tokenURI.populateTransaction(nftAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isEqualWithDeviation(BigInt(Constants.ACTUAL_GAS_USED.ERC_TOKEN_URI_NFT), estimateGasResponse, lowerPercentBound);
  });

  it('should call estimateGas with  getInformationForFungibleToken function for fungible token', async function () {
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[0].wallet,
    );

    const txResult = await precompileTokenContract.getInformationForFungibleToken(tokenAddress);
    const gasResult = await txResult.wait();

    const tx = await precompileTokenContract.getInformationForFungibleToken.populateTransaction(tokenAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with  getInformationForFungibleToken function for NFT', async function () {
    const nftSerial = await mintNFT();
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[0].wallet,
    );

    const txResult = await precompileTokenContract.getInformationForNonFungibleToken(nftAddress, nftSerial);
    const gasResult = await txResult.wait();

    const tx = await precompileTokenContract.getInformationForNonFungibleToken.populateTransaction(
      nftAddress,
      nftSerial,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with  getInformationForToken function for fungible token', async function () {
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[0].wallet,
    );

    const txResult = await precompileTokenContract.getInformationForToken(tokenAddress);
    const gasResult = await txResult.wait();

    const tx = await precompileTokenContract.getInformationForToken.populateTransaction(tokenAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with  getInformationForToken function for NFT', async function () {
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[0].wallet,
    );

    const txResult = await precompileTokenContract.getInformationForToken(nftAddress);
    const gasResult = await txResult.wait();

    const tx = await precompileTokenContract.getInformationForToken.populateTransaction(nftAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with  getTokenDefaultFreeze function for fungible token', async function () {
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[0].wallet,
    );

    const txResult = await precompileTokenContract.getTokenDefaultFreeze(tokenAddress);
    const gasResult = await txResult.wait();

    const tx = await precompileTokenContract.getTokenDefaultFreeze.populateTransaction(tokenAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with  getTokenDefaultFreeze function for NFT', async function () {
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[0].wallet,
    );

    const txResult = await precompileTokenContract.getTokenDefaultFreeze(nftAddress);
    const gasResult = await txResult.wait();

    const tx = await precompileTokenContract.getTokenDefaultFreeze.populateTransaction(nftAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with  getTokenDefaultKyc function for fungible token', async function () {
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[0].wallet,
    );

    const txResult = await precompileTokenContract.getTokenDefaultKyc(tokenAddress);
    const gasResult = await txResult.wait();

    const tx = await precompileTokenContract.getTokenDefaultKyc.populateTransaction(tokenAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with  getTokenDefaultKyc function for NFT', async function () {
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[0].wallet,
    );

    const txResult = await precompileTokenContract.getTokenDefaultKyc(nftAddress);
    const gasResult = await txResult.wait();

    const tx = await precompileTokenContract.getTokenDefaultKyc.populateTransaction(nftAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with  isKyc function for fungible token', async function () {
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[0].wallet,
    );

    const txResult = await precompileTokenContract.isKycGranted(tokenAddress, accounts[1].wallet.address);
    const gasResult = await txResult.wait();

    const tx = await precompileTokenContract.isKycGranted.populateTransaction(tokenAddress, accounts[1].wallet.address);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with  getTokenDefaultKyc function for NFT', async function () {
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[0].wallet,
    );

    const txResult = await precompileTokenContract.isKycGranted(nftAddress, accounts[1].wallet.address);
    const gasResult = await txResult.wait();

    const tx = await precompileTokenContract.isKycGranted.populateTransaction(nftAddress, accounts[1].wallet.address);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with  isTokenFrozen function for fungible token', async function () {
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[0].wallet,
    );

    const txResult = await precompileTokenContract.isTokenFrozen(tokenAddress, accounts[0].wallet.address);
    const gasResult = await txResult.wait();

    const tx = await precompileTokenContract.isTokenFrozen.populateTransaction(
      tokenAddress,
      accounts[0].wallet.address,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with  isTokenFrozen function for NFT', async function () {
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[0].wallet,
    );

    const txResult = await precompileTokenContract.isTokenFrozen(nftAddress, accounts[1].wallet.address);
    const gasResult = await txResult.wait();

    const tx = await precompileTokenContract.isTokenFrozen.populateTransaction(nftAddress, accounts[1].wallet.address);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with  getTokenType function for fungible token', async function () {
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[0].wallet,
    );

    const txResult = await precompileTokenContract.getType(tokenAddress);
    const gasResult = await txResult.wait();

    const tx = await precompileTokenContract.getType.populateTransaction(tokenAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with  isTokenFrozen function for NFT', async function () {
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[0].wallet,
    );

    const txResult = await precompileTokenContract.getType(nftAddress);
    const gasResult = await txResult.wait();

    const tx = await precompileTokenContract.getType.populateTransaction(nftAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with balanceOfRedirect function', async function () {
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[0].wallet,
    );

    const tx = await precompileTokenContract.balanceOfRedirect.populateTransaction(
      tokenAddress,
      accounts[0].wallet.address,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(
      BigInt(Constants.ACTUAL_GAS_USED.REDIRECT_BALANCE_OF),
      estimateGasResponse,
      lowerPercentBound,
      upperPercentBound,
    );
  });

  it('should call estimateGas with  nameRedirect function for fungible token', async function () {
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[4].wallet,
    );

    const tx = await precompileTokenContract.nameRedirect.populateTransaction(nftAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isEqualWithDeviation(BigInt(Constants.ACTUAL_GAS_USED.REDIRECT_NAME), estimateGasResponse, lowerPercentBound);
  });

  it('should call estimateGas with  nameNFTRedirect function for NFT', async function () {
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[0].wallet,
    );

    const tx = await precompileTokenContract.nameNFTRedirect.populateTransaction(tokenAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);
    isEqualWithDeviation(BigInt(Constants.ACTUAL_GAS_USED.REDIRECT_NAME_NFT), estimateGasResponse, lowerPercentBound);
  });

  it('should call estimateGas with  symbolRedirect function for fungible token', async function () {
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[2].wallet,
    );

    const tx = await precompileTokenContract.symbolRedirect.populateTransaction(tokenAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);
    isEqualWithDeviation(BigInt(Constants.ACTUAL_GAS_USED.REDIRECT_SYMBOL), estimateGasResponse, lowerPercentBound);
  });

  it('should call estimateGas with  symbolNFTRedirect function for NFT', async function () {
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[0].wallet,
    );

    const tx = await precompileTokenContract.symbolNFTRedirect.populateTransaction(nftAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);
    isEqualWithDeviation(BigInt(Constants.ACTUAL_GAS_USED.REDIRECT_SYMBOL_NFT), estimateGasResponse, lowerPercentBound);
  });

  it('should call estimateGas with decimals redirect function for fungible token', async function () {
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[0].wallet,
    );

    const tx = await precompileTokenContract.decimalsRedirect.populateTransaction(tokenAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);
    isEqualWithDeviation(BigInt(Constants.ACTUAL_GAS_USED.REDIRECT_DECIMALS), estimateGasResponse, lowerPercentBound);
  });

  it('should call estimateGas with  allowance redirect function', async function () {
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[0].wallet,
    );

    const tx = await precompileTokenContract.allowanceRedirect.populateTransaction(
      tokenAddress,
      accounts[0].wallet.address,
      accounts[1].wallet.address,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);
    isEqualWithDeviation(BigInt(Constants.ACTUAL_GAS_USED.REDIRECT_ALLOWANCE), estimateGasResponse, lowerPercentBound);
  });

  it('should call estimateGas with  getOwnerOf redirect function', async function () {
    const nftSerial = await mintNFT();
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[0].wallet,
    );

    const tx = await precompileTokenContract.getOwnerOfRedirect.populateTransaction(nftAddress, nftSerial);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);
    isEqualWithDeviation(
      BigInt(Constants.ACTUAL_GAS_USED.REDIRECT_GET_OWNER_OF),
      estimateGasResponse,
      lowerPercentBound,
    );
  });

  it('should call estimateGas with  tokenURIRedirect function', async function () {
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[0].wallet,
    );

    const tx = await precompileTokenContract.tokenURIRedirect.populateTransaction(nftAddress, 1);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);
    isEqualWithDeviation(BigInt(Constants.ACTUAL_GAS_USED.REDIRECT_TOKEN_URI), estimateGasResponse, lowerPercentBound);
  });

  it('should call estimateGas with isApprovedForAll redirect function', async function () {
    const precompileTokenContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[0].wallet,
    );

    const tx = await precompileTokenContract.isApprovedForAllRedirect.populateTransaction(
      nftAddress,
      accounts[0].wallet.address,
      accounts[1].wallet.address,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);
    isEqualWithDeviation(
      BigInt(Constants.ACTUAL_GAS_USED.REDIRECT_IS_APPROVED_FOR_ALL),
      estimateGasResponse,
      lowerPercentBound,
    );
  });

  it('should call estimateGas with setApprovalForAll redirect function', async function () {
    const spender = prefix + PrecompileContractAddress;
    const nftSerial = await mintNFT();

    const precompileTestContract = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[4].wallet,
    );

    const precompiletTestContractAssociate = new ethers.Contract(
      prefix + PrecompileContractAddress,
      PrecompileTestContractJson.abi,
      accounts[4].wallet,
    );

    const associateTx = await precompiletTestContractAssociate.associateTokenExternal(spender, nftAddress, {
      gasLimit: 1_000_000,
    });
    await associateTx.wait();
    const grantTokenKYCTx = await estimateContractSigner0.grantTokenKycExternal(nftAddress, spender, {
      gasLimit: 1_000_000,
    });
    await grantTokenKYCTx.wait();
    const approveTx = await nftTokenContract.approve(spender, nftSerial, Constants.GAS.LIMIT_1_000_000);
    await approveTx.wait();
    const transferTx = await nftTokenContract.transferFrom(accounts[0].wallet.address, spender, nftSerial, {
      gasLimit: 1_000_000,
    });
    await transferTx.wait();

    const tx = await precompileTestContract.setApprovalForAllRedirect.populateTransaction(
      nftAddress,
      accounts[2].wallet.address,
      true,
    );
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);
    isWithinDeviation(
      BigInt(Constants.ACTUAL_GAS_USED.REDIRECT_SET_APPROVAL_FOR_ALL),
      estimateGasResponse,
      lowerPercentBound,
      upperPercentBound,
    );
  });

  it('should call estimateGas with tinycentsToTinybars ', async function () {
    const txResult = await contract.tinycentsToTinybars(100);
    const gasResult = await txResult.wait();

    const tx = await contract.tinycentsToTinybars.populateTransaction(100);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with tinybarsToTinycents ', async function () {
    const txResult = await contract.tinybarsToTinycents(100);
    const gasResult = await txResult.wait();

    const tx = await contract.tinybarsToTinycents.populateTransaction(100);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with delete function for fungible token', async function () {
    const tx = await contract.deleteTokenExternal.populateTransaction(tokenAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await contract.deleteTokenExternal(tokenAddress);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  it('should call estimateGas with delete function for NFT', async function () {
    const tx = await contract.deleteTokenExternal.populateTransaction(nftAddress);
    const estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);

    const txResult = await contract.deleteTokenExternal(nftAddress);
    const gasResult = await txResult.wait();

    isWithinDeviation(gasResult.gasUsed, estimateGasResponse, lowerPercentBound, upperPercentBound);
  });

  async function negativeScenarioVerification(tx, errorMessage: string) {
    let failed = false;
    let estimateGasResponse;
    try {
      estimateGasResponse = await relay.call(RelayCalls.ETH_ENDPOINTS.ETH_ESTIMATE_GAS, [tx]);
    } catch (e: any) {
      expect(e.code).to.eq(errorMessage);
      failed = true;
    }
    expect(failed).to.be.true;
    return estimateGasResponse;
  }

  async function associateAcc(contractSigner, account, token) {
    const txResult = await contractSigner.associateTokenExternal(account, token);
    const gasResult = await txResult.wait();
    return gasResult;
  }

  async function dissociateAcc(contractSigner, account, token) {
    const txResult = await contractSigner.dissociateTokenExternal(account, token);
    const gasResult = await txResult.wait();
    return gasResult;
  }

  async function approveAcc(contractSigner, token, spender, amount) {
    const txResult = await contractSigner.approveExternal(token, spender, amount);
    const gasResult = await txResult.wait();
    return gasResult;
  }
});
