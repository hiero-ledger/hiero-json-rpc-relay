// SPDX-License-Identifier: Apache-2.0

import { Utils as relayUtils } from '@hashgraph/json-rpc-relay/dist/utils';
import {
  AccountAllowanceApproveTransaction,
  AccountBalanceQuery,
  AccountCreateTransaction,
  AccountId,
  AccountInfoQuery,
  Client,
  ContractCreateFlow,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  ContractId,
  CustomFee,
  CustomFixedFee,
  CustomFractionalFee,
  CustomRoyaltyFee,
  EvmAddress,
  FileContentsQuery,
  FileUpdateTransaction,
  Hbar,
  Key,
  KeyList,
  PrivateKey,
  Query,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenGrantKycTransaction,
  TokenId,
  TokenMintTransaction,
  TokenSupplyType,
  TokenType,
  Transaction,
  TransactionId,
  TransactionResponse,
  TransferTransaction,
} from '@hashgraph/sdk';
import { ethers, JsonRpcProvider } from 'ethers';
import Long from 'long';

import { Utils } from '../helpers/utils';
import { AliasAccount } from '../types/AliasAccount';

const supportedEnvs = ['previewnet', 'testnet', 'mainnet'];

type CreateHTSParams = {
  tokenName: string;
  symbol: string;
  treasuryAccountId: string;
  initialSupply: number;
  adminPrivateKey: PrivateKey;
  kyc?: Key;
  freeze?: Key;
  customHbarFees?: number;
  customTokenFees?: number;
  customRoyaltyFees?: number;
  customFractionalFees?: number;
};

type CreateNFTParams = {
  tokenName: string;
  symbol: string;
  treasuryAccountId: string;
  maxSupply: number;
  adminPrivateKey: PrivateKey;
  customRoyaltyFees?: number;
};

export default class ServicesClient {
  static TINYBAR_TO_WEIBAR_COEF = 10_000_000_000;

  private readonly DEFAULT_KEY = PrivateKey.generateECDSA();
  private readonly network: string;

  public readonly client: Client;

  constructor(network: string, accountId: string, key: string) {
    this.network = network;

    if (!network) network = '{}';
    const opPrivateKey = relayUtils.createPrivateKeyBasedOnFormat(key);
    if (supportedEnvs.includes(network.toLowerCase())) {
      this.client = Client.forName(network);
    } else {
      this.client = Client.forNetwork(JSON.parse(network));
    }
    this.client.setOperator(AccountId.fromString(accountId), opPrivateKey.toString());
  }

  async createInitialAliasAccount(
    providerUrl: string,
    chainId: ethers.BigNumberish,
    initialBalance: number = 2000,
  ): Promise<AliasAccount> {
    const privateKey = PrivateKey.generateECDSA();
    const wallet = new ethers.Wallet(
      privateKey.toStringRaw(),
      new ethers.JsonRpcProvider(providerUrl, new ethers.Network('Hedera', chainId)),
    );
    const address = wallet.address;

    const aliasCreationResponse = await this.executeTransaction(
      new TransferTransaction()
        .addHbarTransfer(this._thisAccountId(), new Hbar(initialBalance).negated())
        .addHbarTransfer(AccountId.fromEvmAddress(0, 0, address), new Hbar(initialBalance))
        .setTransactionMemo('Relay test crypto transfer'),
    );

    const receipt = await aliasCreationResponse?.getRecord(this.client);
    const accountId = receipt?.transfers[1].accountId;
    accountId.evmAddress = EvmAddress.fromString(address);

    return {
      alias: accountId,
      accountId,
      address,
      client: this,
      privateKey,
      wallet,
      keyList: KeyList.from([privateKey]),
    };
  }

  async executeQuery<T>(query: Query<T>) {
    return query.execute(this.client);
  }

  async executeTransaction(transaction: Transaction) {
    return await transaction.execute(this.client);
  }

  async executeAndGetTransactionReceipt(transaction: Transaction) {
    const resp = await this.executeTransaction(transaction);
    return resp?.getReceipt(this.client);
  }

  async getRecordResponseDetails(resp: TransactionResponse) {
    const record = await resp.getRecord(this.client);
    const nanoString = record.consensusTimestamp.nanos.toString();
    const executedTimestamp = `${record.consensusTimestamp.seconds}.${nanoString.padStart(9, '0')}`;
    const transactionId = record.transactionId;
    const transactionIdNanoString = transactionId.validStart?.nanos.toString();
    const executedTransactionId = `${transactionId.accountId}-${
      transactionId.validStart?.seconds
    }-${transactionIdNanoString?.padStart(9, '0')}`;
    return { executedTimestamp, executedTransactionId };
  }

