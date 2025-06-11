// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { ethers } from 'hardhat';

import { constants } from '../../../scripts/utils/constants';
import {
  approveTokenForTransfer,
  deployContractOnNetwork,
  executeCrossChainTransfer,
  getNetworkConfigs,
  getRandomInt,
  setLZPeer,
  TEST_CONFIG,
  waitForMultipleTransfers,
} from '../../utils/helpers';

/**
 * Comprehensive End-to-End ERC20 - HTS Bridge Test
 *
 * This test validates the complete HTS - ERC20 bridge functionality between Hedera and Sepolia networks
 * using LayerZero's OFT and Hedera's implementation for OFT (named HTS Connector). It covers the entire cross-chain
 * transfer flow including:
 * - Infrastructure deployment and configuration
 * - Cross-Chain transfer execution
 * - Balance verification and validation
 */
describe('@erc20-hts-bridge E2E Test', function () {
  this.timeout(1800000); // 30 minutes

  it('End-to-End ERC20-HTS Bridge Test between Hedera & Sepolia', async function () {
    console.log('\n=============== Hedera <-> Sepolia Cross-Chain E2E Bridge Flow Initiated ===============');

    // random receiver address, available on both hedera testnet and sepolia
    const randomReceiverAddress = '0xF51c7a9407217911d74e91642dbC58F18E51Deac';
    const tokenName = `${constants.TOKEN_NAME}_${getRandomInt().toString()}`;
    const tokenSymbol = `${constants.TOKEN_SYMBOL}_${getRandomInt().toString()}`;
    const amount = ethers.BigNumber.from(100);
    const zeroBigNumber = ethers.BigNumber.from(0);

    console.log(`\nToken Information:`);
    console.log(`  • Name: ${tokenName}`);
    console.log(`  • Symbol: ${tokenSymbol}`);
    console.log('\n=============== PHASE 1: Hedera Infrastructure Setup ===============');

    // deploy HTS Connector on Hedera
    const hederaNetworkConfigs = getNetworkConfigs('hedera');
    const htsConnector = await deployContractOnNetwork('hedera', 'ExampleHTSConnector', [
      tokenName,
      tokenSymbol,
      hederaNetworkConfigs.lzEndpointV2,
      hederaNetworkConfigs.networkSigner.address,
      {
        gasLimit: TEST_CONFIG.TX_GAS_LIMIT,
        value: '30000000000000000000', // 30 hbars
      },
    ]);
    const tokenWrapper = await ethers.getContractAt(
      'ERC20Mock',
      await htsConnector.token(),
      hederaNetworkConfigs.networkSigner,
    );
    const hederaHTSSignerInitialBalance = await tokenWrapper.balanceOf(hederaNetworkConfigs.networkSigner.address);
    console.log(`HTS token address: ${await htsConnector.token()}`);
    console.log(`Hedera Signer's initial HTS balance: ${hederaHTSSignerInitialBalance} tokens`);

    console.log('\n=============== PHASE 2: Sepolia Infrastructure Setup ===============');
    // deploy OFT on Sepolia
    const sepoliaNetworkConfigs = getNetworkConfigs('sepolia');
    const sepoliaOft = await deployContractOnNetwork('sepolia', 'ExampleOFT', [
      tokenName,
      tokenSymbol,
      sepoliaNetworkConfigs.lzEndpointV2,
      sepoliaNetworkConfigs.networkSigner.address,
      5 * 10 ** constants.TOKEN_DECIMALS,
      constants.TOKEN_DECIMALS,
    ]);
    const sepoliaSignerErc20InitialBalance = await sepoliaOft.balanceOf(sepoliaNetworkConfigs.networkSigner.address);
    console.log(`Sepolia Signer's initial ERC20 balance: ${sepoliaSignerErc20InitialBalance} tokens`);

    console.log('\n=============== PHASE 3: LayerZero Peer Configuration ===============');
    console.log('\n--- Phase 3A: Setting up Hedera → Sepolia LZ peer connection ---');
    // set peers
    const setLzPeerOnHederaReceipt = await setLZPeer(
      'hedera',
      'HTSConnector',
      htsConnector.address,
      sepoliaOft.address,
    );
    expect(!!setLzPeerOnHederaReceipt.status).to.be.true;
    console.log('Hedera → Sepolia LZ peer configured');

    console.log('\n--- Phase 3B: Setting up Sepolia → Hedera LZ peer connection ---');
    const setLzPeerOnSepoliaReceipt = await setLZPeer(
      'sepolia',
      'ExampleOFT',
      sepoliaOft.address,
      htsConnector.address,
    );
    expect(!!setLzPeerOnSepoliaReceipt.status).to.be.true;
    console.log('Sepolia → Hedera LZ peer configured');

    console.log('\n=============== PHASE 4: HTS Connector Approval Setup ===============');
    // approving HTS Connector contract to spend signer's tokens
    await approveTokenForTransfer(tokenWrapper, htsConnector.address, amount, 'Hedera', tokenName);

    console.log('\n=============== PHASE 4: Cross-Chain Transfer Execution ===============');
    console.log('\n=============== PHASE 4.1: Hedera HTS to Sepolia ERC20 ===============');
    const hederaToSepoliaResult = await executeCrossChainTransfer({
      sourceNetwork: 'hedera',
      destinationNetwork: 'sepolia',
      IOFTContract: htsConnector,
      transferAmount: amount,
      receiverAddress: randomReceiverAddress,
      gasLimit: TEST_CONFIG.LZ_GAS_LIMIT,
      txGasLimit: TEST_CONFIG.TX_GAS_LIMIT,
      tinybarToWeibar: TEST_CONFIG.TINYBAR_TO_WEIBAR,
    });
    console.log(`\n🎉 Phase 4.1 Hedera → Sepolia transfer initiated successfully!`);
    console.log(`  - Transaction Hash: ${hederaToSepoliaResult.hash}`);
    console.log(`  - Find transaction on Hashscan: https://hashscan.io/testnet/tx/${hederaToSepoliaResult.hash}`);
    console.log(
      `  - Find transaction on LayerZero Scan: https://testnet.layerzeroscan.com/tx/${hederaToSepoliaResult.hash}`,
    );

    console.log('\n=============== PHASE 4.2: Sepolia ERC20 to Hedera HTS ===============');
    const sepoliaToHederaResult = await executeCrossChainTransfer({
      sourceNetwork: 'sepolia',
      destinationNetwork: 'hedera',
      IOFTContract: sepoliaOft,
      transferAmount: amount,
      receiverAddress: randomReceiverAddress,
      gasLimit: TEST_CONFIG.LZ_GAS_LIMIT,
      txGasLimit: TEST_CONFIG.TX_GAS_LIMIT,
    });
    console.log(`\n🎉 Phase 4.2 Sepolia → Hedera transfer initiated successfully!`);
    console.log(`  - Transaction Hash: ${sepoliaToHederaResult.hash}`);
    console.log(`  - Find transaction on Sepolia: https://sepolia.etherscan.io/tx/${sepoliaToHederaResult.hash}`);
    console.log(
      `  - Find transaction on LayerZero Scan: https://testnet.layerzeroscan.com/tx/${sepoliaToHederaResult.hash}`,
    );

    console.log('\n=============== PHASE 5: Receiver Balance Verification After Cross-Chain Transfers ===============');
    await waitForMultipleTransfers(
      [
        {
          name: 'Hedera → Sepolia',
          receiverContract: sepoliaOft,
          receiverAddress: randomReceiverAddress,
          initialBalance: zeroBigNumber,
          expectedAmount: amount,
        },
        {
          name: 'Sepolia → Hedera',
          receiverContract: tokenWrapper,
          receiverAddress: randomReceiverAddress,
          initialBalance: zeroBigNumber,
          expectedAmount: amount,
        },
      ],
      30,
      30000,
      zeroBigNumber,
    );

    console.log(`This test validates the complete ERC20 - HTS bridging infrastructure using LayerZero V2.`);
    console.log('\n=============== Hedera <-> Sepolia Cross-Chain E2E Bridge Flow Completed ===============');
  });
});
