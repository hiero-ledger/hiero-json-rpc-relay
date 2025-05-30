// SPDX-License-Identifier: Apache-2.0
import { expect } from 'chai';
import { spawn } from 'child_process';
import { ethers } from 'hardhat';

import { main as deployOFTAdapterScript } from '../../scripts/deployments/deploy-oft-adapter';

describe('Deploy OFT Adapter Script Integration Tests', function () {
  this.timeout(120000);

  let deployer: any;
  let hederaTokenAddress: string;
  let sepoliaTokenAddress: string;

  // Utility method to deploy ERC20 tokens using Ethers.js v5
  async function deployERC20Token(network: string): Promise<string> {
    // Configure provider based on network
    let provider;
    let wallet;

    if (network === 'hedera') {
      if (!process.env.HEDERA_RPC_URL || !process.env.HEDERA_PK) {
        throw new Error('HEDERA_RPC_URL and HEDERA_PK environment variables are required for Hedera deployment');
      }
      provider = new ethers.providers.JsonRpcProvider(process.env.HEDERA_RPC_URL);
      wallet = new ethers.Wallet(process.env.HEDERA_PK, provider);
    } else if (network === 'sepolia') {
      if (!process.env.SEPOLIA_RPC_URL || !process.env.SEPOLIA_PK) {
        throw new Error('SEPOLIA_RPC_URL and SEPOLIA_PK environment variables are required for Sepolia deployment');
      }
      provider = new ethers.providers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
      wallet = new ethers.Wallet(process.env.SEPOLIA_PK, provider);
    } else {
      throw new Error(`Unsupported network: ${network}`);
    }

    // Deploy ERC20Mock contract
    const initialMint = ethers.utils.parseEther('1000000'); // 1M tokens
    const decimals = 8;

    const ERC20MockFactory = await ethers.getContractFactory('ERC20Mock', wallet);
    const erc20Mock = await ERC20MockFactory.deploy(initialMint, decimals);
    await erc20Mock.deployed();
    return erc20Mock.address;
  }

  before(async function () {
    [deployer] = await ethers.getSigners();

    // Deploy real ERC20 tokens on both networks
    try {
      console.log('Setting up test tokens on both networks...');

      // Deploy on Hedera network
      if (process.env.HEDERA_RPC_URL && process.env.HEDERA_PK) {
        hederaTokenAddress = await deployERC20Token('hedera');
        console.log(`Deployed Hedera token at address: ${hederaTokenAddress}`);
      }

      // Deploy on Sepolia network
      if (process.env.SEPOLIA_RPC_URL && process.env.SEPOLIA_PK) {
        sepoliaTokenAddress = await deployERC20Token('sepolia');
        console.log(`Deployed Sepolia token at address: ${sepoliaTokenAddress}`);
      }
    } catch (error: any) {
      console.warn('Could not deploy test tokens', error.message);
    }
  });

  async function runDeploymentScript(network: string, tokenAddress: string) {
    const env = {
      ...process.env,
      TOKEN_ADDRESS: tokenAddress,
    };

    const deploymentProcess = spawn(
      'npx',
      ['hardhat', 'run', 'scripts/deployments/deploy-oft-adapter.ts', '--network', network],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd(),
        env,
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
    it('should deploy OFT Adapter contract successfully', async function () {
      const output = await runDeploymentScript('hedera', hederaTokenAddress);

      // Verify OFT Adapter-specific properties
      expect(output).to.include(hederaTokenAddress);
      expect(output).to.include('Network');
      expect(output).to.include('Token Address');
      expect(output).to.include('LayerZero Endpoint Address');
      expect(output).to.include('Owner Address');
    });

    it('should fail when TOKEN_ADDRESS is not provided', async function () {
      try {
        await runDeploymentScript('hedera', '');
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Token address is required');
      }
    });

    it('should fail when TOKEN_ADDRESS format is invalid', async function () {
      try {
        await runDeploymentScript('hedera', 'invalid-address');
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Invalid token address format');
      }
    });
  });

  describe('Sepolia Network Deployment', function () {
    it('should deploy OFT Adapter contract successfully', async function () {
      const output = await runDeploymentScript('sepolia', sepoliaTokenAddress);

      expect(output).to.include('ExampleOFTAdapter Deployment Parameters Overview:');
      expect(output).to.include('Deploying ExampleOFTAdapter contract...');
      expect(output).to.include('Deployed OFTAdapter Contract');
      expect(output).to.include('etherscan.io');
    });

    it('should fail when TOKEN_ADDRESS is not provided', async function () {
      try {
        await runDeploymentScript('sepolia', '');
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Token address is required');
      }
    });

    it('should fail when TOKEN_ADDRESS format is invalid', async function () {
      try {
        await runDeploymentScript('sepolia', 'invalid-address');
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Invalid token address format');
      }
    });
  });

  describe('Script Output Validation', function () {
    it('should return a valid OFT Adapter contract instance with correct properties', async function () {
      //   Set environment variables for the deployment
      process.env.TOKEN_ADDRESS = hederaTokenAddress;

      // Call the deployment function directly
      const deployedContract = await deployOFTAdapterScript();

      // Assert that the contract instance is returned
      expect(deployedContract).to.not.be.undefined;
      expect(deployedContract.address).to.match(/^0x[a-fA-F0-9]{40}$/);

      // Verify contract properties
      const [token, endpoint, owner] = await Promise.all([
        deployedContract.token(),
        deployedContract.endpoint(),
        deployedContract.owner(),
      ]);

      //   expect(token).to.equal(mockTokenAddress);
      expect(endpoint).to.match(/^0x[a-fA-F0-9]{40}$/);
      expect(owner).to.equal(deployer.address);

      // Verify the contract has the expected OFT Adapter functions
      expect(typeof deployedContract.token).to.equal('function');
      expect(typeof deployedContract.endpoint).to.equal('function');
      expect(typeof deployedContract.owner).to.equal('function');
    });

    it('should fail when TOKEN_ADDRESS environment variable is missing', async function () {
      // Remove TOKEN_ADDRESS from environment
      const originalTokenAddress = process.env.TOKEN_ADDRESS;
      delete process.env.TOKEN_ADDRESS;

      try {
        await deployOFTAdapterScript();
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Token address is required');
      } finally {
        // Restore original value
        if (originalTokenAddress) {
          process.env.TOKEN_ADDRESS = originalTokenAddress;
        }
      }
    });

    it('should fail when TOKEN_ADDRESS format is invalid', async function () {
      // Set invalid token address
      const originalTokenAddress = process.env.TOKEN_ADDRESS;
      process.env.TOKEN_ADDRESS = 'invalid-format';

      try {
        await deployOFTAdapterScript();
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Invalid token address format');
      } finally {
        // Restore original value
        if (originalTokenAddress) {
          process.env.TOKEN_ADDRESS = originalTokenAddress;
        } else {
          delete process.env.TOKEN_ADDRESS;
        }
      }
    });
  });
});