  async createToken(initialSupply: number = 1000) {
    const symbol = Math.random().toString(36).slice(2, 6).toUpperCase();
    const resp = await this.executeAndGetTransactionReceipt(
      new TokenCreateTransaction()
        .setTokenName(`relay-acceptance token ${symbol}`)
        .setTokenSymbol(symbol)
        .setDecimals(3)
        .setInitialSupply(new Hbar(initialSupply).toTinybars())
        .setTreasuryAccountId(this._thisAccountId())
        .setTransactionMemo('Relay test token create'),
    );

    const tokenId = resp?.tokenId;
    return tokenId!;
  }

  async associateToken(tokenId: string | TokenId) {
    await this.executeAndGetTransactionReceipt(
      new TokenAssociateTransaction()
        .setAccountId(this._thisAccountId())
        .setTokenIds([tokenId])
        .setTransactionMemo('Relay test token association'),
    );
  }

  async transferToken(tokenId: string | TokenId, recipient: AccountId, amount = 10) {
    const receipt = await this.executeAndGetTransactionReceipt(
      new TransferTransaction()
        .addTokenTransfer(tokenId, this._thisAccountId(), -amount)
        .addTokenTransfer(tokenId, recipient, amount)
        .setTransactionMemo('Relay test token transfer'),
    );

    await this.executeQuery(new AccountBalanceQuery().setAccountId(recipient));

    return receipt;
  }

  async executeContractCall(
    contractId: string | ContractId,
    functionName: string,
    params: ContractFunctionParameters,
    gasLimit: number | Long = 75000,
  ) {
    const tx = new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gasLimit)
      .setFunction(functionName, params)
      .setTransactionMemo('Relay test contract execution');

    const contractExecTransactionResponse = await this.executeTransaction(tx);

    // @ts-ignore
    const resp = await this.getRecordResponseDetails(contractExecTransactionResponse);
    const contractExecuteTimestamp = resp.executedTimestamp;
    const contractExecutedTransactionId = resp.executedTransactionId;

