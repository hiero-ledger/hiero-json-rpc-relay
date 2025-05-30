// SPDX-License-Identifier: Apache-2.0
import hre, { ethers } from 'hardhat';

import { getNetworkConfigs, logExecutionSummary } from '../utils/helpers';

export async function main() {
  const network = hre.network.name;
  const [deployer] = await ethers.getSigners();

  const networkConfigs = getNetworkConfigs(network);
  if (!networkConfigs) throw new Error(`Network configuration not found for ${network}`);

  const { blockExplorerUrl } = networkConfigs;

  console.log('Deploying WHBAR contract...');
  const WHBAR = await ethers.getContractFactory('WHBAR');
  const whbar = await WHBAR.deploy();
  await whbar.deployed();

  const [name, symbol, decimals] = await Promise.all([whbar.name(), whbar.symbol(), whbar.decimals()]);

  const deploymentSummaryData = [
    { key: 'Deployed WHBAR Contract', value: whbar.address, explorerType: 'address' as const },
    { key: 'Deployer Address', value: deployer.address, explorerType: 'address' as const },
    { key: 'Deployment Transaction', value: whbar.deployTransaction.hash, explorerType: 'tx' as const },
    { key: 'Token Name', value: name },
    { key: 'Token Symbol', value: symbol },
    { key: 'Token Decimals', value: String(decimals) },
  ];

  logExecutionSummary(deploymentSummaryData, blockExplorerUrl);

  return whbar;
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
