// SPDX-License-Identifier: Apache-2.0
import '@nomicfoundation/hardhat-toolbox';

import dotenv from 'dotenv';
dotenv.config();
import { HardhatUserConfig } from 'hardhat/config';

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: '0.8.22',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  defaultNetwork: 'hedera',
  networks: {
    hedera: {
      url: process.env.HEDERA_RPC_URL,
      accounts: [process.env.HEDERA_PK || '0x'],
      chainId: Number(process.env.HEDERA_CHAIN_ID),
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL,
      chainId: Number(process.env.SEPOLIA_CHAIN_ID),
      accounts: [process.env.SEPOLIA_PK || '0x'],
    },
  },
};

export default config;
