// SPDX-License-Identifier: Apache-2.0

const hre = require('hardhat');
const { expect } = require('chai');
const { ethers } = require('hardhat');

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

  it('should allow HBAR transfer with Hardhat signer, but reject it with a plain ethers Wallet when not providing gasPrice directly', async function () {
    const tx = { to: signers[1].address, value: 100_000_000_000 };
    const submitTransactionUsingWallet = async (wallet) => await (
      await wallet.sendTransaction(tx)
    ).wait();

    // HBAR transfer works with Hardhat's ethers signer (HardhatEthersSigner),
    // because Hardhat populates fee fields using its gas estimation logic,
    // including fee history handling when preparing the transaction.
    // Reference:
    // https://github.com/NomicFoundation/hardhat/blob/9bfaca98ffde2800abe995f5460e69a79257d4d3/v-next/hardhat/src/internal/builtin-plugins/network-manager/request-handlers/handlers/gas/automatic-gas-price-handler.ts#L189
    const hardhatWallet = (await ethers.getSigners())[0];
    await expect(submitTransactionUsingWallet(hardhatWallet))
      .to.eventually
      .have.property('status').equal(1);

    // The same transfer fails with a plain ethers.Wallet connected to the provider.
    // In this case, ethers relies on provider.getFeeData() when populating the transaction:
    // https://github.com/ethers-io/ethers.js/blob/main/src.ts/providers/abstract-signer.ts#L96
    //
    // Some providers (with Hardhat's provider as an example) returns fee data where gas-related values are present,
    // but the effective per-transaction base fee in our case is 0, because rewards are not checked:
    // https://github.com/NomicFoundation/hardhat/blob/9bfaca98ffde2800abe995f5460e69a79257d4d3/v-next/hardhat-ethers/src/internal/hardhat-ethers-provider/hardhat-ethers-provider.ts#L184
    //
    // As a result, the transaction is submitted with gas price 0, which is rejected
    // because it is below Hedera's configured minimum gas price.
    const ethersWallet = await new ethers.Wallet(process.env.OPERATOR_PRIVATE_KEY, ethers.provider);
    await expect(submitTransactionUsingWallet(ethersWallet))
      .to.eventually
      .be.rejectedWith('Gas price \'0\' is below configured minimum gas price \'710000000000\'');
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
