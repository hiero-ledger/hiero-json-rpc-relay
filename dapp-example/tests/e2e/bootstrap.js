const HederaSDK = require('@hashgraph/sdk');
const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const randomUppercaseString = (length = 5) => {
  let result = '';
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const charactersLength = characters.length;

  for (let i = 0; i < length; i++) {
    result += characters.charAt(crypto.randomInt(charactersLength));
  }

  return result;
};

const idToEvmAddress = (id) => {
  try {
    const [shard, realm, num] = id.split('.');
    return ['0x', toHex(shard).padStart(8, '0'), toHex(realm).padStart(16, '0'), toHex(num).padStart(16, '0')].join('');
  } catch (e) {
    throw new Error(`Can not transform id ${id} to evm address`);
  }
};

const toHex = (num) => {
  return parseInt(num).toString(16);
};

const supportedEnvs = ['previewnet', 'testnet', 'mainnet'];

let client;
const network = process.env.HEDERA_NETWORK || '{}';
if (supportedEnvs.includes(network.toLowerCase())) {
  client = HederaSDK.Client.forName(network);
} else {
  client = HederaSDK.Client.forNetwork(JSON.parse(network));
}

client.setOperator(process.env.OPERATOR_ID_MAIN, process.env.OPERATOR_KEY_MAIN);
console.log(`SDK setup for ${JSON.stringify(network)} for account: ${process.env.OPERATOR_ID_MAIN}`);

const createAccountFromCompressedPublicKey = async function (compressedPublicKey) {
  const transferTransaction = await new HederaSDK.TransferTransaction()
    .addHbarTransfer(HederaSDK.PublicKey.fromString(compressedPublicKey).toAccountId(0, 0), new HederaSDK.Hbar(100))
    .addHbarTransfer(HederaSDK.AccountId.fromString(process.env.OPERATOR_ID_MAIN), new HederaSDK.Hbar(-100))
    .setTransactionMemo('relay dapp test crypto transfer')
    .execute(client);

  await transferTransaction.getReceipt(client);

  const txTransaction = await new HederaSDK.TransactionRecordQuery()
    .setTransactionId(transferTransaction.transactionId)
    .execute(client);

  const transfer = txTransaction.transfers.find(
    (trans) => !trans.amount.isNegative() && trans.accountId.num.toNumber() > 999,
  );
  const accountId = transfer.accountId.toString();

  console.log(`Account has been successfully created: ${accountId}`);

  return { accountId };
};

const createHTSToken = async function () {
  const expiration = new Date();
  expiration.setDate(expiration.getDate() + 30);
  const tokenCreate = await (
    await new HederaSDK.TokenCreateTransaction()
      .setTokenName(randomUppercaseString(8))
      .setTokenSymbol(randomUppercaseString(4))
      .setExpirationTime(expiration)
      .setDecimals(8)
      .setInitialSupply(200000000000)
      .setTreasuryAccountId(client.operatorAccountId)
      .setTransactionId(HederaSDK.TransactionId.generate(client.operatorAccountId))
      .setNodeAccountIds([client._network.getNodeAccountIdsForExecute()[0]])
  )
    .setTransactionMemo('relay dapp test token create')
    .execute(client);

  const receipt = await tokenCreate.getReceipt(client);
  const tokenId = receipt.tokenId.toString();
  const tokenAddress = idToEvmAddress(tokenId);

  console.log(`HTS Token Deployed at: ${tokenAddress} with id ${tokenId}`);

  return { tokenId, tokenAddress };
};

const associateHTSToken = async function (accountId, tokenId, pk) {
  const tokenAssociate = await (
    await new HederaSDK.TokenAssociateTransaction()
      .setAccountId(accountId)
      .setTokenIds([tokenId])
      .setTransactionMemo('relay dapp test token associate')
      .freezeWith(client)
      .sign(HederaSDK.PrivateKey.fromStringECDSA(pk))
  ).execute(client);

  await tokenAssociate.getReceipt(client);
  console.log(`HTS Token ${tokenId} associated to : ${accountId}`);
};

const approveHTSToken = async function (spenderId, tokenId) {
  const amount = 100000000000;
  const tokenApprove = await new HederaSDK.AccountAllowanceApproveTransaction()
    .addTokenAllowance(tokenId, spenderId, amount)
    .setTransactionMemo('relay dapp test allowance approval')
    .execute(client);

  await tokenApprove.getReceipt(client);
  console.log(`${amount} of HTS Token ${tokenId} can be spent by ${spenderId}`);
};

const transferHTSToken = async function (accountId, tokenId) {
  const amount = 50000000000;
  const tokenTransfer = await (
    await new HederaSDK.TransferTransaction()
      .addTokenTransfer(tokenId, client.operatorAccountId, -amount)
      .addTokenTransfer(tokenId, accountId, amount)
  )
    .setTransactionMemo('relay dapp test token transfer')
    .execute(client);

  await tokenTransfer.getReceipt(client);
  console.log(`${amount} of HTS Token ${tokenId} can be spent by ${accountId}`);
};

