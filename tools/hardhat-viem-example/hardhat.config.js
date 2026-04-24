// SPDX-License-Identifier: Apache-2.0

// Import dotenv module to access variables stored in the .env file
import dotenv from 'dotenv';
import { defineConfig } from "hardhat/config";
dotenv.config();

import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import hardhatViem from "@nomicfoundation/hardhat-viem";
import { task } from 'hardhat/config';

// Define Hardhat tasks here, which can be accessed in our test file (test/rpc.js) by using hre.run('taskName')
const tasks = [
  task('show-balance').setAction(() => import('./scripts/showBalance')).build(),
  task('deploy-contract').setAction(() => import('./scripts/deployContract')).build(),
  task('contract-view-call').addOption({ name: 'contractAddress', defaultValue: '' }).setAction(() => import('./scripts/contractViewCall')).build(),
  task('contract-call').addOption({ name: 'contractAddress', defaultValue: '' }).addOption({ name: 'msg', defaultValue: '' }).setAction(() => import('./scripts/contractCall')).build(),
];

export default defineConfig({
  plugins: [hardhatViem, hardhatToolboxMochaEthers],
  mocha: {
    timeout: 3600000,
  },
  solidity: {
    version: "0.8.9",
    settings: {
      optimizer: {
        enabled: true,
        runs: 500,
      },
    },
  },
  // This specifies network configurations used when running Hardhat tasks
  defaultNetwork: "testnet",
  tasks,
  networks: {
    local: {
      type: 'http',
      // Your Hedera Local Node address pulled from the .env file
      url: process.env.LOCAL_NODE_ENDPOINT,
      // Conditionally assign accounts when private key value is present
      accounts: process.env.LOCAL_NODE_OPERATOR_PRIVATE_KEY ? [process.env.LOCAL_NODE_OPERATOR_PRIVATE_KEY] : [],
    },
    testnet: {
      type: 'http',
      // HashIO testnet endpoint
      url: 'https://testnet.hashio.io/api',
      // Conditionally assign accounts when private key value is present
      accounts: process.env.TESTNET_OPERATOR_PRIVATE_KEY ? [process.env.TESTNET_OPERATOR_PRIVATE_KEY] : [],
    },

    /**
     * Uncomment the following to add a mainnet network configuration
     */
    mainnet: {
      type: 'http',
      // HashIO mainnet endpoint
      url: 'https://mainnet.hashio.io/api',
      // Conditionally assign accounts when private key value is present
      accounts: process.env.MAINNET_OPERATOR_PRIVATE_KEY ? [process.env.MAINNET_OPERATOR_PRIVATE_KEY] : [],
    },

    /**
     * Uncomment the following to add a previewnet network configuration
     */
    previewnet: {
      type: 'http',
      // HashIO previewnet endpoint
      url:'https://previewnet.hashio.io/api',
      // Conditionally assign accounts when private key value is present
      accounts: process.env.PREVIEWNET_OPERATOR_PRIVATE_KEY ? [process.env.PREVIEWNET_OPERATOR_PRIVATE_KEY] : [],
    },
  },
});
