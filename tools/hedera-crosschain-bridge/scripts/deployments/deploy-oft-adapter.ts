// SPDX-License-Identifier: Apache-2.0
import hre, { ethers } from 'hardhat';

import { getNetworkConfigs, logExecutionSummary } from '../utils/helpers';

export async function main() {
  const network = hre.network.name;
  const [deployer] = await ethers.getSigners();

  const networkConfigs = getNetworkConfigs(network);
  if (!networkConfigs) throw new Error(`Network configuration not found for ${network}`);

  const { blockExplorerUrl, lzEndpointAddress } = networkConfigs;

  if (!lzEndpointAddress) {
    throw new Error(`LayerZero endpoint not configured for ${network}`);
  }

  // Get required token address from environment variable
  const tokenAddress = process.env.TOKEN_ADDRESS;

  if (!tokenAddress) {
    throw new Error(`Token address is required. Usage:
      TOKEN_ADDRESS=0x... npm run deploy-oftAdapter -- --network <network>`);
  }

  // Validate token address format (basic check)
  if (!tokenAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
    throw new Error('Invalid token address format. Please provide a valid Ethereum address.');
  }

  const ownerAddress = deployer.address;

  console.log(`ExampleOFTAdapter Deployment Parameters Overview:`);
  console.table({
    Network: network,
    'Token Address': tokenAddress,
    'LayerZero Endpoint Address': lzEndpointAddress,
    'Owner Address': ownerAddress,
  });

  console.log('\nDeploying ExampleOFTAdapter contract...');
  const ExampleOFTAdapter = await ethers.getContractFactory('ExampleOFTAdapter');
  const oftAdapter = await ExampleOFTAdapter.deploy(tokenAddress, lzEndpointAddress, ownerAddress);
  await oftAdapter.deployed();

  const [token, endpoint, owner] = await Promise.all([oftAdapter.token(), oftAdapter.endpoint(), oftAdapter.owner()]);

  const deploymentSummaryData = [
    { key: 'Deployed OFTAdapter Contract', value: oftAdapter.address, explorerType: 'address' as const },
    { key: 'Deployer Address', value: deployer.address, explorerType: 'address' as const },
    { key: 'Deployment Transaction', value: oftAdapter.deployTransaction.hash, explorerType: 'tx' as const },
    { key: 'Underlying Token', value: token, explorerType: 'address' as const },
    { key: 'LayerZero Endpoint', value: endpoint, explorerType: 'address' as const },
    { key: 'Contract Owner', value: owner, explorerType: 'address' as const },
  ];

  logExecutionSummary(deploymentSummaryData, blockExplorerUrl);

  return oftAdapter;
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
