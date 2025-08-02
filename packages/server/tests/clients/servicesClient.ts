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
import { Long } from 'long';
import { Logger } from 'pino';

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
  private readonly logger: Logger;
  private readonly network: string;

  public readonly client: Client;

  constructor(network: string, accountId: string, key: string, logger: Logger) {
    this.logger = logger;
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

  getLogger(): Logger {
    return this.logger;
  }

  async createInitialAliasAccount(
    providerUrl: string,
    chainId: ethers.BigNumberish,
    requestId?: string,
    initialBalance: number = 2000,
  ): Promise<AliasAccount> {
    const requestIdPrefix = Utils.formatRequestIdMessage(requestId);
    const privateKey = PrivateKey.generateECDSA();
    const wallet = new ethers.Wallet(
      privateKey.toStringRaw(),
      new ethers.JsonRpcProvider(providerUrl, new ethers.Network('Hedera', chainId)),
    );
    const address = wallet.address;

    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestIdPrefix} Create new Eth compatible account w alias: ${address} and balance ~${initialBalance} HBar`,
      );
    }

    const aliasCreationResponse = await this.executeTransaction(
      new TransferTransaction()
        .addHbarTransfer(this._thisAccountId(), new Hbar(initialBalance).negated())
        .addHbarTransfer(AccountId.fromEvmAddress(0, 0, address), new Hbar(initialBalance))
        .setTransactionMemo('Relay test crypto transfer'),
      requestId,
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

  async executeQuery<T>(query: Query<T>, requestId?: string) {
    const requestIdPrefix = Utils.formatRequestIdMessage(requestId);
    try {
      this.logger.info(`${requestIdPrefix} Execute ${query.constructor.name} query`);
      return query.execute(this.client);
    } catch (e) {
      this.logger.error(e, `${requestIdPrefix} Error executing ${query.constructor.name} query`);
    }
  }

  async executeTransaction(transaction: Transaction, requestId?: string) {
    const requestIdPrefix = Utils.formatRequestIdMessage(requestId);
    try {
      const resp = await transaction.execute(this.client);
      this.logger.info(
        `${requestIdPrefix} Executed transaction of type ${
          transaction.constructor.name
        }. TX ID: ${resp.transactionId.toString()}`,
      );
      return resp;
    } catch (e) {
      this.logger.error(e, `${requestIdPrefix} Error executing ${transaction.constructor.name} transaction`);
      throw e;
    }
  }

  async executeAndGetTransactionReceipt(transaction: Transaction, requestId?: string) {
    const resp = await this.executeTransaction(transaction, requestId);
    return resp?.getReceipt(this.client);
  }

  async getRecordResponseDetails(resp: TransactionResponse, requestId?: string) {
    const requestIdPrefix = Utils.formatRequestIdMessage(requestId);
    this.logger.info(`${requestIdPrefix} Retrieve record for ${resp.transactionId.toString()}`);
    const record = await resp.getRecord(this.client);
    const nanoString = record.consensusTimestamp.nanos.toString();
    const executedTimestamp = `${record.consensusTimestamp.seconds}.${nanoString.padStart(9, '0')}`;
    const transactionId = record.transactionId;
    const transactionIdNanoString = transactionId.validStart?.nanos.toString();
    const executedTransactionId = `${transactionId.accountId}-${transactionId.validStart
      ?.seconds}-${transactionIdNanoString?.padStart(9, '0')}`;
    this.logger.info(
      `${requestIdPrefix} executedTimestamp: ${executedTimestamp}, executedTransactionId: ${executedTransactionId}`,
    );
    return { executedTimestamp, executedTransactionId };
  }

  async createToken(initialSupply: number = 1000, requestId?: string) {
    const requestIdPrefix = Utils.formatRequestIdMessage(requestId);
    const symbol = Math.random().toString(36).slice(2, 6).toUpperCase();
    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`symbol = ${symbol}`);
    }
    const resp = await this.executeAndGetTransactionReceipt(
      new TokenCreateTransaction()
        .setTokenName(`relay-acceptance token ${symbol}`)
        .setTokenSymbol(symbol)
        .setDecimals(3)
        .setInitialSupply(new Hbar(initialSupply).toTinybars())
        .setTreasuryAccountId(this._thisAccountId())
        .setTransactionMemo('Relay test token create'),
      requestId,
    );

    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(`get token id from receipt`);
    }
    const tokenId = resp?.tokenId;
    this.logger.info(`${requestIdPrefix} token id = ${tokenId?.toString()}`);
    return tokenId!;
  }

  async associateToken(tokenId: string | TokenId, requestId?: string) {
    const requestIdPrefix = Utils.formatRequestIdMessage(requestId);
    await this.executeAndGetTransactionReceipt(
      new TokenAssociateTransaction()
        .setAccountId(this._thisAccountId())
        .setTokenIds([tokenId])
        .setTransactionMemo('Relay test token association'),
      requestId,
    );

    this.logger.debug(
      `${requestIdPrefix} Associated account ${this._thisAccountId()} with token ${tokenId.toString()}`,
    );
  }

  async transferToken(tokenId: string | TokenId, recipient: AccountId, amount = 10, requestId?: string) {
    const requestIdPrefix = Utils.formatRequestIdMessage(requestId);
    const receipt = await this.executeAndGetTransactionReceipt(
      new TransferTransaction()
        .addTokenTransfer(tokenId, this._thisAccountId(), -amount)
        .addTokenTransfer(tokenId, recipient, amount)
        .setTransactionMemo('Relay test token transfer'),
      requestId,
    );

    this.logger.debug(
      `${requestIdPrefix} Sent 10 tokens from account ${this._thisAccountId()} to account ${recipient.toString()} on token ${tokenId.toString()}`,
    );

    const balances = await this.executeQuery(new AccountBalanceQuery().setAccountId(recipient), requestId);

    this.logger.debug(
      `${requestIdPrefix} Token balances for ${recipient.toString()} are ${balances?.tokens?.toString()}`,
    );

    return receipt;
  }

  async executeContractCall(
    contractId: string | ContractId,
    functionName: string,
    params: ContractFunctionParameters,
    gasLimit: number | Long = 75000,
    requestId?: string,
  ) {
    const requestIdPrefix = Utils.formatRequestIdMessage(requestId);
    // Call a method on a contract exists on Hedera, but is allowed to mutate the contract state
    this.logger.info(`${requestIdPrefix} Execute contracts ${contractId}'s createChild method`);
    const tx = new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gasLimit)
      .setFunction(functionName, params)
      .setTransactionMemo('Relay test contract execution');

    const contractExecTransactionResponse = await this.executeTransaction(tx, requestId);

    // @ts-ignore
    const resp = await this.getRecordResponseDetails(contractExecTransactionResponse, requestId);
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
    requestId?: string,
  ) {
    const requestIdPrefix = Utils.formatRequestIdMessage(requestId);
    // Call a method on a contract exists on Hedera, but is allowed to mutate the contract state
    this.logger.info(`${requestIdPrefix} Execute contracts ${contractId}'s createChild method`);
    const tx = new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gasLimit)
      .setFunction(functionName, params)
      .setTransactionMemo('Relay test contract execution');

    tx.setPayableAmount(Hbar.fromTinybars(amount));
    const contractExecTransactionResponse = await this.executeTransaction(tx, requestId);

    // @ts-ignore
    const resp = await this.getRecordResponseDetails(contractExecTransactionResponse, requestId);
    const contractExecuteTimestamp = resp.executedTimestamp;
    const contractExecutedTransactionId = resp.executedTransactionId;

    return { contractExecuteTimestamp, contractExecutedTransactionId };
  }

  async getAliasAccountInfo(
    accountId: AccountId,
    privateKey: PrivateKey,
    provider: JsonRpcProvider | null = null,
    requestId?: string,
    keyList?: KeyList,
  ): Promise<AliasAccount> {
    const requestIdPrefix = Utils.formatRequestIdMessage(requestId);

    const balance = (await this.executeQuery(new AccountBalanceQuery().setAccountId(accountId), requestId))!;
    this.logger.info(`${requestIdPrefix} Balance of the new account: ${balance.toString()}`);

    const accountInfo = (await this.executeQuery(new AccountInfoQuery().setAccountId(accountId), requestId))!;
    this.logger.info(
      `${requestIdPrefix} New account Info - accountId: ${accountInfo.accountId.toString()}, evmAddress: ${
        accountInfo.contractAccountId
      }`,
    );
    const servicesClient = new ServicesClient(
      this.network,
      accountInfo.accountId.toString(),
      privateKey.toString(),
      this.logger.child({ name: `services-client` }),
    );

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
    requestId?: string,
  ) {
    const requestIdPrefix = Utils.formatRequestIdMessage(requestId);
    const privateKey = PrivateKey.generateECDSA();
    const publicKey = privateKey.publicKey;

    if (typeof contractId === 'string') {
      contractId = ContractId.fromString(contractId);
    }

    const keys = [publicKey, contractId];

    // Create a KeyList of both keys and specify that only 1 is required for signing transactions
    const keyList = new KeyList(keys, 1);

    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestIdPrefix} Create new Eth compatible account w ContractId key: ${contractId}, privateKey: ${privateKey}, alias: ${publicKey.toEvmAddress()} and balance ~${initialBalance} hb`,
      );
    }

    const accountCreateTx = await new AccountCreateTransaction()
      .setInitialBalance(new Hbar(initialBalance))
      .setKey(keyList)
      .setAlias(publicKey.toEvmAddress())
      .freezeWith(this.client)
      .sign(privateKey);

    const txResult = await accountCreateTx.execute(this.client);
    const receipt = await txResult.getReceipt(this.client);
    const accountId = receipt.accountId!;

    return this.getAliasAccountInfo(accountId, privateKey, provider, requestId, keyList);
  }

  async createAliasAccount(
    initialBalance = 10,
    provider: JsonRpcProvider | null = null,
    requestId?: string,
  ): Promise<AliasAccount> {
    const requestIdPrefix = Utils.formatRequestIdMessage(requestId);
    const privateKey = PrivateKey.generateECDSA();
    const publicKey = privateKey.publicKey;
    const aliasAccountId = publicKey.toAccountId(0, 0);

    if (this.logger.isLevelEnabled('trace')) {
      this.logger.trace(
        `${requestIdPrefix} Create new Eth compatible account w alias: ${aliasAccountId.toString()} and balance ~${initialBalance} hb`,
      );
    }

    const aliasCreationResponse = await this.executeTransaction(
      new TransferTransaction()
        .addHbarTransfer(this._thisAccountId(), new Hbar(initialBalance).negated())
        .addHbarTransfer(aliasAccountId, new Hbar(initialBalance))
        .setTransactionMemo('Relay test crypto transfer'),
      requestId,
    );

    this.logger.debug(`${requestIdPrefix} Get ${aliasAccountId.toString()} receipt`);
    await aliasCreationResponse?.getReceipt(this.client);

    return this.getAliasAccountInfo(aliasAccountId, privateKey, provider, requestId);
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

  async updateFileContent(fileId: string, content: string, requestId?: string): Promise<void> {
    const requestIdPrefix = Utils.formatRequestIdMessage(requestId);
    const response = await new FileUpdateTransaction()
      .setFileId(fileId)
      .setContents(Buffer.from(content, 'hex'))
      .setTransactionMemo('Relay test update')
      .execute(this.client);

    const receipt = await response.getReceipt(this.client);
    this.logger.info(`${requestIdPrefix} File ${fileId} updated with status: ${receipt.status.toString()}`);
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
    this.logger.info(`Created HTS token ${receipt.tokenId?.toString()}`);
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
    this.logger.info(`Created NFT token ${receipt.tokenId?.toString()}`);
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
    requestId?: string,
  ) {
    const requestIdPrefix = Utils.formatRequestIdMessage(requestId);
    const tokenAssociate = await (
      await new TokenAssociateTransaction()
        .setAccountId(accountId)
        .setTokenIds([tokenId])
        .freezeWith(htsClient)
        .sign(privateKey)
    ).execute(htsClient);

    await tokenAssociate.getReceipt(htsClient);
    this.logger.info(`${requestIdPrefix} HTS Token ${tokenId} associated to : ${accountId}`);
  }

  async approveHTSToken(
    spenderId: string | AccountId,
    tokenId: string | TokenId,
    htsClient: Client,
    requestId?: string,
  ) {
    const requestIdPrefix = Utils.formatRequestIdMessage(requestId);
    const amount = 10000;
    const tokenApprove = await new AccountAllowanceApproveTransaction()
      .addTokenAllowance(tokenId, spenderId, amount)
      .execute(htsClient);

    await tokenApprove.getReceipt(htsClient);
    this.logger.info(`${requestIdPrefix} ${amount} of HTS Token ${tokenId} can be spent by ${spenderId}`);
  }

  async transferHTSToken(
    accountId: string | AccountId,
    tokenId: string | TokenId,
    amount: number | Long,
    fromId: string | AccountId = this.client.operatorAccountId!,
    requestId?: string,
  ) {
    const requestIdPrefix = Utils.formatRequestIdMessage(requestId);
    try {
      const tokenTransfer = await new TransferTransaction()
        .addTokenTransfer(tokenId, fromId, -amount)
        .addTokenTransfer(tokenId, accountId, amount)
        .execute(this.client);

      const rec = await tokenTransfer.getReceipt(this.client);
      this.logger.info(`${requestIdPrefix} ${amount} of HTS Token ${tokenId} can be spent by ${accountId}`);
      this.logger.debug(`${requestIdPrefix} ${rec}`);
    } catch (e) {
      this.logger.error(e, `${requestIdPrefix} TransferTransaction failed`);
    }
  }
}
