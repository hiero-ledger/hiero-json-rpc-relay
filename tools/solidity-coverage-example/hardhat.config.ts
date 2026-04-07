// SPDX-License-Identifier: Apache-2.0

/** @type import('hardhat/config').HardhatUserConfig */
import '@nomicfoundation/hardhat-toolbox';
import 'solidity-coverage';

import { HardhatUserConfig } from 'hardhat/config';

const config: HardhatUserConfig = {
  solidity: '0.8.19',
};

export default config;
