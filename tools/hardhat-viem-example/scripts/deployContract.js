// SPDX-License-Identifier: Apache-2.0

import { network } from 'hardhat';

export default async () => {
  const hre = await network.create();

  //Deploy contract providing
  //name of contract as first parameter
  //array with constructor parameters from our contract as the second one
  //We use wait to receive the transaction (deployment) receipt, which contains contractAddress
  const greeter = await hre.viem.deployContract('Greeter', ['initial_msg']);

  console.log(`Greeter deployed to: ${greeter.address}`);

  return greeter.address;
};
