// SPDX-License-Identifier: Apache-2.0

const hre = require('hardhat');
const { ethers } = hre;
const { Options } = require('@layerzerolabs/lz-v2-utilities');
const { expect } = require('chai');
const CONSTANTS = require('./constants');

const { HEDERA_EID, BSC_EID } = CONSTANTS;
const DATA_FROM_HEDERA = 'dataFromHedera';
const DATA_FROM_BSC = 'dataFromBsc';

describe('OAppTests', function() {
  it('@hedera @send to bsc', async () => {
    const contract = await ethers.getContractAt('ExampleOApp', process.env.OAPP_HEDERA_CONTRACT);
    const tx = await contract.send(
      BSC_EID,
      DATA_FROM_HEDERA,
      Options.newOptions().addExecutorLzReceiveOption(3000000, 0).toHex(),
      { gasLimit: 10_000_000, value: '5000000000000000000' }
    );

    const receipt = await tx.wait();
    if (!receipt.status) {
      process.exit(`Execution failed. Tx hash: ${tx.hash}`);
    }

    console.log(`(${hre.network.name}) successfully sent to BSC via tx: ${tx.hash}`);
  });

  it('@bsc @send to hedera', async () => {
    const contract = await ethers.getContractAt('ExampleOApp', process.env.OAPP_BSC_CONTRACT);
    const tx = await contract.send(
      HEDERA_EID,
      DATA_FROM_BSC,
      Options.newOptions().addExecutorLzReceiveOption(300000, 0).toHex(),
      { gasLimit: 12_000_000, value: '1000000000000000' }
    );

    const receipt = await tx.wait();
    if (!receipt.status) {
      process.exit(`Execution failed. Tx hash: ${tx.hash}`);
    }

    console.log(`(${hre.network.name}) successfully sent to Hedera via tx: ${tx.hash}`);
  });

  it('@hedera @test data()', async () => {
    const contract = await ethers.getContractAt('ExampleOApp', process.env.OAPP_HEDERA_CONTRACT);
    const data = await contract.data();
    console.log(`(${hre.network.name}) data: ${data}`);

    expect(data).to.equal(DATA_FROM_BSC);
  });

  it('@bsc @test data()', async () => {
    const contract = await ethers.getContractAt('ExampleOApp', process.env.OAPP_BSC_CONTRACT);
    const data = await contract.data();
    console.log(`(${hre.network.name}) data: ${data}`);

    expect(data).to.equal(DATA_FROM_HEDERA);
  });
});
