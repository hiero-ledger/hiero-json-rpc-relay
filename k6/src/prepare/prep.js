// SPDX-License-Identifier: Apache-2.0

import Greeter from './contracts/Greeter.json' with { type: 'json' };
import { ethers, formatEther, parseEther } from 'ethers';
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import * as HederaSDK from '@hashgraph/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logPayloads = process.env.DEBUG_MODE === 'true';
const syntheticTxPerBlock = parseInt(process.env.SYNTHETIC_TXS_PER_BLOCK) > 0 ? parseInt(process.env.SYNTHETIC_TXS_PER_BLOCK): 800;

class LoggingProvider extends ethers.JsonRpcProvider {
  async send(method, params) {
    if (logPayloads) {
      const request = {
        method: method,
        params: params,
        id: this._nextId++,
        jsonrpc: '2.0',
      };

      console.log('>>>', method, '-->', JSON.stringify(request));
    }

    return super.send(method, params).then((result) => {
      if (logPayloads) {
        console.log('<<<', method, '-->', result);
      }
      return result;
    });
  }
}

function randomIntFromInterval(min, max) {
  // min and max included
  return Math.floor(Math.random() * (max - min + 1) + min);
}

async function getSignedTxs(wallet, greeterContracts, gasPrice, gasLimit, chainId) {
  const amount = process.env.SIGNED_TXS ? process.env.SIGNED_TXS : 5;
  console.log(`Generating (${amount}) Txs for Performance Test...`);
  let nonce = 0; // since all wallets are new and have no transactions, no need to get nonce from the network
  const signedTxCollection = [];
  for (let i = 0; i < amount; i++) {
    const greeterContractAddress = randomIntFromInterval(0, greeterContracts.length - 1);
    const greeterContract = new ethers.Contract(greeterContracts[greeterContractAddress], Greeter.abi, wallet);
    const msg = `Greetings from Automated Test Number ${i}, Hello!`;
    const trx = await greeterContract['setGreeting'].populateTransaction(msg);
    trx.gasLimit = gasLimit;
    trx.chainId = chainId;
    trx.gasPrice = gasPrice;
    trx.nonce = nonce + i;
    const signedTx = await wallet.signTransaction(trx);
    signedTxCollection.push(signedTx);
    console.log('Transaction ' + i + ' signed.');
  }

  return signedTxCollection;
}

