// SPDX-License-Identifier: Apache-2.0

import { network } from 'hardhat';

export default async ({ contractAddress }) => {
  const hre = await network.create();

  //Assign the greeter contract object in a variable, this is used for already deployed contract, which we have the address for. ethers.getContractAt accepts:
  //name of contract as first parameter
  //address of our contract
  const greeter = await hre.viem.getContractAt('Greeter', contractAddress);
  //using the greeter object(which is our contract) we can call functions from the contract. In this case we call greet which returns our greeting msg
  const callRes = await greeter.read.greet();

  console.log(`Contract call result: ${callRes}`);

  return callRes;
};
