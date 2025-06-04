// SPDX-License-Identifier: Apache-2.0

import { addressToBytes32, Options } from '@layerzerolabs/lz-v2-utilities';
import { expect } from 'chai';
import { ethers } from 'hardhat';

import { deployContractOnNetwork, getNetworkConfigs, setLZPeer } from '../utils/helpers';

describe('@erc20-hts-bridge E2E Test', function () {
  this.timeout(120000);

  it('End-to-End ERC20-HTS Bridge Test between Hedera & Sepolia', async function () {
    // random receiver address, available on both hedera testnet and sepolia
    const randomReceiverAddress = '0xF51c7a9407217911d74e91642dbC58F18E51Deac';
    const tokenName = `T_NAME_${parseInt(ethers.utils.randomBytes(32))}`;
    const tokenSymbol = `T_SYMBOL_${parseInt(ethers.utils.randomBytes(32))}`;
    const amount = 100;

    console.log(`\nToken Information: name - ${tokenName}, symbol - ${tokenSymbol}`);

    // deploy HTS Connector on Hedera
    const hederaNetworkConfigs = getNetworkConfigs('hedera');
    const htsConnector = await deployContractOnNetwork('hedera', 'ExampleHTSConnector', [
      tokenName,
      tokenSymbol,
      hederaNetworkConfigs.lzEndpointV2,
      hederaNetworkConfigs.networkSigner.address,
      {
        gasLimit: 10_000_000,
        value: '30000000000000000000', // 30 hbars
      },
    ]);
    const tokenWrapper = await ethers.getContractAt(
      'ERC20Mock',
      await htsConnector.token(),
      hederaNetworkConfigs.networkSigner,
    );
    const hederaHTSSignerInitialBalance = await tokenWrapper.balanceOf(hederaNetworkConfigs.networkSigner.address);
    console.log(`Hedera Signer's initial HTS balance: ${hederaHTSSignerInitialBalance} tokens`);

    // deploy OFT on Sepolia
    const sepoliaNetworkConfigs = getNetworkConfigs('sepolia');
    const sepoliaOft = await deployContractOnNetwork('sepolia', 'ExampleOFT', [
      tokenName,
      tokenSymbol,
      sepoliaNetworkConfigs.lzEndpointV2,
      sepoliaNetworkConfigs.networkSigner.address,
      5 * 10 ** 8,
      8,
    ]);
    const sepoliaSignerErc20InitialBalance = await sepoliaOft.balanceOf(sepoliaNetworkConfigs.networkSigner.address);
    console.log(`Sepolia Signer's initial ERC20 balance: ${sepoliaSignerErc20InitialBalance} tokens`);

    // set peers
    const setLzPeerOnHederaReceipt = await setLZPeer(
      'hedera',
      'HTSConnector',
      htsConnector.address,
      sepoliaOft.address,
    );
    expect(!!setLzPeerOnHederaReceipt.status).to.be.true;
    const setLzPeerOnSepoliaReceipt = await setLZPeer(
      'sepolia',
      'ExampleOFT',
      sepoliaOft.address,
      htsConnector.address,
    );
    expect(!!setLzPeerOnSepoliaReceipt.status).to.be.true;

    // approving HTS Connector contract to spend signer's tokens
    console.log(`\nApproving HTS Connector to spend tokens`);
    await (await tokenWrapper.approve(htsConnector.address, amount)).wait();

    // bridging from Hedera to Sepolia
    console.log(`\nSending HTS tokens from Hedera to ERC20 on Sepolia.`);
    const transferFromHederaToSepoliaTx = await htsConnector.send(
      {
        dstEid: sepoliaNetworkConfigs.lzEID,
        to: addressToBytes32(randomReceiverAddress.toLowerCase()),
        amountLD: amount,
        minAmountLD: amount,
        extraOptions: Options.newOptions().addExecutorLzReceiveOption(3000000, 0).toBytes(),
        composeMsg: ethers.utils.arrayify('0x'),
        oftCmd: ethers.utils.arrayify('0x'),
      },
      { nativeFee: '500000000', lzTokenFee: 0 },
      hederaNetworkConfigs.networkSigner.address,
      {
        gasLimit: 10_000_000,
        value: '5000000000000000000',
      },
    );

    console.log(`TX hash: ${transferFromHederaToSepoliaTx.hash}`);
    const transferFromHederaToSepoliaReceipt = await transferFromHederaToSepoliaTx.wait();
    expect(!!transferFromHederaToSepoliaReceipt.status).to.be.true;

    // bridging from Sepolia to Hedera
    console.log(`\nSending ERC20 from Sepolia to HTS tokens on Hedera`);
    const transferFromSepoliaToHederaTx = await sepoliaOft.send(
      {
        dstEid: hederaNetworkConfigs.lzEID,
        to: addressToBytes32(randomReceiverAddress.toLowerCase()),
        amountLD: amount,
        minAmountLD: amount,
        extraOptions: Options.newOptions().addExecutorLzReceiveOption(3000000, 0).toBytes(),
        composeMsg: ethers.utils.arrayify('0x'),
        oftCmd: ethers.utils.arrayify('0x'),
      },
      { nativeFee: '1000000000000000', lzTokenFee: 0 },
      sepoliaNetworkConfigs.networkSigner.address,
      {
        value: '1000000000000000',
      },
    );
    console.log(`TX hash: ${transferFromSepoliaToHederaTx.hash}`);

    const transferFromSepoliaToHederaReceipt = await transferFromSepoliaToHederaTx.wait();
    expect(!!transferFromSepoliaToHederaReceipt.status).to.be.true;
  });
});
