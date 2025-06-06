// SPDX-License-Identifier: Apache-2.0
import { expect } from 'chai';
import { BigNumber, ethers } from 'ethers';

import {
  approveTokenForTransfer,
  deployContractOnNetwork,
  displayTestSummary,
  executeCrossChainTransfer,
  getNetworkConfigs,
  preFundAdapter,
  recordBalanceSnapshot,
  setLZPeer,
  validateBalanceChange,
  validateContractConfiguration,
  validatePeerConfiguration,
  waitForMultipleTransfers,
} from '../../utils/helpers';

/**
 * Comprehensive End-to-End WHBAR Bridge Test
 *
 * This test validates the complete WHBAR bridge functionality between Hedera and Sepolia networks
 * using LayerZero's OFTAdapter pattern. It covers the entire cross-chain transfer flow including:
 * - Infrastructure deployment and configuration
 * - HBAR to WHBAR conversion
 * - Cross-chain transfer execution
 * - Balance verification and validation
 */
describe('@whbar-bridge Comprehensive E2E Test', function () {
  this.timeout(1800000); // 30 minutes

  it('Complete End-to-End WHBAR Bridge Flow between Hedera & Sepolia', async function () {
    // ============================================================================
    // Test Configuration and Constants
    // ============================================================================
    const TEST_CONFIG = {
      // HBAR/WHBAR configuration
      HBAR_FUNDING_AMOUNT: ethers.utils.parseEther('3'),
      WHBAR_TRANSFER_AMOUNT: ethers.utils.parseEther('1'),
      TINYBAR_TO_WEIBAR: BigInt(10 ** 10),
      WEIBAR_TO_HBAR: BigInt(10 ** 18),

      // ERC20 configuration (8 decimals matching WHBAR)
      ERC20_DECIMALS: 8,
      ERC20_INITIAL_SUPPLY: 5 * 10 ** 8,
      ERC20_TRANSFER_AMOUNT: 1 * 10 ** 8,

      // Test receiver contracts will be deployed dynamically
      RECEIVER_ADDRESS_HEDERA: '', // Will be set after deploying SimpleReceiver on Hedera
      RECEIVER_ADDRESS_SEPOLIA: '', // Will be set after deploying SimpleReceiver on Sepolia

      // LayerZero configuration (optimized for testing)
      LZ_GAS_LIMIT: 3000000,
      TX_GAS_LIMIT: 10_000_000,

      // Validation thresholds
      MINIMUM_TRANSFER_AMOUNT: BigNumber.from(10).pow(6), // 0.01 tokens for 8 decimals
    };

    // Balance tracking for validation
    const balanceSnapshots: { [key: string]: BigNumber } = {};

    console.log('\n=============== Hedera <-> Sepolia Crosschain E2E Bridge Flow Initiated ===============');

    // ============================================================================
    // PHASE 1: Hedera Infrastructure Setup
    // ============================================================================
    console.log('\n=============== PHASE 1: Hedera Infrastructure Setup ===============');

    const hederaNetworkConfigs = getNetworkConfigs('hedera');

    // Deploy WHBAR contract
    const hederaWHBARContract = await deployContractOnNetwork('hedera', 'WHBAR', []);
    expect(hederaWHBARContract.address).to.not.be.empty;

    // Deploy SimpleReceiver contract on Hedera
    const simpleHederaReceiver = await deployContractOnNetwork('hedera', 'SimpleReceiver', []);
    TEST_CONFIG.RECEIVER_ADDRESS_HEDERA = simpleHederaReceiver.address;

    // Deploy OFT Adapter for WHBAR
    const hederaOftAdapterContract = await deployContractOnNetwork('hedera', 'ExampleOFTAdapter', [
      hederaWHBARContract.address,
      hederaNetworkConfigs.lzEndpointV2,
      hederaNetworkConfigs.networkSigner.address,
    ]);
    expect(hederaOftAdapterContract.address).to.not.be.empty;

    // Validate contract configurations
    await validateContractConfiguration(
      hederaOftAdapterContract,
      hederaWHBARContract.address,
      hederaNetworkConfigs.lzEndpointV2,
      hederaNetworkConfigs.networkSigner.address,
      'Hedera',
    );

    // ============================================================================
    // PHASE 2: HBAR to WHBAR Conversion
    // ============================================================================
    console.log('\n=============== PHASE 2: HBAR to WHBAR Conversion ===============');

    // Record initial balances
    await recordBalanceSnapshot(
      balanceSnapshots,
      'hederaWHBARInitial',
      hederaWHBARContract,
      hederaNetworkConfigs.networkSigner.address,
      "Hedera Signer's initial WHBAR balance",
    );

    // Execute HBAR deposit to mint WHBAR
    console.log(
      `\nDepositing ${TEST_CONFIG.HBAR_FUNDING_AMOUNT.div(TEST_CONFIG.WEIBAR_TO_HBAR)} HBAR to mint WHBAR...`,
    );

    const depositTx = await hederaWHBARContract.deposit({
      value: TEST_CONFIG.HBAR_FUNDING_AMOUNT,
    });
    const depositReceipt = await depositTx.wait();

    expect(depositReceipt.status).to.equal(1);
    console.log(`✓ HBAR deposit successful: txHash=${depositTx.hash}`);

    // Verify WHBAR balance after deposit
    await recordBalanceSnapshot(
      balanceSnapshots,
      'hederaWHBARAfterDeposit',
      hederaWHBARContract,
      hederaNetworkConfigs.networkSigner.address,
      "Hedera Signer's WHBAR balance after deposit",
    );

    const expectedWHBARBalance = TEST_CONFIG.HBAR_FUNDING_AMOUNT.div(TEST_CONFIG.TINYBAR_TO_WEIBAR);
    const actualWHBARMinted = balanceSnapshots.hederaWHBARAfterDeposit.sub(balanceSnapshots.hederaWHBARInitial);

    validateBalanceChange(
      actualWHBARMinted,
      expectedWHBARBalance,
      BigNumber.from(0), // Exact match expected for minting
      'WHBAR minting validation',
    );

    expect(balanceSnapshots.hederaWHBARAfterDeposit.mod(BigNumber.from(10).pow(6))).to.equal(0, 'No dust amounts');
    console.log(`\✓ WHBAR minted successfully: ${actualWHBARMinted.toString()} tokens`);

    // ============================================================================
    // PHASE 3: Hedera WHBAR Dual-Mode Setup (Source + Destination)
    // ============================================================================
    console.log('\n=============== PHASE 3: Hedera WHBAR Dual-Mode Setup ===============');

    // PHASE 3A: Source Mode Setup - Approval for outgoing transfers (Hedera → Sepolia)
    const whbarApprovalAmount = TEST_CONFIG.WHBAR_TRANSFER_AMOUNT.div(TEST_CONFIG.TINYBAR_TO_WEIBAR);
    console.log(`\n--- Phase 3A: Source Mode (Hedera → Sepolia) ---`);

    // Validate approval amount is above dust threshold
    expect(whbarApprovalAmount.gte(TEST_CONFIG.MINIMUM_TRANSFER_AMOUNT)).to.be.true;

    await approveTokenForTransfer(
      hederaWHBARContract,
      hederaOftAdapterContract.address,
      whbarApprovalAmount,
      'Hedera',
      'WHBAR',
    );

    // PHASE 3B: Destination Mode Setup - Pre-fund adapter for incoming transfers (Sepolia → Hedera)
    const whbarForAdapter = TEST_CONFIG.WHBAR_TRANSFER_AMOUNT.div(TEST_CONFIG.TINYBAR_TO_WEIBAR);
    console.log(`\n--- Phase 3B: Destination Mode (Sepolia → Hedera) ---`);
    console.log(`This allows the adapter to unlock WHBAR when receiving transfers from Sepolia`);

    await preFundAdapter(hederaWHBARContract, hederaOftAdapterContract.address, whbarForAdapter, 'Hedera', 'WHBAR');

    // Get final allowance for logging
    const hederaAllowance = await hederaWHBARContract.allowance(
      hederaNetworkConfigs.networkSigner.address,
      hederaOftAdapterContract.address,
    );
    const hederaAdapterBalance = await hederaWHBARContract.balanceOf(hederaOftAdapterContract.address);

    console.log(`\nHedera OFT Adapter is now ready for bidirectional transfers:`);
    console.log(`  • Source mode: Can lock ${hederaAllowance.toString()} WHBAR from user approval`);
    console.log(`  • Destination mode: Can unlock ${hederaAdapterBalance.toString()} WHBAR from pre-funded balance`);

    // ============================================================================
    // PHASE 4: Sepolia Infrastructure Setup
    // ============================================================================
    console.log('\n=============== PHASE 4: Sepolia Infrastructure Setup ===============');

    const sepoliaNetworkConfigs = getNetworkConfigs('sepolia');

    // Deploy ERC20 mock on Sepolia
    const sepoliaERC20Contract = await deployContractOnNetwork('sepolia', 'ERC20Mock', [
      TEST_CONFIG.ERC20_INITIAL_SUPPLY,
      TEST_CONFIG.ERC20_DECIMALS,
    ]);
    expect(sepoliaERC20Contract.address).to.not.be.empty;

    // Verify initial ERC20 balance and decimal consistency
    await recordBalanceSnapshot(
      balanceSnapshots,
      'sepoliaERC20Initial',
      sepoliaERC20Contract,
      sepoliaNetworkConfigs.networkSigner.address,
      "Sepolia Signer's ERC20 balance after deployment",
    );

    const sepoliaDecimals = await sepoliaERC20Contract.decimals();
    const hederaDecimals = await hederaWHBARContract.decimals();

    expect(balanceSnapshots.sepoliaERC20Initial).to.equal(TEST_CONFIG.ERC20_INITIAL_SUPPLY);
    expect(sepoliaDecimals).to.equal(hederaDecimals, 'Decimal consistency required for bridging');
    console.log(`✓ Decimal consistency verified: ${sepoliaDecimals} decimals`);

    // Deploy SimpleReceiver contract on Sepolia
    const simpleSepoliaReceiver = await deployContractOnNetwork('sepolia', 'SimpleReceiver', []);
    TEST_CONFIG.RECEIVER_ADDRESS_SEPOLIA = simpleSepoliaReceiver.address;

    // Deploy OFT Adapter on Sepolia
    const sepoliaOftAdapterContract = await deployContractOnNetwork('sepolia', 'ExampleOFTAdapter', [
      sepoliaERC20Contract.address,
      sepoliaNetworkConfigs.lzEndpointV2,
      sepoliaNetworkConfigs.networkSigner.address,
    ]);
    expect(sepoliaOftAdapterContract.address).to.not.be.empty;

    // Validate Sepolia contract configurations
    await validateContractConfiguration(
      sepoliaOftAdapterContract,
      sepoliaERC20Contract.address,
      sepoliaNetworkConfigs.lzEndpointV2,
      sepoliaNetworkConfigs.networkSigner.address,
      'Sepolia',
    );

    // Verify different endpoints between networks
    const sepoliaEndpoint = await sepoliaOftAdapterContract.endpoint();
    const hederaEndpoint = await hederaOftAdapterContract.endpoint();
    expect(sepoliaEndpoint).to.not.equal(hederaEndpoint, 'Different endpoints per network');

    // ============================================================================
    // PHASE 5: Sepolia ERC20 Dual-Mode Setup (Source + Destination)
    // ============================================================================
    console.log('\n=============== PHASE 5: Sepolia ERC20 Dual-Mode Setup ===============');

    // PHASE 5A: Source Mode Setup - Approval for outgoing transfers (Sepolia → Hedera)
    const erc20ApprovalAmount = BigNumber.from(TEST_CONFIG.ERC20_TRANSFER_AMOUNT);
    console.log(`\n--- Phase 5A: Source Mode (Sepolia → Hedera) ---`);

    await approveTokenForTransfer(
      sepoliaERC20Contract,
      sepoliaOftAdapterContract.address,
      erc20ApprovalAmount,
      'Sepolia',
      'ERC20',
    );

    // PHASE 5B: Destination Mode Setup - Pre-fund adapter for incoming transfers (Hedera → Sepolia)
    const tokensForAdapter = BigNumber.from(TEST_CONFIG.ERC20_TRANSFER_AMOUNT);
    console.log(`\n--- Phase 5B: Destination Mode (Hedera → Sepolia) ---`);
    console.log(`This allows the adapter to unlock tokens when receiving transfers from Hedera`);

    await preFundAdapter(sepoliaERC20Contract, sepoliaOftAdapterContract.address, tokensForAdapter, 'Sepolia', 'ERC20');

    // Get final balances for logging
    const sepoliaAllowance = await sepoliaERC20Contract.allowance(
      sepoliaNetworkConfigs.networkSigner.address,
      sepoliaOftAdapterContract.address,
    );
    const sepoliaAdapterPreFundedBalance = await sepoliaERC20Contract.balanceOf(sepoliaOftAdapterContract.address);
    const sepoliaSignerBalanceAfterTransfer = await sepoliaERC20Contract.balanceOf(
      sepoliaNetworkConfigs.networkSigner.address,
    );

    expect(sepoliaSignerBalanceAfterTransfer).to.equal(
      TEST_CONFIG.ERC20_INITIAL_SUPPLY - TEST_CONFIG.ERC20_TRANSFER_AMOUNT,
    );

    console.log(`Sepolia Signer ERC20 balance after transfer: ${sepoliaSignerBalanceAfterTransfer.toString()} tokens`);

    console.log(`\nSepolia OFT Adapter is now ready for bidirectional transfers:`);
    console.log(`  • Source mode: Can lock ${sepoliaAllowance.toString()} ERC20 from user approval`);
    console.log(
      `  • Destination mode: Can unlock ${sepoliaAdapterPreFundedBalance.toString()} ERC20 from pre-funded balance`,
    );

    // ============================================================================
    // PHASE 6: LayerZero Peer Configuration
    // ============================================================================
    console.log('\n=============== PHASE 6: LayerZero Peer Configuration ===============');

    // Configure Hedera → Sepolia peer
    console.log('\n--- Phase 6A: Setting up Hedera → Sepolia LZ peer connection ---');
    const hederaPeerReceipt = await setLZPeer(
      'hedera',
      'ExampleOFTAdapter',
      hederaOftAdapterContract.address,
      sepoliaOftAdapterContract.address,
    );
    expect(hederaPeerReceipt.status).to.equal(1);
    console.log('\n✓ Hedera → Sepolia LZ peer configured');

    // Configure Sepolia → Hedera peer
    console.log('\n--- Phase 6B: Setting up Sepolia → Hedera LZ peer connection ---');
    const sepoliaPeerReceipt = await setLZPeer(
      'sepolia',
      'ExampleOFTAdapter',
      sepoliaOftAdapterContract.address,
      hederaOftAdapterContract.address,
    );
    expect(sepoliaPeerReceipt.status).to.equal(1);
    console.log('\n✓ Sepolia → Hedera LZ peer configured');

    // Validate peer configurations
    await validatePeerConfiguration(
      hederaOftAdapterContract,
      sepoliaOftAdapterContract,
      hederaNetworkConfigs,
      sepoliaNetworkConfigs,
    );

    // ============================================================================
    // PHASE 7: Cross-Chain Transfer Execution
    // ============================================================================
    console.log('\n=============== PHASE 7.1: Cross-Chain Transfer Execution - Hedera to Sepolia ===============');

    const whbarTransferAmount = TEST_CONFIG.WHBAR_TRANSFER_AMOUNT.div(TEST_CONFIG.TINYBAR_TO_WEIBAR);

    // Record pre-transfer balances
    await recordBalanceSnapshot(
      balanceSnapshots,
      'hederaSenderPreTransfer',
      hederaWHBARContract,
      hederaNetworkConfigs.networkSigner.address,
      "Hedera Signer's WHBAR balance",
    );
    await recordBalanceSnapshot(
      balanceSnapshots,
      'sepoliaReceiverPreTransfer',
      sepoliaERC20Contract,
      TEST_CONFIG.RECEIVER_ADDRESS_SEPOLIA,
      "Sepolia Receiver's ERC20 balance",
    );

    // Validate transfer parameters
    expect(whbarTransferAmount.gte(TEST_CONFIG.MINIMUM_TRANSFER_AMOUNT)).to.be.true;
    expect(whbarTransferAmount.lte(balanceSnapshots.hederaSenderPreTransfer)).to.be.true;

    // Verify Sepolia adapter has sufficient tokens to unlock
    const sepoliaAdapterBalance = await sepoliaERC20Contract.balanceOf(sepoliaOftAdapterContract.address);
    expect(whbarTransferAmount.lte(sepoliaAdapterBalance)).to.be.true;
    console.log(`Sepolia adapter has ${sepoliaAdapterBalance.toString()} tokens available for unlocking`);

    // Execute cross-chain transfer
    const hederaToSepoliaResult = await executeCrossChainTransfer({
      sourceNetwork: 'hedera',
      destinationNetwork: 'sepolia',
      sourceContract: hederaWHBARContract,
      destinationContract: sepoliaERC20Contract,
      oftAdapterContract: hederaOftAdapterContract,
      transferAmount: whbarTransferAmount,
      receiverAddress: TEST_CONFIG.RECEIVER_ADDRESS_SEPOLIA,
      gasLimit: TEST_CONFIG.LZ_GAS_LIMIT,
      txGasLimit: TEST_CONFIG.TX_GAS_LIMIT,
      tinybarToWeibar: TEST_CONFIG.TINYBAR_TO_WEIBAR,
    });

    // Verify source balance reduction
    await recordBalanceSnapshot(
      balanceSnapshots,
      'hederaSenderPostTransfer',
      hederaWHBARContract,
      hederaNetworkConfigs.networkSigner.address,
      "Hedera Signer's WHBAR balance after transfer",
    );

    const actualBalanceReduction = balanceSnapshots.hederaSenderPreTransfer.sub(
      balanceSnapshots.hederaSenderPostTransfer,
    );
    validateBalanceChange(
      actualBalanceReduction,
      whbarTransferAmount,
      BigNumber.from(0), // Exact match expected for source
      'Source balance reduction validation',
    );

    console.log(`\n🎉 Phase 7.1 Hedera → Sepolia transfer successfully complete!`);
    console.log(`  • Transaction Hash: ${hederaToSepoliaResult.hash}`);
    console.log(`  • Find transaction on Hashscan: https://hashscan.io/testnet/tx/${hederaToSepoliaResult.hash}`);
    console.log(
      `  • Find transaction on LayerZero Scan: https://testnet.layerzeroscan.com/tx/${hederaToSepoliaResult.hash}`,
    );

    // ============================================================================
    // PHASE 7.2: Cross-Chain Transfer Execution - Sepolia to Hedera
    // ============================================================================
    console.log('\n=============== PHASE 7.2: Cross-Chain Transfer Execution - Sepolia to Hedera ===============');

    const erc20TransferAmount = BigNumber.from(TEST_CONFIG.ERC20_TRANSFER_AMOUNT);

    // Record pre-transfer balances for return journey
    await recordBalanceSnapshot(
      balanceSnapshots,
      'sepoliaSenderPreTransfer',
      sepoliaERC20Contract,
      sepoliaNetworkConfigs.networkSigner.address,
      "Sepolia Signer's ERC20 balance",
    );
    await recordBalanceSnapshot(
      balanceSnapshots,
      'hederaReceiverPreTransfer',
      hederaWHBARContract,
      TEST_CONFIG.RECEIVER_ADDRESS_HEDERA,
      "Hedera Receiver's WHBAR balance",
    );

    // Validate return transfer parameters
    expect(erc20TransferAmount.gte(TEST_CONFIG.MINIMUM_TRANSFER_AMOUNT)).to.be.true;
    expect(erc20TransferAmount.lte(balanceSnapshots.sepoliaSenderPreTransfer)).to.be.true;

    // Verify Hedera adapter has sufficient tokens to unlock
    const hederaAdapterBalanceCheck = await hederaWHBARContract.balanceOf(hederaOftAdapterContract.address);
    expect(erc20TransferAmount.lte(hederaAdapterBalanceCheck)).to.be.true;
    console.log(`Hedera adapter has ${hederaAdapterBalanceCheck.toString()} WHBAR tokens available for unlocking`);

    // Execute return cross-chain transfer
    const sepoliaToHederaResult = await executeCrossChainTransfer({
      sourceNetwork: 'sepolia',
      destinationNetwork: 'hedera',
      sourceContract: sepoliaERC20Contract,
      destinationContract: hederaWHBARContract,
      oftAdapterContract: sepoliaOftAdapterContract,
      transferAmount: erc20TransferAmount,
      receiverAddress: TEST_CONFIG.RECEIVER_ADDRESS_HEDERA,
      gasLimit: TEST_CONFIG.LZ_GAS_LIMIT,
      txGasLimit: TEST_CONFIG.TX_GAS_LIMIT,
    });

    // Verify source balance reduction
    await recordBalanceSnapshot(
      balanceSnapshots,
      'sepoliaSenderPostTransfer',
      sepoliaERC20Contract,
      sepoliaNetworkConfigs.networkSigner.address,
      "Sepolia Signer's ERC20 balance after transfer",
    );

    const actualSepoliaBalanceReduction = balanceSnapshots.sepoliaSenderPreTransfer.sub(
      balanceSnapshots.sepoliaSenderPostTransfer,
    );
    validateBalanceChange(
      actualSepoliaBalanceReduction,
      erc20TransferAmount,
      BigNumber.from(0), // Exact match expected for source
      'Source balance reduction validation',
    );

    console.log(`\n🎉 Phase 7.2 Sepolia → Hedera transfer initiated successfully!`);
    console.log(`  • Transaction Hash: ${sepoliaToHederaResult.hash}`);
    console.log(`  • Find transaction on Sepolia: https://sepolia.etherscan.io/tx/${sepoliaToHederaResult.hash}`);
    console.log(
      `  • Find transaction on LayerZero Scan: https://testnet.layerzeroscan.com/tx/${sepoliaToHederaResult.hash}`,
    );

    // ============================================================================
    // PHASE 8: Verify receiver balances after cross-chain transfers complete
    // ============================================================================
    console.log('\n=============== PHASE 8: Receiver Balance Verification After Cross-chain Transfers ===============');

    console.log(`\nInitial receiver balances:`);
    console.log(`  • Sepolia receiver: ${balanceSnapshots.sepoliaReceiverPreTransfer.toString()} WHBAR`);
    console.log(`  • Hedera receiver: ${balanceSnapshots.hederaReceiverPreTransfer.toString()} WHBAR`);

    // Phase 8.1: Wait for both cross-chain transfers to complete
    console.log('\n- Phase 8.1: Waiting for both LayerZero cross-chain transfers to complete...');

    const transferResults = await waitForMultipleTransfers([
      {
        name: 'Hedera → Sepolia',
        receiverContract: sepoliaERC20Contract,
        receiverAddress: TEST_CONFIG.RECEIVER_ADDRESS_SEPOLIA,
        initialBalance: balanceSnapshots.sepoliaReceiverPreTransfer,
        expectedAmount: whbarTransferAmount,
      },
      {
        name: 'Sepolia → Hedera',
        receiverContract: hederaWHBARContract,
        receiverAddress: TEST_CONFIG.RECEIVER_ADDRESS_HEDERA,
        initialBalance: balanceSnapshots.hederaReceiverPreTransfer,
        expectedAmount: BigNumber.from(erc20TransferAmount),
      },
    ]);

    const hederaToSepoliaCompleted = transferResults['Hedera → Sepolia'];
    const sepoliaToHederaCompleted = transferResults['Sepolia → Hedera'];

    // ============================================================================
    // PHASE 9: Final Verification and Summary
    // ============================================================================
    console.log('\n=============== PHASE 9: Final Verification and Summary ===============');

    const finalSepoliaReceiverBalance = await sepoliaERC20Contract.balanceOf(TEST_CONFIG.RECEIVER_ADDRESS_SEPOLIA);
    const finalHederaReceiverBalance = await hederaWHBARContract.balanceOf(TEST_CONFIG.RECEIVER_ADDRESS_HEDERA);

    // Display comprehensive test summary using helper function
    displayTestSummary({
      hederaNetworkConfig: hederaNetworkConfigs,
      sepoliaNetworkConfig: sepoliaNetworkConfigs,
      contracts: {
        hederaWHBAR: hederaWHBARContract.address,
        hederaOftAdapter: hederaOftAdapterContract.address,
        sepoliaERC20: sepoliaERC20Contract.address,
        sepoliaOftAdapter: sepoliaOftAdapterContract.address,
      },
      transfers: {
        hederaToSepolia: {
          completed: hederaToSepoliaCompleted,
          amount: whbarTransferAmount.toString(),
          hash: hederaToSepoliaResult.hash,
        },
        sepoliaToHedera: {
          completed: sepoliaToHederaCompleted,
          amount: erc20TransferAmount.toString(),
          hash: sepoliaToHederaResult.hash,
        },
      },
      finalBalances: {
        sepoliaReceiver: {
          balance: finalSepoliaReceiverBalance.toString(),
          increase: finalSepoliaReceiverBalance.sub(balanceSnapshots.sepoliaReceiverPreTransfer).toString(),
        },
        hederaReceiver: {
          balance: finalHederaReceiverBalance.toString(),
          increase: finalHederaReceiverBalance.sub(balanceSnapshots.hederaReceiverPreTransfer).toString(),
        },
      },
    });

    // Validation assertions for completed transfers
    if (hederaToSepoliaCompleted) {
      const tolerance = BigNumber.from(10).pow(5); // 0.001 WHBAR tolerance for 8 decimals
      const actualIncrease = finalSepoliaReceiverBalance.sub(balanceSnapshots.sepoliaReceiverPreTransfer);
      const expectedMin = whbarTransferAmount.sub(tolerance);
      const expectedMax = whbarTransferAmount.add(tolerance);
      expect(actualIncrease.gte(expectedMin)).to.be.true;
      expect(actualIncrease.lte(expectedMax)).to.be.true;
    }

    if (sepoliaToHederaCompleted) {
      const tolerance = BigNumber.from(10).pow(5); // 0.001 WHBAR tolerance for 8 decimals
      const actualIncrease = finalHederaReceiverBalance.sub(balanceSnapshots.hederaReceiverPreTransfer);
      const expectedMin = BigNumber.from(erc20TransferAmount).sub(tolerance);
      const expectedMax = BigNumber.from(erc20TransferAmount).add(tolerance);
      expect(actualIncrease.gte(expectedMin)).to.be.true;
      expect(actualIncrease.lte(expectedMax)).to.be.true;
    }

    console.log(`This test validates the complete WHBAR bridging infrastructure using LayerZero V2.`);

    console.log('\n=============== Hedera <-> Sepolia Crosschain E2E Bridge Flow Comleted ===============');
  });
});