async function getBlockNumberAndHashWithManySyntheticTxs(chainId, mainWallet, mainPrivateKeyString, wallets) {

  // define constants
  const CHAIN_ID_TO_NETWORK = {
    297n: 'Previewnet',
    296n: 'Testnet',
    295n: 'Mainnet'
  };
  const network = CHAIN_ID_TO_NETWORK[chainId] ?? 'LocalNode';
  const mirrorNodeBaseUrl = network !== 'LocalNode'
    ? `https://${network.toLowerCase()}.mirrornode.hedera.com/api/v1`
    : 'http://localhost:5551/api/v1';

  // define helpers
  async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function fetchAccountInfo(mirrorNodeBaseUrl, address) {
    return (await fetch(`${mirrorNodeBaseUrl}/accounts/${address}`)).json();
  }

  function createClient(network, accountId, privateKey) {
    return HederaSDK.Client[`for${network}`]().setOperator(
        HederaSDK.AccountId.fromString(accountId),
        privateKey
      );
  }

  async function updateMaxAutomaticTokenAssociations(network, signerPk, accountId) {
    const signer = HederaSDK.PrivateKey.fromStringECDSA(signerPk);
    const signerClient = createClient(network, accountId, signerPk);
    const accountUpdateTx = await new HederaSDK.AccountUpdateTransaction()
      .setAccountId(accountId)
      .setMaxAutomaticTokenAssociations(1_000);
    await (await accountUpdateTx.freezeWith(signerClient).sign(signer)).execute(signerClient);
  }

  async function createFungibleToken(mainAccountInfo, mainAccountPk, mainAccountClient) {
    let tokenCreateTx = new HederaSDK.TokenCreateTransaction()
      .setTokenName('TestToken')
      .setTokenSymbol('TT')
      .setTokenType(HederaSDK.TokenType.FungibleCommon)
      .setDecimals(2)
      .setInitialSupply(1_000_000_000)
      .setTreasuryAccountId(mainAccountInfo.account)
      .setSupplyType(HederaSDK.TokenSupplyType.Infinite)
      .setSupplyKey(mainAccountPk.publicKey)
      .freezeWith(mainAccountClient);
    const tokenCreateSign = await tokenCreateTx.sign(mainAccountPk);
    const tokenCreateSubmit = await tokenCreateSign.execute(mainAccountClient);

    return (await tokenCreateSubmit.getReceipt(mainAccountClient)).tokenId;
  }

  // wait before executing MN calls
  await sleep(5_000);

  // fetch main account info from the MN
  const mainAccountInfo = await fetchAccountInfo(mirrorNodeBaseUrl, mainWallet.address);
  const mainAccountPk = HederaSDK.PrivateKey.fromStringECDSA(mainPrivateKeyString);
  const mainAccountClient = createClient(network, mainAccountInfo.account, mainAccountPk);

  // create fungible token and wait for its population in the MN
  const tokenId = await createFungibleToken(mainAccountInfo, mainAccountPk, mainAccountClient);
  await sleep(5_000);

  // fetch signer info from the MN
  const signerInfo = await fetchAccountInfo(mirrorNodeBaseUrl, wallets[0].address);
  const signerPk = wallets[0].privateKey;
  await updateMaxAutomaticTokenAssociations(network, signerPk, signerInfo.account);

  // create an array of HTS transfer promises and execute them
  let tokenTransferPromises = [];
  for (let i = 0; i < syntheticTxPerBlock; i++) {
    const tokenTransferTransaction = new HederaSDK.TransferTransaction()
      .addTokenTransfer(tokenId, HederaSDK.AccountId.fromString(signerInfo.account), 1)
      .addTokenTransfer(tokenId, HederaSDK.AccountId.fromString(mainAccountInfo.account), -1);
    tokenTransferPromises.push((await tokenTransferTransaction.freezeWith(mainAccountClient).sign(mainAccountPk)).execute(mainAccountClient));
  }
  const txIds = await Promise.all(tokenTransferPromises);

  // wait for MN population
  await sleep(10_000);

  // get the log info from MN
  const txHash = Buffer.from(txIds[0].transactionHash).toString('hex');
  const logInfo = await (await fetch(
    `${mirrorNodeBaseUrl}/contracts/results/logs?transaction.hash=${txHash}`
  )).json();

  console.log(`Executed ${tokenTransferPromises.length} HTS transfers in block ${logInfo.logs[0].block_number}.`);

  return {
    blockNumber: logInfo.logs[0].block_number,
    blockHash: logInfo.logs[0].block_hash.slice(0, 66),
  };
}

