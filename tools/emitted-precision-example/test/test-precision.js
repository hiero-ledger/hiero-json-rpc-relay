// SPDX-License-Identifier: Apache-2.0

const hre = require('hardhat');
const { expect } = require('chai');

describe('ValueReceiver Precision Test (Hedera JSON-RPC)', function () {
  let contractAddress;
  let signers;
  const rawValueSent = 10_000_000_000;

  before(async function () {
    signers = await hre.ethers.getSigners();
    const Receiver = await hre.ethers.getContractFactory('ValueReceiver', signers[0]);
    const receiver = await Receiver.deploy();
    await receiver.waitForDeployment();
    contractAddress = await receiver.getAddress();
    console.log(`Receiver deployed to: ${contractAddress}`);
  });

  it('Should emit event with value, showing precision mismatch if on Hedera', async function () {
    const receiver = await hre.ethers.getContractAt('ValueReceiver', contractAddress, signers[0]);

    const tx = await receiver.testEmittedValues({ value: rawValueSent });
    const receipt = await tx.wait();

    const event = receipt.logs
      .map(log => {
        try {
          return receiver.interface.parseLog(log);
        } catch (_) {
          return null;
        }
      })
      .find(e => e && e.name === 'ValueReceived');

    expect(event).to.exist;

    const emittedValue = event.args.amount.toString();
    const count = event.args.count.toString();

    console.log(`\nSent value (raw):           ${rawValueSent}`);
    console.log(`Emitted msg.value (actual): ${emittedValue}`);
    console.log(`Transaction count:          ${count}`);

    if (emittedValue !== rawValueSent.toString()) {
      console.warn('\n Precision mismatch detected!');
      console.warn('On Hedera, msg.value is auto-adjusted (÷ 10¹⁰)');
    }
    expect(emittedValue).to.not.equal(rawValueSent.toString());
  });
});
