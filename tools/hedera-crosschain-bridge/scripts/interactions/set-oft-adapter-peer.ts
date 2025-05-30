// SPDX-License-Identifier: Apache-2.0
import hre, { ethers } from 'hardhat';

import { getNetworkConfigs, logExecutionSummary } from '../utils/helpers';

export async function main() {
  const network = hre.network.name;

  const networkConfigs = getNetworkConfigs(network);
  if (!networkConfigs) throw new Error(`Network configuration not found for ${network}`);

  const { blockExplorerUrl, lzEndpointAddress, lzEid } = networkConfigs;

  if (!lzEndpointAddress || !lzEid) {
    throw new Error(`LayerZero endpoint or EID not configured for ${network}`);
  }

  // Get required addresses for OFT Adapter from environment variables
  const sourceOftAdapterAddress = process.env.SOURCE_OFTADAPTER_ADDRESS;
  const targetOftAdapterAddress = process.env.TARGET_OFTADAPTER_ADDRESS;
  if (!sourceOftAdapterAddress || !targetOftAdapterAddress) {
    throw new Error(`Both SOURCE_OFTADAPTER_ADDRESS and TARGET_OFTADAPTER_ADDRESS are required. Usage:
      SOURCE_OFTADAPTER_ADDRESS=0x... TARGET_OFTADAPTER_ADDRESS=0x... npm run setOftAdapterPeer -- --network <network>`);
  }

  // Validate token address format (basic check)
  if (!sourceOftAdapterAddress.match(/^0x[a-fA-F0-9]{40}$/) || !targetOftAdapterAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
    throw new Error('Invalid OFT Adapter address format. Please provide valid Ethereum addresses.');
  }

  console.log(`OFT Adapter Peer Setup Parameters Overview:`);
  console.table({
    Network: network,
    'Source OFT Adapter Address': sourceOftAdapterAddress,
    'Target OFT Adapter Address': targetOftAdapterAddress,
    'LayerZero Endpoint ID': lzEid,
  });

  console.log('\nSetting OFT Adapter peer...');

  const contract = await ethers.getContractAt('ExampleOFTAdapter', sourceOftAdapterAddress);
  const tx = await contract.setPeer(lzEid, '0x' + targetOftAdapterAddress.substring(2, 42).padStart(64, '0'));
  const receipt = await tx.wait();

  if (!receipt.status) {
    process.exit('Execution of setPeer failed. Tx hash: ' + tx.hash);
  }

  const setPeerSummaryData = [
    { key: 'setPeer Transaction', value: tx.hash, explorerType: 'tx' as const },
    { key: 'Transaction Status', value: receipt.status ? 'Success' : 'Failed' },
    { key: 'Gas Used', value: receipt.gasUsed.toString() },
  ];

  logExecutionSummary(setPeerSummaryData, blockExplorerUrl);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
