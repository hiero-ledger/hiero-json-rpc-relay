// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';

import { constants } from '../../scripts/utils/constants';
import { getNetworkConfigs } from '../../scripts/utils/helpers';
import { deployContractOnNetwork, executeContractCallOnNetwork, runHardhatScript, TEST_CONFIG } from '../utils/helpers';

describe('@deployment-test Deploy HTS Connector Script Integration Tests', function () {
  this.timeout(120000);

  let deployer: any;
  let htsConnector: Contract;
  const network = 'hedera';

  before(async function () {
    [deployer] = await ethers.getSigners();

    const networkConfigs = getNetworkConfigs(network);
    htsConnector = await deployContractOnNetwork(network, 'ExampleHTSConnector', [
      constants.TOKEN_NAME,
      constants.TOKEN_SYMBOL,
      networkConfigs.lzEndpointAddress,
      deployer.address,
      {
        gasLimit: TEST_CONFIG.TX_GAS_LIMIT,
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

    expect(name).to.equal(constants.TOKEN_NAME);
    expect(symbol).to.equal(constants.TOKEN_SYMBOL);
    expect(totalSupply).to.equal(1000);
    expect(decimals).to.equal(constants.TOKEN_DECIMALS);
  });
});
