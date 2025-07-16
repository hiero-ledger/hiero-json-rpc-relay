// SPDX-License-Identifier: Apache-2.0

import hre, { ethers } from 'hardhat';

import { TEST_CONFIG } from '../../test/utils/helpers';
import { constants } from '../utils/constants';
import { getNetworkConfigs, logExecutionSummary } from '../utils/helpers';

async function main() {
  const network = hre.network.name;
  const [deployer] = await ethers.getSigners();

  const networkConfigs = getNetworkConfigs(network);
  if (!networkConfigs) throw new Error(`Network configuration not found for ${network}`);

  const { blockExplorerUrl, lzEndpointAddress } = networkConfigs;

  if (!lzEndpointAddress) {
    throw new Error(`LayerZero endpoint not configured for ${network}`);
  }

  console.log(`HTS Connector Deployment Parameters Overview:`);
  console.table({
    Network: network,
    'Token Name': constants.TOKEN_NAME,
    'Token Symbol': constants.TOKEN_SYMBOL,
    'LayerZero Endpoint Address': lzEndpointAddress,
    'Owner Address': deployer.address,
  });

  console.log('\nDeploying HTS Connector contract...');
  const htsConnectorFactory = await ethers.getContractFactory('ExampleHTSConnector');
  const htsConnector = await htsConnectorFactory.deploy(
    constants.TOKEN_NAME,
    constants.TOKEN_SYMBOL,
    lzEndpointAddress,
    deployer.address,
    {
      gasLimit: TEST_CONFIG.TX_GAS_LIMIT,
      value: '30000000000000000000', // 30 hbars
    },
  );
  await htsConnector.deployTransaction.wait();

  const tokenAddress = await htsConnector.htsTokenAddress();
  const tokenWrapper = await ethers.getContractAt('ERC20', tokenAddress);
  const [name, symbol, decimalsResult, totalSupply, deployerBalance] = await Promise.all([
    tokenWrapper.name(),
    tokenWrapper.symbol(),
    tokenWrapper.decimals(),
    tokenWrapper.totalSupply(),
    tokenWrapper.balanceOf(deployer.address),
  ]);

  const deploymentSummaryData = [
    { key: 'Deployed HTS Connector Contract', value: htsConnector.address, explorerType: 'address' as const },
    { key: 'Deployer Address', value: deployer.address, explorerType: 'address' as const },
    { key: 'Deployment Transaction', value: htsConnector.deployTransaction.hash, explorerType: 'tx' as const },
    { key: 'Token Address', value: tokenAddress },
    { key: 'Token Name', value: name },
    { key: 'Token Symbol', value: symbol },
    { key: 'Token Decimals', value: String(decimalsResult) },
    { key: 'Total Token Supply', value: `${ethers.utils.formatEther(totalSupply)}` },
    { key: 'Deployer Token Balance', value: `${ethers.utils.formatEther(deployerBalance)}` },
  ];

  logExecutionSummary(deploymentSummaryData, blockExplorerUrl);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
