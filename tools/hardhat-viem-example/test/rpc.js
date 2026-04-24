// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import hre from 'hardhat';

describe('RPC', function () {
  let contractAddress;

  it('should be able to get the account balance', async function () {
    const balance = await hre.tasks.getTask('show-balance').run();
    expect(Number(balance)).to.be.greaterThan(0);
  });

  it('should be able to deploy a contract', async function () {
    contractAddress = await hre.tasks.getTask('deploy-contract').run();
    expect(contractAddress).to.not.be.null;
  });

  it('should be able to make a contract view call', async function () {
    const res = await hre.tasks.getTask('contract-view-call').run({ contractAddress });
    expect(res).to.be.equal('initial_msg');
  });

  it('should be able to make a contract call', async function () {
    const msg = 'updated_msg';
    await hre.tasks.getTask('contract-call').run({ contractAddress, msg });
    const res = await hre.tasks.getTask('contract-view-call').run({ contractAddress });
    expect(res).to.be.equal(msg);
  });
});
