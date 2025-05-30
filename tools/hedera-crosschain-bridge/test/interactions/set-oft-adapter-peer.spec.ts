// SPDX-License-Identifier: Apache-2.0
import { expect } from 'chai';
import { ethers } from 'hardhat';

import { main as setOftAdapterPeerScript } from '../../scripts/interactions/set-oft-adapter-peer';
import { deployERC20Token, deployOFTAdapter, runHardhatScript } from '../utils/helpers';

describe.only('Set OFT Adapter Peer Script Integration Tests', function () {
  this.timeout(240000); // 4 minutes timeout for cross-chain operations

  let hederaTokenAddress: string;
  let sepoliaTokenAddress: string;
  let hederaOftAdapterAddress: string;
  let sepoliaOftAdapterAddress: string;

  before(async function () {
    // Deploy test infrastructure on both networks
    try {
      console.log('Setting up test infrastructure on both networks...');

      // Deploy ERC20 tokens and OFT Adapters on both networks
      if (process.env.HEDERA_RPC_URL && process.env.HEDERA_PK) {
        console.log('Deploying Hedera test infrastructure...');
        hederaTokenAddress = await deployERC20Token('hedera');
        // hederaTokenAddress = '0x64551d048f56C8EA30648a87B05de4462108423f';
        console.log(`Deployed Hedera token at address: ${hederaTokenAddress}`);

        hederaOftAdapterAddress = await deployOFTAdapter('hedera', hederaTokenAddress);
        // hederaOftAdapterAddress = '0x2993ba2Fe7a29544ba82f7644a58687F1816083D';
        console.log(`Deployed Hedera OFT Adapter at: ${hederaOftAdapterAddress}`);
      }

      if (process.env.SEPOLIA_RPC_URL && process.env.SEPOLIA_PK) {
        console.log('Deploying Sepolia test infrastructure...');
        sepoliaTokenAddress = await deployERC20Token('sepolia');
        // sepoliaTokenAddress = '0x64551d048f56C8EA30648a87B05de4462108423f';
        console.log(`Deployed Sepolia token at address: ${sepoliaTokenAddress}`);

        sepoliaOftAdapterAddress = await deployOFTAdapter('sepolia', sepoliaTokenAddress);
        // sepoliaOftAdapterAddress = '0x2993ba2Fe7a29544ba82f7644a58687F1816083D';
        console.log(`Deployed Sepolia OFT Adapter at: ${sepoliaOftAdapterAddress}`);
      }
    } catch (error: any) {
      console.warn('Could not deploy test infrastructure:', error.message);
    }
  });

  describe('Hedera Network Peer Setup', function () {
    it('should successfully set peer connection from Hedera to Sepolia', async function () {
      const output = await runHardhatScript('hedera', 'scripts/interactions/set-oft-adapter-peer.ts', {
        SOURCE_OFTADAPTER_ADDRESS: hederaOftAdapterAddress,
        TARGET_OFTADAPTER_ADDRESS: sepoliaOftAdapterAddress,
      });

      // Verify script output contains expected sections
      expect(output).to.include('OFT Adapter Peer Setup Parameters Overview:');
      expect(output).to.include('Setting OFT Adapter peer...');
      expect(output).to.include('Network');
      expect(output).to.include('Source OFT Adapter Address');
      expect(output).to.include('Target OFT Adapter Address');
      expect(output).to.include('LayerZero Endpoint ID');
      expect(output).to.include('setPeer Transaction');
      expect(output).to.include('Transaction Status');
      expect(output).to.include('Gas Used');
      expect(output).to.include(hederaOftAdapterAddress);
      expect(output).to.include(sepoliaOftAdapterAddress);
    });

    it('should fail when SOURCE_OFTADAPTER_ADDRESS is not provided', async function () {
      try {
        await runHardhatScript('hedera', 'scripts/interactions/set-oft-adapter-peer.ts', {
          SOURCE_OFTADAPTER_ADDRESS: '',
          TARGET_OFTADAPTER_ADDRESS: sepoliaOftAdapterAddress || '0x1234567890123456789012345678901234567890',
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Both SOURCE_OFTADAPTER_ADDRESS and TARGET_OFTADAPTER_ADDRESS are required');
      }
    });

    it('should fail when TARGET_OFTADAPTER_ADDRESS is not provided', async function () {
      try {
        await runHardhatScript('hedera', 'scripts/interactions/set-oft-adapter-peer.ts', {
          SOURCE_OFTADAPTER_ADDRESS: hederaOftAdapterAddress || '0x1234567890123456789012345678901234567890',
          TARGET_OFTADAPTER_ADDRESS: '',
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Both SOURCE_OFTADAPTER_ADDRESS and TARGET_OFTADAPTER_ADDRESS are required');
      }
    });

    it('should fail when SOURCE_OFTADAPTER_ADDRESS format is invalid', async function () {
      try {
        await runHardhatScript('hedera', 'scripts/interactions/set-oft-adapter-peer.ts', {
          SOURCE_OFTADAPTER_ADDRESS: 'invalid-address',
          TARGET_OFTADAPTER_ADDRESS: sepoliaOftAdapterAddress || '0x1234567890123456789012345678901234567890',
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Invalid OFT Adapter address format');
      }
    });

    it('should fail when TARGET_OFTADAPTER_ADDRESS format is invalid', async function () {
      try {
        await runHardhatScript('hedera', 'scripts/interactions/set-oft-adapter-peer.ts', {
          SOURCE_OFTADAPTER_ADDRESS: hederaOftAdapterAddress || '0x1234567890123456789012345678901234567890',
          TARGET_OFTADAPTER_ADDRESS: 'invalid-address',
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Invalid OFT Adapter address format');
      }
    });
  });

  describe('Sepolia Network Peer Setup', function () {
    it('should successfully set peer connection from Sepolia to Hedera', async function () {
      if (!hederaOftAdapterAddress || !sepoliaOftAdapterAddress) {
        this.skip();
      }

      const output = await runHardhatScript('sepolia', 'scripts/interactions/set-oft-adapter-peer.ts', {
        SOURCE_OFTADAPTER_ADDRESS: sepoliaOftAdapterAddress,
        TARGET_OFTADAPTER_ADDRESS: hederaOftAdapterAddress,
      });

      // Verify script output contains expected sections
      expect(output).to.include('OFT Adapter Peer Setup Parameters Overview:');
      expect(output).to.include('Setting OFT Adapter peer...');
      expect(output).to.include('setPeer Transaction');
      expect(output).to.include('Transaction Status');
      expect(output).to.include('Gas Used');
      expect(output).to.include('etherscan.io'); // Sepolia uses Etherscan
      expect(output).to.include(sepoliaOftAdapterAddress);
      expect(output).to.include(hederaOftAdapterAddress);
    });

    it('should fail when SOURCE_OFTADAPTER_ADDRESS is not provided', async function () {
      try {
        await runHardhatScript('sepolia', 'scripts/interactions/set-oft-adapter-peer.ts', {
          SOURCE_OFTADAPTER_ADDRESS: '',
          TARGET_OFTADAPTER_ADDRESS: hederaOftAdapterAddress || '0x1234567890123456789012345678901234567890',
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Both SOURCE_OFTADAPTER_ADDRESS and TARGET_OFTADAPTER_ADDRESS are required');
      }
    });

    it('should fail when TARGET_OFTADAPTER_ADDRESS is not provided', async function () {
      try {
        await runHardhatScript('sepolia', 'scripts/interactions/set-oft-adapter-peer.ts', {
          SOURCE_OFTADAPTER_ADDRESS: sepoliaOftAdapterAddress || '0x1234567890123456789012345678901234567890',
          TARGET_OFTADAPTER_ADDRESS: '',
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Both SOURCE_OFTADAPTER_ADDRESS and TARGET_OFTADAPTER_ADDRESS are required');
      }
    });

    it('should fail when ADDRESS formats are invalid', async function () {
      try {
        await runHardhatScript('sepolia', 'scripts/interactions/set-oft-adapter-peer.ts', {
          SOURCE_OFTADAPTER_ADDRESS: 'invalid-source-address',
          TARGET_OFTADAPTER_ADDRESS: 'invalid-target-address',
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Invalid OFT Adapter address format');
      }
    });
  });

  describe('Script Function Direct Calls', function () {
    it('should successfully execute setPeer function directly on Hedera', async function () {
      if (!hederaOftAdapterAddress || !sepoliaOftAdapterAddress) {
        this.skip();
      }

      // Set environment variables for the script
      process.env.SOURCE_OFTADAPTER_ADDRESS = hederaOftAdapterAddress;
      process.env.TARGET_OFTADAPTER_ADDRESS = sepoliaOftAdapterAddress;

      // Call the script function directly
      await expect(setOftAdapterPeerScript()).to.not.be.rejected;
    });

    it('should fail when environment variables are missing', async function () {
      // Save current environment
      const originalSourceAddress = process.env.SOURCE_OFTADAPTER_ADDRESS;
      const originalTargetAddress = process.env.TARGET_OFTADAPTER_ADDRESS;

      // Remove environment variables
      delete process.env.SOURCE_OFTADAPTER_ADDRESS;
      delete process.env.TARGET_OFTADAPTER_ADDRESS;

      try {
        await setOftAdapterPeerScript();
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Both SOURCE_OFTADAPTER_ADDRESS and TARGET_OFTADAPTER_ADDRESS are required');
      } finally {
        // Restore original values
        if (originalSourceAddress) {
          process.env.SOURCE_OFTADAPTER_ADDRESS = originalSourceAddress;
        }
        if (originalTargetAddress) {
          process.env.TARGET_OFTADAPTER_ADDRESS = originalTargetAddress;
        }
      }
    });

    it('should fail when source address format is invalid', async function () {
      // Save current environment
      const originalSourceAddress = process.env.SOURCE_OFTADAPTER_ADDRESS;
      const originalTargetAddress = process.env.TARGET_OFTADAPTER_ADDRESS;

      // Set invalid addresses
      process.env.SOURCE_OFTADAPTER_ADDRESS = 'invalid-format';
      process.env.TARGET_OFTADAPTER_ADDRESS = sepoliaOftAdapterAddress || '0x1234567890123456789012345678901234567890';

      try {
        await setOftAdapterPeerScript();
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Invalid OFT Adapter address format');
      } finally {
        // Restore original values
        if (originalSourceAddress) {
          process.env.SOURCE_OFTADAPTER_ADDRESS = originalSourceAddress;
        } else {
          delete process.env.SOURCE_OFTADAPTER_ADDRESS;
        }
        if (originalTargetAddress) {
          process.env.TARGET_OFTADAPTER_ADDRESS = originalTargetAddress;
        } else {
          delete process.env.TARGET_OFTADAPTER_ADDRESS;
        }
      }
    });

    it('should fail when target address format is invalid', async function () {
      // Save current environment
      const originalSourceAddress = process.env.SOURCE_OFTADAPTER_ADDRESS;
      const originalTargetAddress = process.env.TARGET_OFTADAPTER_ADDRESS;

      // Set invalid addresses
      process.env.SOURCE_OFTADAPTER_ADDRESS = hederaOftAdapterAddress || '0x1234567890123456789012345678901234567890';
      process.env.TARGET_OFTADAPTER_ADDRESS = 'invalid-format';

      try {
        await setOftAdapterPeerScript();
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Invalid OFT Adapter address format');
      } finally {
        // Restore original values
        if (originalSourceAddress) {
          process.env.SOURCE_OFTADAPTER_ADDRESS = originalSourceAddress;
        } else {
          delete process.env.SOURCE_OFTADAPTER_ADDRESS;
        }
        if (originalTargetAddress) {
          process.env.TARGET_OFTADAPTER_ADDRESS = originalTargetAddress;
        } else {
          delete process.env.TARGET_OFTADAPTER_ADDRESS;
        }
      }
    });
  });
});
