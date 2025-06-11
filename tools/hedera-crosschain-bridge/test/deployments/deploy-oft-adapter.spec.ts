// SPDX-License-Identifier: Apache-2.0
import { expect } from 'chai';
import { ethers } from 'hardhat';

import { main as deployOFTAdapterScript } from '../../scripts/deployments/deploy-oft-adapter';
import { deployContractOnNetwork, runHardhatScript } from '../utils/helpers';

describe('@deployment-test Deploy OFT Adapter Script Integration Tests', function () {
  this.timeout(120000);

  let deployer: any;
  let hederaTokenAddress: any;
  let sepoliaTokenAddress: any;

  before(async function () {
    [deployer] = await ethers.getSigners();

    // Deploy real ERC20 tokens on both networks
    try {
      console.log('Setting up test tokens on both networks...');

      // Deploy on Hedera network
      if (process.env.HEDERA_RPC_URL && process.env.HEDERA_PK) {
        hederaTokenAddress = await deployContractOnNetwork('hedera', 'ERC20Mock', [
          ethers.utils.parseEther('1000000'), // Initial supply of 1M tokens
          8, // Decimals
        ]);
      }

      // Deploy on Sepolia network
      if (process.env.SEPOLIA_RPC_URL && process.env.SEPOLIA_PK) {
        sepoliaTokenAddress = await deployContractOnNetwork('sepolia', 'ERC20Mock', [
          ethers.utils.parseEther('1000000'), // Initial supply of 1M tokens
          8, // Decimals
        ]);
      }
    } catch (error: any) {
      console.warn('Could not deploy test tokens', error.message);
    }
  });

  describe('Hedera Network Deployment', function () {
    it('should deploy OFT Adapter contract successfully', async function () {
      const output = await runHardhatScript('hedera', 'scripts/deployments/deploy-oft-adapter.ts', {
        TOKEN_ADDRESS: hederaTokenAddress.address,
      });

      // Verify OFT Adapter-specific properties
      expect(output).to.include(hederaTokenAddress.address);
      expect(output).to.include('Network');
      expect(output).to.include('Token Address');
      expect(output).to.include('LayerZero Endpoint Address');
      expect(output).to.include('Owner Address');
    });

    it('should fail when TOKEN_ADDRESS is not provided', async function () {
      try {
        await runHardhatScript('hedera', 'scripts/deployments/deploy-oft-adapter.ts', {
          TOKEN_ADDRESS: '',
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Token address is required');
      }
    });

    it('should fail when TOKEN_ADDRESS format is invalid', async function () {
      try {
        await runHardhatScript('hedera', 'scripts/deployments/deploy-oft-adapter.ts', {
          TOKEN_ADDRESS: 'invalid-address',
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Invalid token address format');
      }
    });
  });

  describe('Sepolia Network Deployment', function () {
    it('should deploy OFT Adapter contract successfully', async function () {
      const output = await runHardhatScript('sepolia', 'scripts/deployments/deploy-oft-adapter.ts', {
        TOKEN_ADDRESS: sepoliaTokenAddress.address,
      });

      expect(output).to.include('ExampleOFTAdapter Deployment Parameters Overview:');
      expect(output).to.include('Deploying ExampleOFTAdapter contract...');
      expect(output).to.include('Deployed OFTAdapter Contract');
      expect(output).to.include('etherscan.io');
    });

    it('should fail when TOKEN_ADDRESS is not provided', async function () {
      try {
        await runHardhatScript('sepolia', 'scripts/deployments/deploy-oft-adapter.ts', {
          TOKEN_ADDRESS: '',
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Token address is required');
      }
    });

    it('should fail when TOKEN_ADDRESS format is invalid', async function () {
      try {
        await runHardhatScript('sepolia', 'scripts/deployments/deploy-oft-adapter.ts', {
          TOKEN_ADDRESS: 'invalid-address',
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Invalid token address format');
      }
    });
  });

  describe('Script Output Validation', function () {
    it('should return a valid OFT Adapter contract instance with correct properties', async function () {
      //   Set environment variables for the deployment
      process.env.TOKEN_ADDRESS = hederaTokenAddress.address;

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