const deployHederaTokenService = async function (wallet) {
  const contractArtifact = require('../../src/contracts/HederaTokenService.json');

  const contractFactory = new ethers.ContractFactory(contractArtifact.abi, contractArtifact.bytecode, wallet);
  const contract = await contractFactory.deploy();
  await contract.waitForDeployment();
  const contractAddress = contract.target;

  return contractAddress;
};

const deployAndFundContractTransferTx = async function (wallet) {
  const contractArtifact = require('../../src/contracts/ContractTransferTx.json');

  const contractFactory = new ethers.ContractFactory(contractArtifact.abi, contractArtifact.bytecode, wallet);
  const contract = await contractFactory.deploy({ gasLimit: 1_000_000 });
  await contract.waitForDeployment();
  const contractAddress = contract.target;

  await new HederaSDK.TransferTransaction()
    .addHbarTransfer(HederaSDK.AccountId.fromEvmAddress(0, 0, contractAddress), new HederaSDK.Hbar(100))
    .addHbarTransfer(HederaSDK.AccountId.fromString(process.env.OPERATOR_ID_MAIN), new HederaSDK.Hbar(-100))
    .setTransactionMemo('relay dapp ContractTransferTx funding')
    .execute(client);

  return contractAddress;
};

(async () => {
  let mainPrivateKeyString = process.env.PRIVATE_KEY;
  if (mainPrivateKeyString === '') {
    mainPrivateKeyString = HederaSDK.PrivateKey.generateECDSA().toStringRaw();
  }

  const provider = new ethers.JsonRpcProvider(new ethers.FetchRequest(process.env.RPC_URL), undefined, {
    batchMaxCount: 1
  });
  const mainWallet = new ethers.Wallet(mainPrivateKeyString, provider);
  const mainCompressedKey = mainWallet.signingKey.compressedPublicKey.replace('0x', '');
  const mainAccountId = (await createAccountFromCompressedPublicKey(mainCompressedKey)).accountId;
  console.log(
    `Primary wallet account private: ${mainPrivateKeyString}, public: ${mainCompressedKey}, id: ${mainAccountId}`,
  );

  let receiverPrivateKeyString = process.env.RECEIVER_PRIVATE_KEY;
  if (receiverPrivateKeyString === '') {
    receiverPrivateKeyString = HederaSDK.PrivateKey.generateECDSA().toStringRaw();
  }
  const receiverWallet = new ethers.Wallet(receiverPrivateKeyString);
  const receiverCompressedKey = receiverWallet.signingKey.compressedPublicKey.replace('0x', '');
  const receiverAccountId = (await createAccountFromCompressedPublicKey(receiverCompressedKey)).accountId;
  console.log(
    `Receiver wallet account private: ${receiverPrivateKeyString}, public: ${receiverCompressedKey}, id: ${receiverAccountId}`,
  );

  const ContractTransferTxAddress = await deployAndFundContractTransferTx(mainWallet);
  console.log(`Contract Transfer Tx Address: ${ContractTransferTxAddress}`);
  const HTSContractAddress = await deployHederaTokenService(mainWallet);
  console.log(`HTS Contract Address: ${HTSContractAddress}`);

  // Get Contract id from evm address
  const contractInfo = await new HederaSDK.ContractInfoQuery()
    .setContractId(HederaSDK.ContractId.fromEvmAddress(0, 0, HTSContractAddress))
    .execute(client);
  const HTSContractId = contractInfo.contractId;
  console.log(`HTS Contract ID: ${HTSContractId}`);

  const { tokenId, tokenAddress } = await createHTSToken();
  const token2 = await createHTSToken();
  fs.writeFileSync(
    path.resolve(__dirname + '../../../src/contracts/') + '/.bootstrapInfo.json',
    `{"HTS_ADDRESS":"${tokenAddress}", "HTS_SECOND_ADDRESS":"${token2.tokenAddress}", "HTS_CONTRACT_ADDRESS": "${HTSContractAddress}", "CONTRACT_TRANSFER_TX_ADDRESS": "${ContractTransferTxAddress}"}`,
  );

  await associateHTSToken(mainAccountId, tokenId, mainPrivateKeyString);
  await approveHTSToken(mainAccountId, tokenId);

  await associateHTSToken(receiverAccountId, tokenId, receiverPrivateKeyString);
  await approveHTSToken(receiverAccountId, tokenId);

  await transferHTSToken(mainAccountId, tokenId);
  await transferHTSToken(receiverAccountId, tokenId);

  process.exit(0);
})();
