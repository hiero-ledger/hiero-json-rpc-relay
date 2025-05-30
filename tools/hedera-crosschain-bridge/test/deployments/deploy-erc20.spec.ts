// SPDX-License-Identifier: Apache-2.0
import { expect } from 'chai';
import { ethers } from 'hardhat';

import { main as deployERC20Script } from '../../scripts/deployments/deploy-erc20';
import { runHardhatScript } from '../utils/helpers';

describe('@deployment-test Deploy ERC20 Script Integration Tests', function () {
  this.timeout(120000);

  afterEach(function () {
    delete process.env.INITIAL_BALANCE;
    delete process.env.DECIMALS;
  });

  describe('Hedera Network Deployment', function () {
    it('should deploy with default parameters', async function () {
      const output = await runHardhatScript('hedera', 'scripts/deployments/deploy-erc20.ts');

      expect(output).to.include('ERC20Mock Deployment Parameters Overview');
      expect(output).to.include('Deploying ERC20Mock contract...');
      expect(output).to.include('Execution Summary');
      expect(output).to.include('1000000');
      expect(output).to.include('8');
    });

    it('should deploy with custom parameters', async function () {
      const output = await runHardhatScript('hedera', 'scripts/deployments/deploy-erc20.ts', {
        INITIAL_BALANCE: '5000000',
        DECIMALS: '18',
      });

      expect(output).to.include('5000000');
      expect(output).to.include('18');
      expect(output).to.include('hashscan.io');
    });
  });

  describe('Sepolia Network Deployment', function () {
    it('should deploy with default parameters', async function () {
      const output = await runHardhatScript('sepolia', 'scripts/deployments/deploy-erc20.ts');

      expect(output).to.include('ERC20Mock Deployment Parameters Overview');
      expect(output).to.include('etherscan.io');
    });

    it('should deploy with custom parameters', async function () {
      const output = await runHardhatScript('sepolia', 'scripts/deployments/deploy-erc20.ts', {
        INITIAL_BALANCE: '2500000',
        DECIMALS: '6',
      });

      expect(output).to.include('2500000');
      expect(output).to.include('6');
      expect(output).to.include('sepolia.etherscan.io');
    });
  });

  describe('deployment script outcome validation', function () {
    it('should return a valid ERC20 contract instance with correct properties', async function () {
      // Set environment variables for the deployment
      process.env.INITIAL_BALANCE = '1000000';
      process.env.DECIMALS = '8';

      // Call the deployment function directly
      const deployedContract = await deployERC20Script();

      // Assert that the contract instance is returned
      expect(deployedContract).to.not.be.undefined;
      expect(deployedContract.address).to.match(/^0x[a-fA-F0-9]{40}$/);

      // Verify contract properties
      const [name, symbol, decimals, totalSupply] = await Promise.all([
        deployedContract.name(),
        deployedContract.symbol(),
        deployedContract.decimals(),
        deployedContract.totalSupply(),
      ]);

      expect(name).to.equal('ERC20Mock');
      expect(symbol).to.equal('E20M');
      expect(decimals).to.equal(8);
      expect(totalSupply).to.equal(ethers.utils.parseEther('1000000'));

      // Verify deployer balance
      const [deployer] = await ethers.getSigners();
      const deployerBalance = await deployedContract.balanceOf(deployer.address);
      expect(deployerBalance).to.equal(totalSupply);

      // Verify the contract has the expected functions
      expect(typeof deployedContract.transfer).to.equal('function');
      expect(typeof deployedContract.approve).to.equal('function');
      expect(typeof deployedContract.transferFrom).to.equal('function');
      expect(typeof deployedContract.allowance).to.equal('function');
      expect(typeof deployedContract.balanceOf).to.equal('function');
    });
  });
});
