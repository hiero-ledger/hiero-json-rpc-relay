// SPDX-License-Identifier: Apache-2.0
import { expect } from 'chai';

import { main as deployWHBARScript } from '../../scripts/deployments/deploy-whbar';
import { runHardhatScript } from '../utils/helpers';

describe('@deployment-test Deploy WHBAR Script Integration Tests', function () {
  this.timeout(120000);

  describe('Hedera Network Deployment', function () {
    it('should deploy WHBAR contract successfully', async function () {
      const output = await runHardhatScript('hedera', 'scripts/deployments/deploy-whbar.ts');

      expect(output).to.include('Deploying WHBAR contract...');
      expect(output).to.include('Deployed WHBAR Contract');
      expect(output).to.include('Deployer Address');
      expect(output).to.include('Deployment Transaction');
      expect(output).to.include('Token Name');
      expect(output).to.include('Token Symbol');
      expect(output).to.include('Token Decimals');
      expect(output).to.include('hashscan.io');
    });

    it('should deploy with correct WHBAR properties', async function () {
      const output = await runHardhatScript('hedera', 'scripts/deployments/deploy-whbar.ts');

      // Verify WHBAR-specific properties
      expect(output).to.include('Wrapped HBAR');
      expect(output).to.include('WHBAR');
      expect(output).to.include('8'); // decimals
    });
  });

  describe('Sepolia Network Deployment', function () {
    it('should deploy WHBAR contract successfully', async function () {
      const output = await runHardhatScript('sepolia', 'scripts/deployments/deploy-whbar.ts');

      expect(output).to.include('Deploying WHBAR contract...');
      expect(output).to.include('Deployed WHBAR Contract');
      expect(output).to.include('etherscan.io');
    });

    it('should deploy with correct WHBAR properties', async function () {
      const output = await runHardhatScript('sepolia', 'scripts/deployments/deploy-whbar.ts');

      // Verify WHBAR-specific properties
      expect(output).to.include('Wrapped HBAR');
      expect(output).to.include('WHBAR');
      expect(output).to.include('8'); // decimals
      expect(output).to.include('sepolia.etherscan.io');
    });
  });

  describe('Script Output Validation', function () {
    it('should return a valid ERC20 contract instance with correct properties', async function () {
      // Set environment variables for the deployment
      process.env.INITIAL_BALANCE = '1000000';
      process.env.DECIMALS = '8';

      // Call the deployment function directly
      const deployedContract = await deployWHBARScript();

      // Assert that the contract instance is returned
      expect(deployedContract).to.not.be.undefined;
      expect(deployedContract.address).to.match(/^0x[a-fA-F0-9]{40}$/);

      // Verify contract properties
      const [name, symbol, decimals] = await Promise.all([
        deployedContract.name(),
        deployedContract.symbol(),
        deployedContract.decimals(),
      ]);

      expect(name).to.equal('Wrapped HBAR');
      expect(symbol).to.equal('WHBAR');
      expect(decimals).to.equal(8);

      // Verify the contract has the expected functions
      expect(typeof deployedContract.transfer).to.equal('function');
      expect(typeof deployedContract.approve).to.equal('function');
      expect(typeof deployedContract.transferFrom).to.equal('function');
      expect(typeof deployedContract.allowance).to.equal('function');
      expect(typeof deployedContract.balanceOf).to.equal('function');
    });
  });
});
