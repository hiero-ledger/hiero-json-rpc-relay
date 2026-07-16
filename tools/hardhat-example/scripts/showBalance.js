// SPDX-License-Identifier: Apache-2.0

import { ethers } from 'hardhat';

export default async () => {
  const wallet = (await ethers.getSigners())[0];
  const balance = (await wallet.provider.getBalance(wallet.address)).toString();
  console.log(`The address ${wallet.address} has ${balance} tinybars`);

  return balance;
};
