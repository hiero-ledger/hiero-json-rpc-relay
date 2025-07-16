// SPDX-License-Identifier: Apache-2.0

import hre, { ethers } from 'hardhat';

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

  const initialMint = ethers.utils.parseEther(process.env.INITIAL_BALANCE || '1000000'); // Default to 1,000,000 tokens if not specified
  const decimals = process.env.DECIMALS || '8'; // Default to 8 decimals if not specified
  console.log(`OFT Deployment Parameters Overview:`);
  console.table({
    Network: network,
    'Token Name': constants.TOKEN_NAME,
    'Token Symbol': constants.TOKEN_SYMBOL,
    'LayerZero Endpoint Address': lzEndpointAddress,
    'Owner Address': deployer.address,
    'Initial Balance': initialMint.toString(),
    Decimals: decimals,
  });

  console.log('\nDeploying OFT contract...');
  const exampleOft = await ethers.getContractFactory('ExampleOFT');
  const exampleOftMock = await exampleOft.deploy(
    constants.TOKEN_NAME,
    constants.TOKEN_SYMBOL,
    lzEndpointAddress,
    deployer.address,
    initialMint,
    decimals,
  );
  await exampleOftMock.deployed();

  const [name, symbol, decimalsResult, totalSupply, deployerBalance] = await Promise.all([
    exampleOftMock.name(),
    exampleOftMock.symbol(),
    exampleOftMock.decimals(),
    exampleOftMock.totalSupply(),
    exampleOftMock.balanceOf(deployer.address),
  ]);

  const deploymentSummaryData = [
    { key: 'Deployed OFT Contract', value: exampleOftMock.address, explorerType: 'address' as const },
    { key: 'Deployer Address', value: deployer.address, explorerType: 'address' as const },
    { key: 'Deployment Transaction', value: exampleOftMock.deployTransaction.hash, explorerType: 'tx' as const },
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
