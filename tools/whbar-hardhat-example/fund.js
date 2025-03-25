// SPDX-License-Identifier: Apache-2.0

const SDK = require('@hashgraph/sdk');

const fundECDSA = async function(hre, initialHbarBalance, contractAddress) {
  if (!initialHbarBalance) {
    console.log('(${hre.network.name}) There is no initial funding.');
    return;
  }

  const signers = await hre.ethers.getSigners();
  const networkName = hre.network.name.split('_')[1];

  const client = SDK.Client[`for${capitalizeFirstLetter(networkName)}`]();
  const mirrorNodeUrl = client._mirrorNetwork._network.keys().next().value;

  const signerInfo = await fetchMirrorNodeAccount(mirrorNodeUrl, signers[0].address);
  const signerAccountId = signerInfo.account;
  const signerBalance = BigInt(signerInfo.balance.balance) / BigInt(100_000_000);
  if (BigInt(initialHbarBalance) > signerBalance) {
    throw new Error('Insufficient signer balance.');
  }

  const contractInfo = await fetchMirrorNodeAccount(mirrorNodeUrl, contractAddress);
  const contractId = contractInfo.account;

  client.setOperator(signerAccountId, SDK.PrivateKey.fromStringECDSA(process.env.ECDSA_HEX_PRIVATE_KEY));

  const transaction = new SDK.TransferTransaction()
    .addHbarTransfer(signerAccountId, new SDK.Hbar(Number(initialHbarBalance)).negated())
    .addHbarTransfer(contractId, new SDK.Hbar(Number(initialHbarBalance)));
  const txResponse = await transaction.execute(client);
  const receipt = await txResponse.getReceipt(client);

  if (receipt.status._code !== 22) {
    throw new Error(`Funding transaction with id ${txResponse.transactionId.toString()} failed.`);
  }

  console.log(`(${hre.network.name}) WHBAR contract ${contractAddress} was successfully funded with ${initialHbarBalance} hbars.`);
};

const fundED25519 = async function(hre, initialHbarBalance, contractId) {
  const networkName = hre.network.name.split('_')[1];
  const client = SDK.Client[`for${capitalizeFirstLetter(networkName)}`]();

  client.setOperator(SDK.AccountId.fromString(process.env.ED25519_ACCOUNT_ID), SDK.PrivateKey.fromStringED25519(process.env.ED25519_HEX_PRIVATE_KEY));

  const fundTx = new SDK.TransferTransaction()
    .addHbarTransfer(process.env.ED25519_ACCOUNT_ID, new SDK.Hbar(initialHbarBalance).negated())
    .addHbarTransfer(contractId, new SDK.Hbar(initialHbarBalance));
  const fundTxResponse = await fundTx.execute(client);
  const fundReceipt = await fundTxResponse.getReceipt(client);

  if (fundReceipt.status._code !== 22) {
    throw new Error(`Funding transaction with id ${fundTxResponse.transactionId.toString()} failed.`);
  }

  console.log(`(${hre.network.name}) WHBAR contract ${contractId} was successfully funded with ${initialHbarBalance} hbars.`);
};

const capitalizeFirstLetter = (str) => {
  return String(str).charAt(0).toUpperCase() + String(str).slice(1);
};

const fetchMirrorNodeAccount = async (mirrorNodeUrl, address) => {
  try {
    return await (await fetch(`https://${mirrorNodeUrl}/api/v1/accounts/${address}`)).json();
  } catch (err) {
    throw new Error(`Unable to fetch address ${address} from mirror node.`);
  }
};

module.exports = { fundECDSA, fundED25519, capitalizeFirstLetter, fetchMirrorNodeAccount };
