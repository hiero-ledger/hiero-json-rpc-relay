// SPDX-License-Identifier: Apache-2.0

import { ethers } from 'hardhat';

export default async (address) => {
  const wallet = (await ethers.getSigners())[0];
  const greeter = await ethers.getContractAt('Greeter', address, wallet);
  const callRes = await greeter.greet();

  console.log(`Contract call result: ${callRes}`);

  return callRes;
};
