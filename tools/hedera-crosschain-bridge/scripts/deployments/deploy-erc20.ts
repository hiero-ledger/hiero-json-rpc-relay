// SPDX-License-Identifier: Apache-2.0
import hre, { ethers } from 'hardhat';

import { getNetworkConfigs, logExecutionSummary } from '../utils/helpers';

export async function main() {
  const network = hre.network.name;
  const [deployer] = await ethers.getSigners();

  const networkConfigs = getNetworkConfigs(network);
  if (!networkConfigs) throw new Error(`Network configuration not found for ${network}`);

  const { blockExplorerUrl } = networkConfigs;

  const initialMint = ethers.utils.parseEther(process.env.INITIAL_BALANCE || '1000000'); // Default to 1,000,000 tokens if not specified
  const decimals = process.env.DECIMALS || '8'; // Default to 8 decimals if not specified

  console.log(`ERC20Mock Deployment Parameters Overview:`);
  console.table({
    Network: network,
    'Initial Balance': initialMint.toString(),
    Decimals: decimals,
  });

  console.log('\nDeploying ERC20Mock contract...');
  const ERC20Mock = await ethers.getContractFactory('ERC20Mock');
  const erc20Mock = await ERC20Mock.deploy(initialMint, decimals);
  await erc20Mock.deployed();

  const [name, symbol, decimalsResult, totalSupply, deployerBalance] = await Promise.all([
    erc20Mock.name(),
    erc20Mock.symbol(),
    erc20Mock.decimals(),
    erc20Mock.totalSupply(),
    erc20Mock.balanceOf(deployer.address),
  ]);

  const deploymentSummaryData = [
    { key: 'Deployed ERC20 Contract', value: erc20Mock.address, explorerType: 'address' as const },
    { key: 'Deployer Address', value: deployer.address, explorerType: 'address' as const },
    { key: 'Deployment Transaction', value: erc20Mock.deployTransaction.hash, explorerType: 'tx' as const },
    { key: 'Token Name', value: name },
    { key: 'Token Symbol', value: symbol },
    { key: 'Token Decimals', value: String(decimalsResult) },
    { key: 'Total Token Supply', value: `${ethers.utils.formatEther(totalSupply)}` },
    { key: 'Deployer Token Balance', value: `${ethers.utils.formatEther(deployerBalance)}` },
  ];

  logExecutionSummary(deploymentSummaryData, blockExplorerUrl);

  return erc20Mock;
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
