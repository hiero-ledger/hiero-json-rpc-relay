// SPDX-License-Identifier: Apache-2.0
import { addressToBytes32, Options } from '@layerzerolabs/lz-v2-utilities';
import { expect } from 'chai';
import { ethers } from 'hardhat';

import { deployContractOnNetwork, getNetworkConfigs, setLZPeer } from '../utils/helpers';

describe('@whbar-bridge E2E Test', function () {
  this.timeout(120000);

  it('End-to-End WHBAR Bridge Test between Hedera & Sepolia', async function () {
    const hbarFundingAmount = ethers.utils.parseEther('5');
    const whbarTokenTransferAmount = ethers.utils.parseEther('1');
    const tinybarToWeibar = BigInt(10 ** 10);
    const tinybarToHbar = BigInt(10 ** 18);

    const erc20Decimals = 8; // ERC20 token decimals
    const erc20InitialSupply = 5 * 10 ** erc20Decimals;
    const erc20TokenTransferAmount = 1 * 10 ** erc20Decimals;

    // random receiver address, available on both hedera testnet and sepolia, for crosschain transfer
    const randomReceiverAddress = '0x67d8d32e9bf1a9968a5ff53b87d777aa8ebbee69';

    ///////////////// =============== Hedera Infrastructure Configuration =============== /////////////////
    console.log(`\n=============== Hedera Infrastructure Configuration ===============`);
    const hederaNetworkConfigs = getNetworkConfigs('hedera');

    // >>>>> Deploy WHBAR on Hedera network
    const hederaWHBARContract = await deployContractOnNetwork('hedera', 'WHBAR', []);

    // >>>>> Deploy OFT Adapters on Hedera network
    const hederaOftAdapterContract = await deployContractOnNetwork('hedera', 'ExampleOFTAdapter', [
      hederaWHBARContract.address,
      hederaNetworkConfigs.lzEndpointV2,
      hederaNetworkConfigs.networkSigner.address,
    ]);

    // >>>>> Deposit HBAR to WHBAR contract to convert HBAR to WHBAR
    console.log(
      `\nDepositing ${hbarFundingAmount.div(tinybarToHbar)} HBARs to WHBAR contract and convert ${hbarFundingAmount.div(
        tinybarToHbar,
      )} HBARs to ${hbarFundingAmount.div(tinybarToWeibar)} WHBAR tokens...`,
    );
    const tx = await hederaWHBARContract.deposit({
      value: hbarFundingAmount,
    });
    await tx.wait();
    console.log(`Successfully deposited HBAR to WHBAR contract via tx: ${tx.hash}`);
    const signerWHBARBalance = await hederaWHBARContract.balanceOf(hederaNetworkConfigs.networkSigner.address);

    console.log(`Hedera Signer's initial WHBAR balance: ${signerWHBARBalance.toString()} tokens`);
    expect(signerWHBARBalance).to.equal(hbarFundingAmount.div(tinybarToWeibar));

    // >>>>> approving OFTAdapter to spend WHBAR tokens
    console.log(`\nApproving Hedera OFTAdapter to spend WHBAR tokens on behalf of Hedera Signer...`);
    const approveTx = await hederaWHBARContract.approve(
      hederaOftAdapterContract.address,
      whbarTokenTransferAmount.div(tinybarToWeibar),
    );
    const approveReceipt = await approveTx.wait();
    console.log(`Successfully approved Hedera OFTAdapter to spend WHBAR tokens via tx: ${approveTx.hash}`);
    expect(!!approveReceipt.status).to.be.true;
    const hederaOftAdapterAllowance = await hederaWHBARContract.allowance(
      hederaNetworkConfigs.networkSigner.address,
      hederaOftAdapterContract.address,
    );
    console.log(`Hedera OFTAdapter's WHBAR allowance on behalf of Hedera Signer: ${hederaOftAdapterAllowance} tokens`);
    expect(hederaOftAdapterAllowance).to.equal(whbarTokenTransferAmount.div(tinybarToWeibar));

    ///////////////// =============== Sepolia Infrastructure Configuration =============== /////////////////
    console.log(`\n=============== Sepolia Infrastructure Configuration ===============`);
    const sepoliaNetworkConfigs = getNetworkConfigs('sepolia');

    // >>>>> Deploy ERC20 on Sepolia network
    const sepoliaERC20Contract = await deployContractOnNetwork('sepolia', 'ERC20Mock', [
      erc20InitialSupply,
      erc20Decimals,
    ]);
    const sepoliaSignerErc20InialBalance = await sepoliaERC20Contract.balanceOf(
      sepoliaNetworkConfigs.networkSigner.address,
    );
    console.log(`Sepolia Signer's initial ERC20 balance: ${sepoliaSignerErc20InialBalance} tokens`);

    // >>>>> Deploy OFT Adapters on Sepolia network
    const sepoliaOftAdapterContract = await deployContractOnNetwork('sepolia', 'ExampleOFTAdapter', [
      sepoliaERC20Contract.address,
      sepoliaNetworkConfigs.lzEndpointV2,
      sepoliaNetworkConfigs.networkSigner.address,
    ]);

    // >>>>> approving OFTAdapter to spend ERC20 tokens
    console.log(`\nApproving Sepolia OFTAdapter to spend ERC20 tokens on behalf of Sepolia Signer...`);
    const sepoliaApproveTx = await sepoliaERC20Contract.approve(
      sepoliaOftAdapterContract.address,
      erc20TokenTransferAmount,
    );
    const sepoliaApproveReceipt = await sepoliaApproveTx.wait();
    console.log(`Successfully approved Sepolia OFTAdapter to spend ERC20 tokens via tx: ${sepoliaApproveTx.hash}`);
    expect(!!sepoliaApproveReceipt.status).to.be.true;
    const sepoliaOftAdapterErc20Allowance = await sepoliaERC20Contract.allowance(
      sepoliaNetworkConfigs.networkSigner.address,
      sepoliaOftAdapterContract.address,
    );
    console.log(
      `Sepolia OFTAdapter's ERC20 allowance on behalf of Sepolia Signer: ${sepoliaOftAdapterErc20Allowance} tokens`,
    );
    expect(sepoliaOftAdapterErc20Allowance).to.equal(erc20TokenTransferAmount);

    // ///////////////// =============== OFTAdapter Peer Configuration =============== /////////////////
    console.log(`\n=============== OFTAdapter Peer Configuration ===============`);
    // In order to connect OFT Adapters together, we need to set the peer of the target OFT Adapter,
    // more info can be found here https://docs.layerzero.network/v2/developers/evm/getting-started#connecting-your-contracts
    const setLzPeerOnHederaReceipt = await setLZPeer(
      'hedera',
      'ExampleOFTAdapter',
      hederaOftAdapterContract.address,
      sepoliaOftAdapterContract.address,
    );
    expect(!!setLzPeerOnHederaReceipt.status).to.be.true;
    const setLzPeerOnSepoliaReceipt = await setLZPeer(
      'sepolia',
      'ExampleOFTAdapter',
      sepoliaOftAdapterContract.address,
      hederaOftAdapterContract.address,
    );
    expect(!!setLzPeerOnSepoliaReceipt.status).to.be.true;

    ///////////////// =============== WHBAR Crosschain Transfer =============== /////////////////
    console.log(`\n=============== WHBAR Crosschain Transfer ===============`);

    // >>>>> Initiating crosschain transfer of WHBAR from Hedera to Sepolia
    console.log(
      `Initiating crosschain transfer of ${whbarTokenTransferAmount.div(
        tinybarToWeibar,
      )} WHBAR tokens from Hedera to Sepolia...`,
    );
    const sendParam = {
      dstEid: sepoliaNetworkConfigs.lzEID,
      to: addressToBytes32(randomReceiverAddress),
      amountLD: whbarTokenTransferAmount.div(tinybarToWeibar),
      minAmountLD: whbarTokenTransferAmount.div(tinybarToWeibar),
      extraOptions: Options.newOptions().addExecutorLzReceiveOption(3000000, 0).toBytes(),
      composeMsg: ethers.utils.arrayify('0x'),
      oftCmd: ethers.utils.arrayify('0x'),
    };

    const crosschainTransferTx = await hederaOftAdapterContract.send(
      sendParam,
      { nativeFee: '500000000', lzTokenFee: 0 },
      hederaNetworkConfigs.networkSigner.address,
      {
        gasLimit: 10_000_000,
        value: '5000000000000000000',
      },
    );
    const crosschainTransferReceipt = await crosschainTransferTx.wait();
    console.log(
      `Successfully initiated crosschain transfer of WHBAR from Hedera to Sepolia via tx: ${crosschainTransferTx.hash}`,
    );
    expect(!!crosschainTransferReceipt.status).to.be.true;
  });
});
