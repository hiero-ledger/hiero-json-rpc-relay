// SPDX-License-Identifier: Apache-2.0

const { expect } = require('chai');
const { Web3 } = require('web3');
require('dotenv').config();

describe('RPC', function () {
  this.timeout(5 * 60000); // 5 minutes

  let contractAddress;
  const initialMsg = 'initial_msg';
  const updatedMsg = 'updated_msg';

  it('should be able to get the account balance', async function () {
    const showBalance = require('../scripts/showBalance');

    const balance = await showBalance();
    expect(Number(balance)).to.be.greaterThan(0);
  });
  it('should be able to transfer hbars between two accounts', async function () {
    const transferHbars = require('../scripts/transferHbars');

    const web3 = new Web3(new Web3.providers.HttpProvider(process.env.RELAY_ENDPOINT));

    const walletReceiver = await web3.eth.accounts.wallet.add(process.env.RECEIVER_PRIVATE_KEY);

    const hbarsBefore = (await web3.eth.getBalance(walletReceiver[0].address)).toString();
    await transferHbars();
    const hbarsAfter = (await web3.eth.getBalance(walletReceiver[0].address)).toString();

    expect(hbarsBefore).to.not.be.equal(hbarsAfter);
  });
  it('should be able to deploy a contract', async function () {
    const deployContract = require('../scripts/deployContract');

    contractAddress = await deployContract(initialMsg);
    expect(contractAddress).to.not.be.null;
  });
  it('should be able to make a contract view call', async function () {
    const contractViewCall = require('../scripts/contractViewCall');

    const res = await contractViewCall(contractAddress);
    expect(res).to.be.equal(initialMsg);
  });
  it('should be able to make a contract call', async function () {
    const contractViewCall = require('../scripts/contractViewCall');
    const contractCall = require('../scripts/contractCall');

    await contractCall(contractAddress, updatedMsg);
    // 5 seconds sleep to propagate the changes to mirror node
    await new Promise((r) => setTimeout(r, 5000));
    const res = await contractViewCall(contractAddress);

    expect(res).to.be.equal(updatedMsg);
  });

  it('should NOT throw exception upon empty hex response (0x)', async function () {
    const web3 = new Web3(new Web3.providers.HttpProvider(process.env.RELAY_ENDPOINT));
    const result = await web3.eth.call({
      to: '0x00000000000000000000000000000000002e7a5d', // random non-existed address
      data: '0x',
    });
    expect(result).to.be.equal('0x'); // successfully process empty hex response and throw no exception
  });
});
