// SPDX-License-Identifier: Apache-2.0

const { ethers } = require('hardhat');

module.exports = async (address, msg) => {
  const wallet = (await ethers.getSigners())[0];
  const greeter = await ethers.getContractAt('Greeter', address, wallet);
  const updateTx = await greeter.setGreeting(msg, { gasPrice: 710_000_000_000 });

  console.log(`Updated call result: ${msg}`);

  return updateTx;
};
