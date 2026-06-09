// SPDX-License-Identifier: Apache-2.0

import hre from 'hardhat';
import { expect } from 'chai';

function topicToAddress(topic) {
  return '0x' + topic.slice(-40);
}

describe('Test SimpleVault using the HTS System Contract Mock', function () {
  let signers;
  let deployer;
  let deployerAddress;

  let simpleVault;
  let htsAddress;
  let htsTokenContract;

  const initialTotalSupply = 2 ** 50;
  const htsSystemContractAddress = '0x0000000000000000000000000000000000000167';
  const exchangeRateSystemContractAddress = '0x0000000000000000000000000000000000000168';

  let htsSystemContract;
  let exchangeRateSystemContract;

  before(async function () {
    if (hre.network.name !== 'hardhat') {
      this.skip(); // Skip all tests in this script since only the hardhat local node supports the hardhat_setCode method
    }

    // - - - - - DEPLOY REQUISITE SYSTEM CONTRACT MOCKS - - - - -
    const HtsSystemContractMockFactory = await ethers.getContractFactory('HtsSystemContractMock');
    const HtsSystemContractMock = await HtsSystemContractMockFactory.deploy();
    const htsSystemContractBytecode = await hre.network.provider.send('eth_getCode', [HtsSystemContractMock.target]);
    await hre.network.provider.send('hardhat_setCode', [htsSystemContractAddress, htsSystemContractBytecode]);
    htsSystemContract = await hre.ethers.getContractAt('HtsSystemContractMock', htsSystemContractAddress);

    const ExchangeRatePrecompileMockFactory = await ethers.getContractFactory('ExchangeRatePrecompileMock');
    const ExchangeRatePrecompileMock = await ExchangeRatePrecompileMockFactory.deploy();
    const exchangeRatePrecompileMockBytecode = await hre.network.provider.send('eth_getCode', [
      ExchangeRatePrecompileMock.target,
    ]);
    await hre.network.provider.send('hardhat_setCode', [
      exchangeRateSystemContractAddress,
      exchangeRatePrecompileMockBytecode,
    ]);
    exchangeRateSystemContract = await hre.ethers.getContractAt(
      'ExchangeRatePrecompileMock',
      exchangeRateSystemContractAddress,
    );

    await exchangeRateSystemContract.updateRate(1e7);

    signers = await hre.ethers.getSigners();

    deployer = signers[0];
    deployerAddress = deployer.address;

    const decimals = 8;

    const token = {
      name: 'Token A',
      symbol: 'TKNA',
      treasury: deployerAddress,
      memo: '',
      tokenSupplyType: false,
      maxSupply: initialTotalSupply,
      freezeDefault: false,
      tokenKeys: [],
      expiry: {
        second: 0,
        autoRenewAccount: deployerAddress,
        autoRenewPeriod: 0,
      },
    };

    // - - - - - DEPLOY HTS Token via direct EOA call to HTS System Contract Mock - - - - -

    const createTokenExpectedResult = await htsSystemContract
      .connect(deployer)
      .createFungibleToken.staticCall(token, initialTotalSupply, decimals);
    const factoryAddress = htsSystemContract.target;
    const factoryNonce = await ethers.provider.getTransactionCount(factoryAddress);
    const computedTokenAddress = ethers.getCreateAddress({ from: factoryAddress, nonce: factoryNonce });
    const expectedTokenAddress = createTokenExpectedResult.tokenAddress;

    expect(computedTokenAddress).to.be.eq(expectedTokenAddress);

    const factoryNonceInitial = await ethers.provider.getTransactionCount(htsSystemContractAddress);

    const createTokenTx = await htsSystemContract
      .connect(deployer)
      .createFungibleToken(token, initialTotalSupply, decimals);
    const createTokenRc = await createTokenTx.wait();
    htsAddress = createTokenRc.logs[1].args.token;

    const factoryNonceFinal = await ethers.provider.getTransactionCount(htsSystemContractAddress);
    expect(factoryNonceInitial).to.be.eq(factoryNonceFinal - 1);
    expect(expectedTokenAddress).to.eq(htsAddress);

    htsTokenContract = await hre.ethers.getContractAt('HederaFungibleToken', htsAddress);

    const totalSupply = await htsTokenContract.totalSupply();
    const deployerBalance = await htsTokenContract.balanceOf(deployerAddress);

    expect(totalSupply).to.be.eq(initialTotalSupply);
    expect(deployerBalance).to.be.eq(initialTotalSupply);

    const SimpleVaultFactory = await ethers.getContractFactory('SimpleVault');
    simpleVault = await SimpleVaultFactory.deploy();
    await simpleVault.deploymentTransaction().wait();

    await simpleVault.associate(htsTokenContract.target);

    const isAssociatedWithHtsToken = await simpleVault.isAssociated(htsTokenContract.target);
    expect(isAssociatedWithHtsToken).to.be.true;
  });

  it('should be able to deploy HTS token via proxy', async function () {
    // - - - - - DEPLOY HTS Token via Proxy - - - - -
    const ProxyToHtsMock = await ethers.getContractFactory('ProxyToHtsMock');
    const proxyToHtsMock = await ProxyToHtsMock.deploy();
    await proxyToHtsMock.deploymentTransaction().wait();

    const createTokenViaProxyTx = await proxyToHtsMock.createTokenForSender();
    const createTokenViaProxyRc = await createTokenViaProxyTx.wait();

    const htsTokenAddress = topicToAddress(createTokenViaProxyRc.logs[1].topics[1]);
    const htsTokenByProxy = await hre.ethers.getContractAt('HederaFungibleToken', htsTokenAddress);

    const balanceOfProxy = await htsTokenByProxy.balanceOf(proxyToHtsMock.target);
    const totalSupply = await htsTokenByProxy.totalSupply();

    expect(totalSupply).to.be.eq(balanceOfProxy);

    await htsSystemContract.connect(deployer).associateToken(deployerAddress, htsTokenByProxy.target);
    await proxyToHtsMock.connect(deployer).sweepToSender(htsTokenByProxy.target);

    const balanceOfProxyFinal = await htsTokenByProxy.balanceOf(proxyToHtsMock.target);
    const balanceOfDeployerFinal = await htsTokenByProxy.balanceOf(deployerAddress);

    expect(0).to.be.eq(balanceOfProxyFinal);
    expect(totalSupply).to.be.eq(balanceOfDeployerFinal);
  });

  it('should be able to deposit and withdraw to and from the vault', async function () {
    const depositAmount = 100n;

    const vaultInitialBalance = await htsTokenContract.balanceOf(simpleVault.target);
    const deployerInitialBalance = await htsTokenContract.balanceOf(deployerAddress);

    const valueForDeposit = await simpleVault.getCentsInTinybar.staticCall(2);

    await htsTokenContract.connect(deployer).approve(simpleVault.target, depositAmount);

    await simpleVault.connect(deployer).deposit(htsAddress, depositAmount, {
      value: valueForDeposit,
    });

    const vaultBalanceAfterDeposit = await htsTokenContract.balanceOf(simpleVault.target);
    const deployerBalanceAfterDeposit = await htsTokenContract.balanceOf(deployerAddress);

    expect(vaultBalanceAfterDeposit).to.be.eq(vaultInitialBalance + depositAmount);
    expect(deployerBalanceAfterDeposit).to.be.eq(deployerInitialBalance - depositAmount);

    const withdrawAmount = 50n;

    const valueForWithdraw = await simpleVault.getCentsInTinybar.staticCall(1);

    await simpleVault.connect(deployer).withdraw(htsAddress, withdrawAmount, {
      value: valueForWithdraw,
    });

    const vaultBalanceAfterWithdraw = await htsTokenContract.balanceOf(simpleVault.target);
    const deployerBalanceAfterWithdraw = await htsTokenContract.balanceOf(deployerAddress);

    expect(vaultBalanceAfterWithdraw).to.be.eq(vaultBalanceAfterDeposit - withdrawAmount);
    expect(deployerBalanceAfterWithdraw).to.be.eq(deployerBalanceAfterDeposit + withdrawAmount);
  });
});
