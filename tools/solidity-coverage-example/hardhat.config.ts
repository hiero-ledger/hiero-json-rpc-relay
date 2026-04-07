// SPDX-License-Identifier: Apache-2.0

/** @type import('hardhat/config').HardhatUserConfig */
import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import 'solidity-coverage';

const config: HardhatUserConfig = {
  solidity: '0.8.19',
};

export default config;
