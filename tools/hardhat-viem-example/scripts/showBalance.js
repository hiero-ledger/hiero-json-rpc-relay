// SPDX-License-Identifier: Apache-2.0

import { network } from 'hardhat';

export default async () => {
  const hre = await network.create();

  const [walletClient] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const balance = await publicClient.getBalance({
    address: walletClient.account.address,
  });
  console.log(`The address ${walletClient.account.address} has ${balance} weibars`);

  return balance;
};
