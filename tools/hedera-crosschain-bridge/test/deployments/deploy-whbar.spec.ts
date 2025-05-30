// SPDX-License-Identifier: Apache-2.0
import { expect } from 'chai';
import { spawn } from 'child_process';
import { ethers } from 'hardhat';
import hre from 'hardhat';

import { main as deployWHBARScript } from '../../scripts/deployments/deploy-whbar';

describe('Deploy WHBAR Script Integration Tests', function () {
  this.timeout(120000);

  let deployer: any;

  before(async function () {
    [deployer] = await ethers.getSigners();
  });

  async function runDeploymentScript(network: string) {
    const deploymentProcess = spawn(
      'npx',
      ['hardhat', 'run', 'scripts/deployments/deploy-whbar.ts', '--network', network],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd(),
        env: { ...process.env },
      },
    );

    let output = '';
    let error = '';

    deploymentProcess.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    deploymentProcess.stderr.on('data', (data: Buffer) => {
      error += data.toString();
    });

    await new Promise((resolve, reject) => {
      deploymentProcess.on('close', (code: number) => {
        if (code === 0) {
          resolve(code);
        } else {
          reject(new Error(`Deployment failed with code ${code}: ${error}`));
        }
      });
    });

    return output;
  }

  describe('Hedera Network Deployment', function () {
    before(function () {
      if (hre.network.name !== 'hedera' || !process.env.HEDERA_RPC_URL || !process.env.HEDERA_PK) {
        this.skip();
      }
    });

    it('should deploy WHBAR contract successfully', async function () {
      const output = await runDeploymentScript('hedera');

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
      const output = await runDeploymentScript('hedera');

      // Verify WHBAR-specific properties
      expect(output).to.include('Wrapped HBAR');
      expect(output).to.include('WHBAR');
      expect(output).to.include('8'); // decimals
    });
  });

  describe('Sepolia Network Deployment', function () {
    it('should deploy WHBAR contract successfully', async function () {
      const output = await runDeploymentScript('sepolia');

      expect(output).to.include('Deploying WHBAR contract...');
      expect(output).to.include('Deployed WHBAR Contract');
      expect(output).to.include('etherscan.io');
    });

    it('should deploy with correct WHBAR properties', async function () {
      const output = await runDeploymentScript('sepolia');

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
