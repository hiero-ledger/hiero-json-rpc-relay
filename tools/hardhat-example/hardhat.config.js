// SPDX-License-Identifier: Apache-2.0

import 'dotenv/config';
import '@nomicfoundation/hardhat-toolbox';
import { task } from 'hardhat/config';

task('show-balance').setAction(async () => {
  const { default: showBalance } = await import('./scripts/showBalance.js');
  return showBalance();
});

task('transfer-hbars').setAction(async () => {
  const { default: transferHbar } = await import('./scripts/transferHbars.js');
  return transferHbar();
});

task('deploy-contract').setAction(async () => {
  const { default: deployContract } = await import('./scripts/deployContract.js');
  return deployContract();
});

task('contract-view-call').setAction(async (taskArgs) => {
  const { default: contractViewCall } = await import('./scripts/contractViewCall.js');
  return contractViewCall(taskArgs.contractAddress);
});

task('contract-call').setAction(async (taskArgs) => {
  const { default: contractCall } = await import('./scripts/contractCall.js');
  return contractCall(taskArgs.contractAddress, taskArgs.msg);
});

const mnemonic = process.env.MNEMONIC;
if (!mnemonic) {
  throw new Error('Please set your MNEMONIC in a .env file');
}

/** @type import('hardhat/config').HardhatUserConfig */
export default {
  mocha: {
    timeout: 3600000,
  },
  solidity: {
    version: '0.8.9',
    settings: {
      optimizer: {
        enabled: true,
        runs: 500,
      },
    },
  },
  defaultNetwork: 'local',
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      accounts: {
        mnemonic,
      },
    },
    local: {
      url: process.env.RELAY_ENDPOINT,
      accounts: [process.env.OPERATOR_PRIVATE_KEY, process.env.RECEIVER_PRIVATE_KEY],
      chainId: 298,
    },
    testnet: {
      url: 'https://testnet.hashio.io/api',
      accounts: process.env.TESTNET_OPERATOR_PRIVATE_KEY ? [process.env.TESTNET_OPERATOR_PRIVATE_KEY] : [],
      chainId: 296,
    },
  },

  // https://hardhat.org/hardhat-runner/plugins/nomicfoundation-hardhat-verify#verifying-on-sourcify
  sourcify: {
    // Enable it to support verification in Hedera's custom Sourcify instance
    enabled: true,
    // Needed to specify a different Sourcify server
    apiUrl: 'https://server-verify.hashscan.io',
    // Needed to specify a different Sourcify repository
    browserUrl: 'https://repository-verify.hashscan.io',
  },
};
