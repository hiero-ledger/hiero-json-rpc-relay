// SPDX-License-Identifier: Apache-2.0

const hre = require('hardhat');
const { expect } = require('chai');

describe('RPC', function () {
  let contractAddress;
  let signers;

  before(async function () {
    signers = await hre.ethers.getSigners();
  });

  it('should be able to get the account balance', async function () {
    const balance = await hre.run('show-balance');
    expect(Number(balance)).to.be.greaterThan(0);
  });

  it('should be able to transfer hbars between two accounts', async function () {
    let walletReceiver = signers[0];
    const hbarsBefore = (await walletReceiver.provider.getBalance(walletReceiver.address)).toString();
    await hre.run('transfer-hbars');
    // add additional transfer to ensure file close on local node
    await hre.run('transfer-hbars');
    const hbarsAfter = (await walletReceiver.provider.getBalance(walletReceiver.address)).toString();
    expect(hbarsBefore).to.not.be.equal(hbarsAfter);
  });

  it('should be able to deploy a contract', async function () {
    contractAddress = await hre.run('deploy-contract');
    expect(contractAddress).to.not.be.null;
  });

  it('should be able to make a contract view call', async function () {
    const res = await hre.run('contract-view-call', { contractAddress });
    expect(res).to.be.equal('initial_msg');
  });

  it('should NOT throw exception upon empty hex response (0x)', async function () {
    const provider = new hre.ethers.getDefaultProvider(process.env.RELAY_ENDPOINT);
    const result = await provider.call({
      to: '0x00000000000000000000000000000000002e7a5d', // random non-existed address
      data: '0x',
    });
    expect(result).to.be.equal('0x'); // successfully process empty hex response and throw no exception
  });

  it('should be able to make a contract call', async function () {
    const msg = 'updated_msg';
    await hre.run('contract-call', { contractAddress, msg });
    // 5 seconds sleep to propagate the changes to mirror node
    await new Promise((r) => setTimeout(r, 5000));
    const res = await hre.run('contract-view-call', { contractAddress });
    expect(res).to.be.equal(msg);
  });
});
