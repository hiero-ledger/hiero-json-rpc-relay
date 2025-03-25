// SPDX-License-Identifier: Apache-2.0

const { expect } = require('chai');
const hre = require('hardhat');
const { Hbar, Client, TransferTransaction, PrivateKey } = require('@hashgraph/sdk');
const { ethers } = hre;

const ONE_HBAR = 1n * 100_000_000n;
const WEIBAR_COEF = 10_000_000_000n;
const ONE_HBAR_AS_WEIBAR = ONE_HBAR * WEIBAR_COEF;

describe('WHBAR', function() {
  let signers;
  let contract;

  before(async function() {
    signers = await ethers.getSigners();
  });

  it('should deploy the WHBAR contract', async function() {
    if (process.env.DEPLOY_CONTRACT === 'false') {
      contract = await ethers.getContractAt('WHBAR', process.env.WHBAR_CONTRACT_ADDRESS);
    } else {
      contract = await (await ethers.getContractFactory('WHBAR')).deploy();
    }
    console.log(`WHBAR address: ${contract.target}`);

    await contract.waitForDeployment();
    expect(contract).to.not.be.undefined;
  });

  it('should get name', async function() {
    expect(await contract.name()).to.equal('Wrapped HBAR');
  });

  it('should get symbol', async function() {
    expect(await contract.symbol()).to.equal('WHBAR');
  });

  it('should get decimals', async function() {
    expect(await contract.decimals()).to.equal(8);
  });

  it('should not update total supply after CryptoTransfer tx', async function() {
    // initial values for contract's total supply and balance
    const totalSupplyBefore = await contract.totalSupply();
    const balanceBefore = await signers[0].provider.getBalance(contract.target);

    // build a client for fetching signer's id and contract's id dynamically
    const client = Client.forNetwork(hre.network.name.replace('hedera_', ''));
    const mirrorNodeUrl = client._mirrorNetwork._network.keys().next().value;
    const signerId = (await (await fetch(`https://${mirrorNodeUrl}/api/v1/accounts/${signers[0].address}`)).json()).account;
    const contractId = (await (await fetch(`https://${mirrorNodeUrl}/api/v1/accounts/${contract.target}`)).json()).account;
    client.setOperator(signerId, PrivateKey.fromStringECDSA(hre.config.networks[hre.network.name].accounts[0]));

    // send 1 hbar to the contract via CryptoTransfer
    const tx = new TransferTransaction()
      .addHbarTransfer(signerId, Hbar.fromTinybars(Number(ONE_HBAR)).negated())
      .addHbarTransfer(contractId, Hbar.fromTinybars(Number(ONE_HBAR)));
    const txResponse = await tx.execute(client);
    const receipt = await txResponse.getReceipt(client);
    if (receipt.status._code !== 22) {
      throw new Error(`Funding tx with id ${txResponse.transactionId.toString()} failed.`);
    }

    // wait for the mirror node data population
    await new Promise(r => setTimeout(r, 3000));

    // get updated contract's total supply and balance
    const totalSupplyAfter = await contract.totalSupply();
    const balanceAfter = await signers[0].provider.getBalance(contract.target);

    // checks
    expect(totalSupplyBefore).to.equal(totalSupplyAfter);
    expect(balanceBefore + ONE_HBAR_AS_WEIBAR).to.equal(balanceAfter);
  });

  it('should deposit 1 hbar and check totalSupply', async function() {

    const hbarBalanceBefore = await ethers.provider.getBalance(signers[0].address);
    const whbarBalanceBefore = await contract.balanceOf(signers[0].address);
    const totalSupplyBefore = await contract.totalSupply();

    const txDeposit = await contract.deposit({
      value: ONE_HBAR_AS_WEIBAR
    });
    await txDeposit.wait();

    const hbarBalanceAfter = await ethers.provider.getBalance(signers[0].address);
    const whbarBalanceAfter = await contract.balanceOf(signers[0].address);
    const totalSupplyAfter = await contract.totalSupply();

    expect(hbarBalanceBefore - hbarBalanceAfter).to.be.greaterThanOrEqual(ONE_HBAR_AS_WEIBAR);
    expect(whbarBalanceAfter - whbarBalanceBefore).to.equal(ONE_HBAR);
    expect(totalSupplyBefore + ONE_HBAR).to.equal(totalSupplyAfter);
  });

  it('should withdraw 1 hbar and check totalSupply', async function() {
    const txDeposit = await contract.deposit({
      value: ONE_HBAR_AS_WEIBAR
    });
    await txDeposit.wait();

    const hbarBalanceBefore = await ethers.provider.getBalance(signers[0].address);
    const whbarBalanceBefore = await contract.balanceOf(signers[0].address);
    const totalSupplyBefore = await contract.totalSupply();

    const txWithdraw = await contract.withdraw(ONE_HBAR);
    await txWithdraw.wait();

    const hbarBalanceAfter = await ethers.provider.getBalance(signers[0].address);
    const whbarBalanceAfter = await contract.balanceOf(signers[0].address);
    const totalSupplyAfter = await contract.totalSupply();

    expect(hbarBalanceBefore - hbarBalanceAfter).to.be.lessThanOrEqual(ONE_HBAR_AS_WEIBAR);
    expect(whbarBalanceBefore - ONE_HBAR).to.equal(whbarBalanceAfter);
    expect(totalSupplyBefore - ONE_HBAR).to.equal(totalSupplyAfter);
  });

  it('should be able to transfer', async function() {
    const receiver = (ethers.Wallet.createRandom()).address;
    const receiverBalanceBefore = await contract.balanceOf(receiver);

    const txDeposit = await contract.deposit({
      value: ONE_HBAR_AS_WEIBAR
    });
    await txDeposit.wait();

    const txTransfer = await contract.transfer(receiver, ONE_HBAR);
    await txTransfer.wait();

    const receiverBalanceAfter = await contract.balanceOf(receiver);
    expect(receiverBalanceBefore).to.equal(0);
    expect(receiverBalanceAfter).to.equal(ONE_HBAR);
  });

  it('should be able to transferFrom', async function() {
    const amount = 1;

    // create a random receiver
    const receiverAddress = (ethers.Wallet.createRandom()).address;

    // create a new random signer
    const newSigner = ethers.Wallet.createRandom().connect(signers[0].provider);

    // add some balance for gas covering
    await (await signers[0].sendTransaction({
      to: newSigner.address,
      value: ONE_HBAR_AS_WEIBAR
    })).wait();

    // deposit 1 hbar with signer[0]
    await (await contract.deposit({
      value: ONE_HBAR_AS_WEIBAR
    })).wait();

    // approve the newSigner from signer[0]
    await (await contract.approve(newSigner.address, amount)).wait();

    // save the balances before
    const allowanceBefore = await contract.allowance(signers[0].address, newSigner.address);
    const receiverBalanceBefore = await contract.balanceOf(receiverAddress);

    // execute transferFrom with newSigner using signers[0] approval
    const contractWithNewSigner = await contract.connect(newSigner);
    await (await contractWithNewSigner.transferFrom(signers[0].address, receiverAddress, amount)).wait();

    // save the balances after
    const allowanceAfter = await contract.allowance(signers[0].address, newSigner.address);
    const receiverBalanceAfter = await contract.balanceOf(receiverAddress);

    expect(allowanceBefore).to.equal(amount);
    expect(allowanceAfter).to.equal(0);
    expect(receiverBalanceBefore).to.equal(0);
    expect(receiverBalanceAfter).to.equal(amount);
  });

  it('should be able to approve', async function() {
    const receiverAddress = (ethers.Wallet.createRandom()).address;
    const amount = 5644;

    const txApprove = await contract.approve(receiverAddress, amount);
    await txApprove.wait();

    expect(await contract.allowance(signers[0].address, receiverAddress)).to.equal(amount);
  });

  it('should be able to deposit via contract`s fallback method', async function () {
    const whbarSigner0Before = await contract.balanceOf(signers[0].address);

    const txFallback = await signers[0].sendTransaction({
      to: contract.target,
      data: '0x5644aa', // non-existing contract's function, will call fallback()
      value: ONE_HBAR_AS_WEIBAR
    });
    await txFallback.wait();

    const whbarSigner0After = await contract.balanceOf(signers[0].address);
    expect(whbarSigner0After - whbarSigner0Before).to.equal(ONE_HBAR);
  });

  it('should be able to deposit via contract`s receive method', async function () {
    const whbarSigner0Before = await contract.balanceOf(signers[0].address);

    const txReceive = await signers[0].sendTransaction({
      to: contract.target,
      value: ONE_HBAR_AS_WEIBAR // missing data but passing value, will call receive()
    });
    await txReceive.wait();

    const whbarSigner0After = await contract.balanceOf(signers[0].address);
    expect(whbarSigner0After - whbarSigner0Before).to.equal(ONE_HBAR);
  });

  it('should throw InsufficientFunds error on withdraw', async function() {
    await expect(contract.withdraw(BigInt(100) * ONE_HBAR))
      .to.be.revertedWithCustomError(contract, `InsufficientFunds`);
  });

  it('should throw InsufficientAllowance error on withdraw', async function () {
    const amount = 1;
    const receiverAddress = (ethers.Wallet.createRandom()).address;
    const newSigner = ethers.Wallet.createRandom().connect(signers[0].provider);

    // add some balance for gas covering
    await (await signers[0].sendTransaction({
      to: newSigner.address,
      value: ONE_HBAR_AS_WEIBAR
    })).wait();

    // deposit 1 hbar with signer[0]
    await (await contract.deposit({
      value: ONE_HBAR_AS_WEIBAR
    })).wait();

    const contractWithNewSigner = await contract.connect(newSigner);
    await expect(contractWithNewSigner.transferFrom(signers[0].address, receiverAddress, amount))
      .to.be.revertedWithCustomError(contractWithNewSigner, `InsufficientAllowance`);
  });

  it('should throw SendFailed error on withdrawal from a contract with no receive/fallback method', async() => {
    // Target contract defined in https://github.com/hashgraph/hedera-smart-contracts/blob/main/contracts/solidity/new/New.sol#L4
    const contractWithoutReceiveFactory = await ethers.getContractFactory([
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "internalType": "bool",
            "name": "",
            "type": "bool"
          },
          {
            "indexed": false,
            "internalType": "bytes",
            "name": "",
            "type": "bytes"
          }
        ],
        "name": "WithdrawResponse",
        "type": "event"
      },
      {
        "inputs": [],
        "name": "message",
        "outputs": [
          {
            "internalType": "string",
            "name": "",
            "type": "string"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "string",
            "name": "_message",
            "type": "string"
          }
        ],
        "name": "setMessage",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "wad",
            "type": "uint256"
          }
        ],
        "name": "tryToWithdraw",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      }
    ], '0x608060405234801561000f575f80fd5b506104f58061001d5f395ff3fe608060405234801561000f575f80fd5b506004361061003f575f3560e01c8063368b8772146100435780635873a9cc14610058578063e21f37ce1461006b575b5f80fd5b61005661005136600461021d565b610089565b005b610056610066366004610289565b61009a565b610073610192565b6040516100809190610318565b60405180910390f35b5f6100958284836103c8565b505050565b5f808373ffffffffffffffffffffffffffffffffffffffff16836040516024016100c691815260200190565b60408051601f198184030181529181526020820180517bffffffffffffffffffffffffffffffffffffffffffffffffffffffff16632e1a7d4d60e01b179052516101109190610482565b5f604051808303815f865af19150503d805f8114610149576040519150601f19603f3d011682016040523d82523d5f602084013e61014e565b606091505b50915091507f9c38734f816a025562981e989e63e60602b2c5578a846d9ed63b5a027772cd59828260405161018492919061049d565b60405180910390a150505050565b5f805461019e90610345565b80601f01602080910402602001604051908101604052809291908181526020018280546101ca90610345565b80156102155780601f106101ec57610100808354040283529160200191610215565b820191905f5260205f20905b8154815290600101906020018083116101f857829003601f168201915b505050505081565b5f806020838503121561022e575f80fd5b823567ffffffffffffffff80821115610245575f80fd5b818501915085601f830112610258575f80fd5b813581811115610266575f80fd5b866020828501011115610277575f80fd5b60209290920196919550909350505050565b5f806040838503121561029a575f80fd5b823573ffffffffffffffffffffffffffffffffffffffff811681146102bd575f80fd5b946020939093013593505050565b5f5b838110156102e55781810151838201526020016102cd565b50505f910152565b5f81518084526103048160208601602086016102cb565b601f01601f19169290920160200192915050565b602081525f61032a60208301846102ed565b9392505050565b634e487b7160e01b5f52604160045260245ffd5b600181811c9082168061035957607f821691505b60208210810361037757634e487b7160e01b5f52602260045260245ffd5b50919050565b601f82111561009557805f5260205f20601f840160051c810160208510156103a25750805b601f840160051c820191505b818110156103c1575f81556001016103ae565b5050505050565b67ffffffffffffffff8311156103e0576103e0610331565b6103f4836103ee8354610345565b8361037d565b5f601f841160018114610425575f851561040e5750838201355b5f19600387901b1c1916600186901b1783556103c1565b5f83815260208120601f198716915b828110156104545786850135825560209485019460019092019101610434565b5086821015610470575f1960f88860031b161c19848701351681555b505060018560011b0183555050505050565b5f82516104938184602087016102cb565b9190910192915050565b8215158152604060208201525f6104b760408301846102ed565b94935050505056fea2646970667358221220c24cea34a9aa87d986045e30582897cbc86e9e547a2912cf62930c0d12f3d7fe64736f6c63430008180033');
    const contractWithoutReceive = await contractWithoutReceiveFactory.deploy();
    await contractWithoutReceive.waitForDeployment();

    const receiver = contractWithoutReceive.target;
    const receiverBalanceBefore = await contract.balanceOf(receiver);

    const txDeposit = await contract.deposit({
      value: ONE_HBAR_AS_WEIBAR
    });
    await txDeposit.wait();

    const txTransfer = await contract.transfer(contractWithoutReceive, ONE_HBAR);
    await txTransfer.wait();

    const receiverBalanceAfter = await contract.balanceOf(receiver);
    expect(receiverBalanceBefore).to.equal(0);
    expect(receiverBalanceAfter).to.equal(ONE_HBAR);

    const tryToWithdrawTx = await contractWithoutReceive.tryToWithdraw(contract.target, ONE_HBAR);
    const tryToWithdrawReceipt = await tryToWithdrawTx.wait();

    expect(tryToWithdrawReceipt.logs).to.not.be.empty;
    expect(tryToWithdrawReceipt.logs[0].fragment.name).to.equal('WithdrawResponse');
    // revert with SendFailed()
    expect(tryToWithdrawReceipt.logs[0].args[0]).to.be.false;
    // first 4 bytes of the SendError selector - keccak256("SendFailed()") = 0x81063e51806c3994c498b39c9d9f4124c2e61b7cd154bc84f959aea44d44ce4f
    expect(tryToWithdrawReceipt.logs[0].args[1]).to.equal('0x81063e51');
  });

  it('should not be able to transfer WHBAR to the actual WHBAR contract', async () => {
    const txDeposit = await contract.deposit({
      value: ONE_HBAR_AS_WEIBAR
    });
    await txDeposit.wait();

    await expect(contract.transfer(contract.target, ONE_HBAR))
      .to.be.revertedWithCustomError(contract, `SendFailed`);
  });

  it('should not be able to transferFrom WHBAR to the actual WHBAR contract', async () => {
    const amount = 1;

    // create a new random signer
    const newSigner = ethers.Wallet.createRandom().connect(signers[0].provider);

    // add some balance for gas covering
    await (await signers[0].sendTransaction({
      to: newSigner.address,
      value: ONE_HBAR_AS_WEIBAR
    })).wait();

    // deposit 1 hbar with signer[0]
    await (await contract.deposit({
      value: ONE_HBAR_AS_WEIBAR
    })).wait();

    // approve the newSigner from signer[0]
    await (await contract.approve(newSigner.address, amount)).wait();

    // execute transferFrom with newSigner using signers[0] approval
    const contractWithNewSigner = await contract.connect(newSigner);
    await expect(contractWithNewSigner.transferFrom(signers[0].address, contractWithNewSigner.target, amount))
      .to.be.revertedWithCustomError(contractWithNewSigner, `SendFailed`);
  });
});
