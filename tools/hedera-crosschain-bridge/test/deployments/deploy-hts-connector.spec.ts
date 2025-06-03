// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';

import { getNetworkConfigs } from '../../scripts/utils/helpers';
import { deployContractOnNetwork, executeContractCallOnNetwork, runHardhatScript } from '../utils/helpers';

describe('Deploy HTS Connector Script Integration Tests', function () {
  this.timeout(120000);

  let deployer: any;
  let htsConnector: Contract;
  const network = 'hedera';
  const tokenName = 'T_NAME';
  const tokenSymbol = 'T_SYMBOL';

  before(async function () {
    [deployer] = await ethers.getSigners();

    const networkConfigs = getNetworkConfigs(network);
    htsConnector = await deployContractOnNetwork(network, 'ExampleHTSConnector', [
      tokenName,
      tokenSymbol,
      networkConfigs.lzEndpointAddress,
      deployer.address,
      {
        gasLimit: 10_000_000,
        value: '30000000000000000000', // 30 hbars
      },
    ]);
  });

  it(`${network} should deploy HTS Connector contract successfully`, async function () {
    const output = await runHardhatScript(network, 'scripts/deployments/deploy-hts-connector.ts');

    expect(output).to.include('Network');
    expect(output).to.include('Deployed HTS Connector Contract');
    expect(output).to.include('Deployer Address');
    expect(output).to.include('Token Name');
    expect(output).to.include('Token Symbol');
    expect(output).to.include('Token Decimals');
    expect(output).to.include('Total Token Supply');
  });

  it(`${network} should return correct properties for HTS Connector`, async function () {
    const token = await executeContractCallOnNetwork(network, 'ExampleHTSConnector', htsConnector.address, 'token');
    expect(token).to.not.be.null;
    expect(token).lengthOf(42);

    const tokenWrapper = await ethers.getContractAt('ERC20Mock', token, deployer);
    const [name, symbol, totalSupply, decimals] = await Promise.all([
      tokenWrapper.name(),
      tokenWrapper.symbol(),
      tokenWrapper.totalSupply(),
      tokenWrapper.decimals(),
    ]);

    expect(name).to.equal(tokenName);
    expect(symbol).to.equal(tokenSymbol);
    expect(totalSupply).to.equal(1000);
    expect(decimals).to.equal(8);
  });
});