(async () => {
  const provider = new LoggingProvider(process.env.RELAY_BASE_URL);
  const mainPrivateKeyString = process.env.PRIVATE_KEY;
  const mainWallet = new ethers.Wallet(mainPrivateKeyString, provider);
  console.log('RPC Server:  ' + process.env.RELAY_BASE_URL);
  console.log('Main Wallet Address: ' + mainWallet.address);
  console.log('Main Wallet Initial Balance: ' + formatEther(await provider.getBalance(mainWallet.address)) + ' HBAR');
  const usersCount = process.env.WALLETS_AMOUNT ? process.env.WALLETS_AMOUNT : 1;
  const contractsCount = process.env.SMART_CONTRACTS_AMOUNT ? process.env.SMART_CONTRACTS_AMOUNT : 1;
  const smartContracts = [];
  for (let i = 0; i < contractsCount; i++) {
    const contractFactory = new ethers.ContractFactory(Greeter.abi, Greeter.bytecode, mainWallet);
    console.log(`Deploying Greeter SC  ${i}`);
    const contract = await contractFactory.deploy('Hey World!');
    await contract.waitForDeployment();
    const contractAddress = contract.target;
    console.log(`Greeter SC Address: ${contractAddress}`);
    smartContracts.push(contractAddress);
  }

  const wallets = [];

  const chainId = (await provider.getNetwork()).chainId;
  const msgForEstimate = `Greetings from Automated Test Number i, Hello!`;
  const contractForEstimate = new ethers.Contract(smartContracts[0], Greeter.abi, mainWallet);
  const gasLimit = await contractForEstimate['setGreeting'].estimateGas(msgForEstimate);
  const gasPrice = (await provider.getFeeData()).gasPrice;

  for (let i = 0; i < usersCount; i++) {
    const wallet = ethers.Wallet.createRandom();

    console.log('Wallet ' + i + ' created.');
    console.log('privateKey: ', wallet.privateKey);
    console.log('address: ', wallet.address);

    // amount to send (HBAR)
    let amountInEther = process.env.WALLET_BALANCE || '10';
    // Create transaction
    let tx = {
      to: wallet.address,
      // Convert currency unit from ether to wei
      value: parseEther(amountInEther),
    };

    // Send transaction
    await mainWallet.sendTransaction(tx).then((txObj) => {
      console.log('txHash', txObj.hash);
    });

    const balance = await provider.getBalance(wallet.address);
    console.log('balance: ', formatEther(balance));

    const walletProvider = new ethers.Wallet(wallet.privateKey, new LoggingProvider(process.env.RELAY_BASE_URL));
    const signedTxCollection = await getSignedTxs(walletProvider, smartContracts, gasPrice, gasLimit, chainId);

    let walletData = {};
    walletData['index'] = i;
    walletData['address'] = wallet.address;
    walletData['privateKey'] = wallet.privateKey;
    walletData['latestBalance'] = formatEther(balance);
    walletData['latestNonce'] = await walletProvider.getNonce();
    walletData['signedTxs'] = signedTxCollection;
    wallets.push(walletData);
  }
  const latestBlock = await provider.getBlockNumber();
  console.log('Latest Block: ' + latestBlock);

  // Create filters for testing filter endpoints
  console.log('Creating filters for testing...');
  const filters = {};

  // Create a block filter
  const blockFilterResponse = await provider.send('eth_newBlockFilter', []);
  filters.blockFilterId = blockFilterResponse;
  console.log('Block filter created:', blockFilterResponse);

  // Create a log filter
  const logFilterResponse = await provider.send('eth_newFilter', [
    {
      fromBlock: 'latest',
      toBlock: 'latest',
      address: smartContracts[0], // Use first contract address
    },
  ]);
  filters.logFilterId = logFilterResponse;
  console.log('Log filter created:', logFilterResponse);

  const blockNumberAndHashWithManySyntheticTxs = await getBlockNumberAndHashWithManySyntheticTxs(chainId, mainWallet, mainPrivateKeyString, wallets);

  console.log('Creating smartContractParams.json file...');
  const output = {};
  output['mainWalletAddress'] = mainWallet.address;
  output['latestBlock'] = latestBlock;
  output['contractAddress'] = smartContracts[0];
  output['contractsAddresses'] = smartContracts;
  output['wallets'] = wallets;
  output['filters'] = filters;
  output['blockNumberWithManySyntheticTxs'] = blockNumberAndHashWithManySyntheticTxs.blockNumber;
  output['blockHashWithManySyntheticTxs'] = blockNumberAndHashWithManySyntheticTxs.blockHash;

  fs.writeFileSync(path.resolve(__dirname) + '/.smartContractParams.json', JSON.stringify(output, null, 2));
})();
