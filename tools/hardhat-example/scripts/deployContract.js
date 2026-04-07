// SPDX-License-Identifier: Apache-2.0

const { ethers } = require('hardhat');

module.exports = async () => {
  let wallet = (await ethers.getSigners())[0];
  const Greeter = await ethers.getContractFactory('Greeter', wallet);
  const greeter = await Greeter.deploy('initial_msg');
  const contractAddress = (await greeter.deploymentTransaction().wait()).contractAddress;

  console.log(`Greeter deployed to: ${contractAddress}`);

  return contractAddress;
};
