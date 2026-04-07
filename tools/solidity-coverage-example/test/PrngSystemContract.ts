// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { ethers } from 'hardhat';
import { PrngSystemContract } from '../typechain-types';
import { ContractTransactionResponse } from 'ethers';

export const Events = {
  PseudoRandomSeed: 'PseudoRandomSeed',
};

describe('PrngSystemContract tests', function () {
  let prngSystemContract: PrngSystemContract & {
    deploymentTransaction(): ContractTransactionResponse;
  };

  before(async function () {
    const factory = await ethers.getContractFactory('PrngSystemContract');
    prngSystemContract = await factory.deploy();
  });

  it('should be able to execute getPseudorandomSeed to generate a pseudo random seed', async function () {
    const tx = await prngSystemContract.getPseudorandomSeed();
    const txReceipt: any = await tx.wait();

    if (!txReceipt) return;

    const result = txReceipt.events.filter((e: any) => e.event === Events.PseudoRandomSeed)[0].args[0];

    expect(result).to.exist;
    expect(result).to.not.hexEqual('0x0');
  });
});