    return { contractExecuteTimestamp, contractExecutedTransactionId };
  }

  async executeContractCallWithAmount(
    contractId: string | ContractId,
    functionName: string,
    params: ContractFunctionParameters,
    gasLimit = 500_000,
    amount = 0,
  ) {
    const tx = new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gasLimit)
      .setFunction(functionName, params)
      .setTransactionMemo('Relay test contract execution');

    tx.setPayableAmount(Hbar.fromTinybars(amount));
    const contractExecTransactionResponse = await this.executeTransaction(tx);

    // @ts-ignore
    const resp = await this.getRecordResponseDetails(contractExecTransactionResponse);
    const contractExecuteTimestamp = resp.executedTimestamp;
    const contractExecutedTransactionId = resp.executedTransactionId;

    return { contractExecuteTimestamp, contractExecutedTransactionId };
  }

  async getAliasAccountInfo(
    accountId: AccountId,
    privateKey: PrivateKey,
    provider: JsonRpcProvider | null = null,
    keyList?: KeyList,
  ): Promise<AliasAccount> {
    await this.executeQuery(new AccountBalanceQuery().setAccountId(accountId));
    const accountInfo = (await this.executeQuery(new AccountInfoQuery().setAccountId(accountId)))!;
    const servicesClient = new ServicesClient(this.network, accountInfo.accountId.toString(), privateKey.toString());

    let wallet: ethers.Wallet;
    if (provider) {
      wallet = new ethers.Wallet(privateKey.toStringRaw(), provider);
    } else {
      wallet = new ethers.Wallet(privateKey.toStringRaw());
    }

    return {
      alias: accountId,
      accountId: accountInfo.accountId,
      address: Utils.add0xPrefix(accountInfo.contractAccountId!),
      client: servicesClient,
      privateKey,
      wallet,
      keyList,
    };
  }

  // Creates an account that has 2 keys - ECDSA and a contractId. This is required for calling contract methods that create HTS tokens.
  // The contractId should be the id of the contract.
  // The account should be created after the contract has been deployed.
  async createAccountWithContractIdKey(
    contractId: string | ContractId,
    initialBalance = 10,
    provider: JsonRpcProvider | null = null,
  ) {
    const privateKey = PrivateKey.generateECDSA();
    const publicKey = privateKey.publicKey;

    if (typeof contractId === 'string') {
      contractId = ContractId.fromString(contractId);
    }

    const keys = [publicKey, contractId];

    // Create a KeyList of both keys and specify that only 1 is required for signing transactions
    const keyList = new KeyList(keys, 1);

    const accountCreateTx = await new AccountCreateTransaction()
      .setInitialBalance(new Hbar(initialBalance))
      .setKey(keyList)
      .setAlias(publicKey.toEvmAddress())
      .freezeWith(this.client)
      .sign(privateKey);

    const txResult = await accountCreateTx.execute(this.client);
    const receipt = await txResult.getReceipt(this.client);
    const accountId = receipt.accountId!;

    return this.getAliasAccountInfo(accountId, privateKey, provider, keyList);
  }

  async createAliasAccount(initialBalance = 10, provider: JsonRpcProvider | null = null): Promise<AliasAccount> {
    const privateKey = PrivateKey.generateECDSA();
    const publicKey = privateKey.publicKey;
    const aliasAccountId = publicKey.toAccountId(0, 0);

    const aliasCreationResponse = await this.executeTransaction(
      new TransferTransaction()
        .addHbarTransfer(this._thisAccountId(), new Hbar(initialBalance).negated())
        .addHbarTransfer(aliasAccountId, new Hbar(initialBalance))
        .setTransactionMemo('Relay test crypto transfer'),
    );

    await aliasCreationResponse?.getReceipt(this.client);

    return this.getAliasAccountInfo(aliasAccountId, privateKey, provider);
  }

  async deployContract(
    contract: { bytecode: string | Uint8Array },
    gas = 100_000,
    constructorParameters: Uint8Array = new Uint8Array(),
    initialBalance = 0,
  ) {
    const contractCreate = await new ContractCreateFlow()
      .setGas(gas)
      .setBytecode(contract.bytecode)
      .setConstructorParameters(constructorParameters)
      .setInitialBalance(initialBalance)
      .execute(this.client);
    return contractCreate.getReceipt(this.client);
  }

  _thisAccountId() {
    return this.client.operatorAccountId || AccountId.fromString('0.0.0');
  }

  async getOperatorBalance(): Promise<Hbar> {
    const accountBalance = await new AccountBalanceQuery()
      .setAccountId(this.client.operatorAccountId!)
      .execute(this.client);
    return accountBalance.hbars;
  }

  async getFileContent(fileId: string): Promise<any> {
    const query = new FileContentsQuery().setFileId(fileId);

    return await query.execute(this.client);
  }

  async updateFileContent(fileId: string, content: string): Promise<void> {
    const response = await new FileUpdateTransaction()
      .setFileId(fileId)
      .setContents(Buffer.from(content, 'hex'))
      .setTransactionMemo('Relay test update')
      .execute(this.client);

    await response.getReceipt(this.client);
  }

  getClient() {
    try {
      const network = JSON.parse(this.network);
      return Client.forNetwork(network);
    } catch (e) {
      // network config is a string and not a valid JSON
      return Client.forName(this.network);
    }
  }

  async createHTS(
    args: CreateHTSParams = {
      tokenName: 'Default Name',
      symbol: 'HTS',
      treasuryAccountId: '0.0.2',
      initialSupply: 5000,
      adminPrivateKey: this.DEFAULT_KEY,
    },
  ) {
    const expiration = new Date();
    expiration.setDate(expiration.getDate() + 30);

    const htsClient = this.getClient();
    htsClient.setOperator(AccountId.fromString(args.treasuryAccountId), args.adminPrivateKey);

    const transaction = new TokenCreateTransaction()
      .setTokenName(args.tokenName)
      .setTokenSymbol(args.symbol)
      .setExpirationTime(expiration)
      .setDecimals(18)
      .setTreasuryAccountId(AccountId.fromString(args.treasuryAccountId))
      .setInitialSupply(args.initialSupply)
      .setTransactionId(TransactionId.generate(AccountId.fromString(args.treasuryAccountId)))
      .setNodeAccountIds([htsClient._network.getNodeAccountIdsForExecute()[0]])
      .setMaxTransactionFee(50);

    if (args.kyc) {
      transaction.setKycKey(args.kyc);
    }

    if (args.freeze) {
      transaction.setFreezeKey(args.freeze);
    }

    const customFees: CustomFee[] = [];
    if (args.customHbarFees) {
      customFees.push(
        new CustomFixedFee()
          .setHbarAmount(Hbar.fromTinybars(args.customHbarFees))
          .setFeeCollectorAccountId(AccountId.fromString(args.treasuryAccountId)),
      );
    }

    if (args.customTokenFees) {
      customFees.push(
        new CustomFixedFee()
          .setAmount(args.customTokenFees)
          .setFeeCollectorAccountId(AccountId.fromString(args.treasuryAccountId)),
      );
    }

    if (args.customFractionalFees) {
      customFees.push(
        new CustomFractionalFee()
          .setNumerator(args.customFractionalFees)
          .setDenominator(args.customFractionalFees * 10)
          .setFeeCollectorAccountId(AccountId.fromString(args.treasuryAccountId)),
      );
    }

    if (customFees.length) {
      transaction.setCustomFees(customFees);
    }

    const tokenCreate = await transaction.execute(htsClient);

    const receipt = await tokenCreate.getReceipt(this.client);
    return {
      client: htsClient,
      receipt,
    };
  }

  async createNFT(
    args: CreateNFTParams = {
      tokenName: 'Default Name',
      symbol: 'HTS',
      treasuryAccountId: '0.0.2',
      maxSupply: 5000,
      adminPrivateKey: this.DEFAULT_KEY,
    },
  ) {
    const htsClient = this.getClient();
    htsClient.setOperator(AccountId.fromString(args.treasuryAccountId), args.adminPrivateKey);

    const transaction = new TokenCreateTransaction()
      .setTokenName(args.tokenName)
      .setTokenSymbol(args.symbol)
      .setTokenType(TokenType.NonFungibleUnique)
      .setDecimals(0)
      .setInitialSupply(0)
      .setTreasuryAccountId(AccountId.fromString(args.treasuryAccountId))
      .setSupplyType(TokenSupplyType.Finite)
      .setMaxSupply(args.maxSupply)
      .setSupplyKey(args.adminPrivateKey)
      .setTransactionId(TransactionId.generate(AccountId.fromString(args.treasuryAccountId)))
      .setNodeAccountIds([htsClient._network.getNodeAccountIdsForExecute()[0]])
      .setMaxTransactionFee(50);

    if (args.customRoyaltyFees) {
      transaction.setCustomFees([
        new CustomRoyaltyFee()
          .setNumerator(args.customRoyaltyFees)
          .setDenominator(args.customRoyaltyFees * 10)
          .setFeeCollectorAccountId(AccountId.fromString(args.treasuryAccountId)),
      ]);
    }

    const nftCreate = await transaction.execute(htsClient);

    const receipt = await nftCreate.getReceipt(this.client);
    return {
      client: htsClient,
      receipt,
    };
  }

  async mintNFT(
    args = {
      tokenId: '0.0.1000',
      metadata: 'abcde',
      treasuryAccountId: '0.0.2',
      adminPrivateKey: this.DEFAULT_KEY,
    },
  ) {
    const htsClient = this.getClient();
    htsClient.setOperator(AccountId.fromString(args.treasuryAccountId), args.adminPrivateKey);

    // Mint new NFT
    const mintTx = await new TokenMintTransaction()
      .setTokenId(args.tokenId)
      .setMetadata([Buffer.from(args.metadata)])
      .execute(htsClient);

    const receipt = await mintTx.getReceipt(this.client);
    return {
      client: htsClient,
      receipt,
    };
  }

  async grantKyc(
    args = {
      tokenId: '0.0.1000',
      treasuryAccountId: '0.0.2',
      adminPrivateKey: this.DEFAULT_KEY,
      accountId: '0.0.1001',
    },
  ) {
    const htsClient = this.getClient();
    htsClient.setOperator(AccountId.fromString(args.treasuryAccountId), args.adminPrivateKey);

    //Enable KYC flag on account and freeze the transaction for manual signing
    const transaction = await new TokenGrantKycTransaction()
      .setAccountId(args.accountId)
      .setTokenId(args.tokenId)
      .execute(htsClient);

    //Request the receipt of the transaction
    const receipt = await transaction.getReceipt(htsClient);

    return {
      client: htsClient,
      receipt,
    };
  }

  async associateHTSToken(
    accountId: string | AccountId,
    tokenId: string | TokenId,
    privateKey: PrivateKey,
    htsClient: Client,
  ) {
    const tokenAssociate = await (
      await new TokenAssociateTransaction()
        .setAccountId(accountId)
        .setTokenIds([tokenId])
        .freezeWith(htsClient)
        .sign(privateKey)
    ).execute(htsClient);

    await tokenAssociate.getReceipt(htsClient);
  }

  async approveHTSToken(spenderId: string | AccountId, tokenId: string | TokenId, htsClient: Client) {
    const amount = 10000;
    const tokenApprove = await new AccountAllowanceApproveTransaction()
      .addTokenAllowance(tokenId, spenderId, amount)
      .execute(htsClient);

    await tokenApprove.getReceipt(htsClient);
  }

  async transferHTSToken(
    accountId: string | AccountId,
    tokenId: string | TokenId,
    amount: number | Long,
    fromId: string | AccountId = this.client.operatorAccountId!,
  ) {
    const tokenTransfer = await new TransferTransaction()
      .addTokenTransfer(tokenId, fromId, -amount)
      .addTokenTransfer(tokenId, accountId, amount)
      .execute(this.client);

    await tokenTransfer.getReceipt(this.client);
  }
}
