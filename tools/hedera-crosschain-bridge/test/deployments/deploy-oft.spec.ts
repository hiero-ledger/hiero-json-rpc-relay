// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { ethers } from 'hardhat';

import { getNetworkConfigs } from '../../scripts/utils/helpers';
import { deployContractOnNetwork, executeContractCallOnNetwork, runHardhatScript } from '../utils/helpers';

describe('Deploy OFT Script Integration Tests', function () {
  this.timeout(120000);

  const tokenInfo = {
    name: 'T_NAME',
    symbol: 'T_SYMBOL',
    totalSupply: 1000000,
    decimals: 8,
  };

  ['hedera', 'sepolia'].forEach((network) => {
    let deployer: any;
    let oftAddress: string;

    before(async function () {
      [deployer] = await ethers.getSigners();

      const networkConfigs = getNetworkConfigs(network);
      oftAddress = await deployContractOnNetwork(network, 'ExampleOFT', [
        tokenInfo.name,
        tokenInfo.symbol,
        networkConfigs.lzEndpointAddress,
        deployer.address,
        tokenInfo.totalSupply,
        tokenInfo.decimals,
      ]);
    });

    it(`${network} should deploy OFT contract successfully`, async function () {
      const output = await runHardhatScript(network, 'scripts/deployments/deploy-oft.ts');

      expect(output).to.include('Network');
      expect(output).to.include('Deployed OFT Contract');
      expect(output).to.include('Deployer Address');
      expect(output).to.include('Token Name');
      expect(output).to.include('Token Symbol');
      expect(output).to.include('Token Decimals');
      expect(output).to.include('Total Token Supply');
    });

    it(`${network} should return correct properties for deployed OFT`, async function () {
      const [name, symbol, totalSupply, decimals, token] = await Promise.all([
        executeContractCallOnNetwork(network, 'ExampleOFT', oftAddress, 'name'),
        executeContractCallOnNetwork(network, 'ExampleOFT', oftAddress, 'symbol'),
        executeContractCallOnNetwork(network, 'ExampleOFT', oftAddress, 'totalSupply'),
        executeContractCallOnNetwork(network, 'ExampleOFT', oftAddress, 'decimals'),
        executeContractCallOnNetwork(network, 'ExampleOFT', oftAddress, 'token'),
      ]);

      expect(name).to.equal(tokenInfo.name);
      expect(symbol).to.equal(tokenInfo.symbol);
      expect(totalSupply).to.equal(tokenInfo.totalSupply);
      expect(decimals).to.equal(tokenInfo.decimals);
      expect(token).to.equal(oftAddress);
    });
  });
});
