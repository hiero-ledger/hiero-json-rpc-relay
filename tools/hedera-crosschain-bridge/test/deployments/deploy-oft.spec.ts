// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';

import { constants } from '../../scripts/utils/constants';
import { getNetworkConfigs } from '../../scripts/utils/helpers';
import { deployContractOnNetwork, executeContractCallOnNetwork, runHardhatScript } from '../utils/helpers';

describe('@deployment-test Deploy OFT Script Integration Tests', function () {
  this.timeout(120000);

  const tokenInfo = {
    name: constants.TOKEN_NAME,
    symbol: constants.TOKEN_SYMBOL,
    totalSupply: 1000000,
    decimals: constants.TOKEN_DECIMALS,
  };

  ['hedera', 'sepolia'].forEach((network) => {
    let deployer: any;
    let oft: Contract;

    before(async function () {
      [deployer] = await ethers.getSigners();

      const networkConfigs = getNetworkConfigs(network);
      oft = await deployContractOnNetwork(network, 'ExampleOFT', [
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
        executeContractCallOnNetwork(network, 'ExampleOFT', oft.address, 'name'),
        executeContractCallOnNetwork(network, 'ExampleOFT', oft.address, 'symbol'),
        executeContractCallOnNetwork(network, 'ExampleOFT', oft.address, 'totalSupply'),
        executeContractCallOnNetwork(network, 'ExampleOFT', oft.address, 'decimals'),
        executeContractCallOnNetwork(network, 'ExampleOFT', oft.address, 'token'),
      ]);

      expect(name).to.equal(tokenInfo.name);
      expect(symbol).to.equal(tokenInfo.symbol);
      expect(totalSupply).to.equal(tokenInfo.totalSupply);
      expect(decimals).to.equal(tokenInfo.decimals);
      expect(token).to.equal(oft.address);
    });
  });
});
