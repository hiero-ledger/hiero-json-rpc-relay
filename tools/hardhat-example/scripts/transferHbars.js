// SPDX-License-Identifier: Apache-2.0

const { ethers } = require('hardhat');

module.exports = async (amount = 100_000_000_000) => {
  const wallet = (await ethers.getSigners())[0];
  const walletReceiver = (await ethers.getSigners())[1];

  console.log(`Balance before tx: ${await walletReceiver.provider.getBalance(walletReceiver.address)}`);
  // Keep in mind that TINYBAR to WEIBAR coefficient is 10_000_000_000
  await wallet.sendTransaction({
    to: walletReceiver.address,
    value: amount, // 10 tinybars
  });
  //delay of 3 sec before fetching the new balance, because often it's too fast when querying and the balance is the same like before transfer transaciton
  await new Promise((r) => setTimeout(r, 3000));
  console.log(`Balance after tx: ${await walletReceiver.provider.getBalance(walletReceiver.address)}`);
};
