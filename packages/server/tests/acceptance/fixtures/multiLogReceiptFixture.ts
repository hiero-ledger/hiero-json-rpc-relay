// SPDX-License-Identifier: Apache-2.0

import {
  AccountCreateTransaction,
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenId,
  TokenSupplyType,
  TokenType,
  TransferTransaction,
} from '@hashgraph/sdk';

import MirrorClient from '../../clients/mirrorClient';

/**
 * Test fixture responsible for creating a Hedera block containing
 * a transaction that emits multiple synthetic logs.
 *
 * The resulting transaction produces multiple synthetic transfer logs,
 * which can be used for testing relay JSON-RPC methods such as
 * `eth_getBlockReceipts` or `eth_getTransactionReceipts`.
 */
export class MultiLogReceiptFixture {
  private readonly operatorId: AccountId;

  constructor(
    private readonly client: Client,
    private readonly mirrorNode: MirrorClient,
  ) {
    this.operatorId = client.getOperator()!.accountId!;
  }

  /**
   * Creates a blockchain state containing a transaction that produces
   * multiple synthetic logs and returns the EVM-compatible block number.
   *
   * @returns Hex-encoded block number (e.g. `0x83`)
   */
  public async createBlockWithMultiLogSyntheticTransaction() {
    const { recipientId, recipientKey } = await this.createRecipient();
    const tokenIds = await Promise.all([
      this.createToken('MultiLog Testing Token', 'MLTT'),
      this.createToken('MultiLog2 Testing Token', 'MLTT2'),
    ]);
    await this.associate(tokenIds, recipientId, recipientKey);
    const record = await this.executeCryptoTransfer(tokenIds, recipientId);
    const blockId = await this.fetchBlockNumberWithRetries(record.consensusTimestamp.toString());
    return `0x${Number(blockId).toString(16)}`;
  }

  /**
   * Creates a sample fungible HTS token with the operator as treasury.
   *
   * @param name - Token name
   * @param symbol - Token symbol
   * @returns Created token ID
   */
  private async createToken(name: string, symbol: string) {
    const tokenCreateTx = await new TokenCreateTransaction()
      .setTokenName(name)
      .setTokenSymbol(symbol)
      .setTokenType(TokenType.FungibleCommon)
      .setDecimals(6)
      .setInitialSupply(1_000_000_000)
      .setTreasuryAccountId(this.operatorId)
      .setSupplyType(TokenSupplyType.Infinite)
      .execute(this.client);
    const tokenCreateReceipt = await tokenCreateTx.getReceipt(this.client);

    return tokenCreateReceipt.tokenId!;
  }

  /**
   * Creates a new recipient account funded with a small amount of HBAR.
   *
   * @returns Recipient account ID and private key
   */
  private async createRecipient() {
    const recipientKey = PrivateKey.generateED25519();
    const recipientCreateTx = await new AccountCreateTransaction()
      .setKeyWithoutAlias(recipientKey.publicKey)
      .setInitialBalance(new Hbar(1))
      .execute(this.client);

    const recipientReceipt = await recipientCreateTx.getReceipt(this.client);
    return { recipientId: recipientReceipt.accountId!, recipientKey };
  }

  /**
   * Fetches the Hedera block that should contain the newly created transaction.
   *
   * The method retries several times because the mirror node may not yet have
   * ingested the block immediately after transaction execution.
   *
   * @param timestamp - Transaction consensus timestamp
   * @param maxRetries - Maximum number of retry attempts
   * @returns Hedera block number
   */
  private async fetchBlockNumberWithRetries(timestamp: string, maxRetries = 3) {
    let attempt = 0;
    while (attempt++ < maxRetries) {
      const blockData = await this.mirrorNode.get(`/blocks?timestamp=gte:${timestamp}&limit=1&order=asc`);
      if (blockData.blocks.length) return blockData.blocks[0].number;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error('Failed to fetch block ID');
  }

  /**
   * Associates the specified account with the provided tokens.
   *
   * @param tokenIds - Tokens to associate
   * @param accountId - Account to associate tokens with
   * @param signerKey - Private key of the account being associated
   */
  private async associate(tokenIds: TokenId[], accountId: AccountId, signerKey: PrivateKey) {
    const assocTx = await new TokenAssociateTransaction()
      .setAccountId(accountId)
      .setTokenIds(tokenIds)
      .freezeWith(this.client)
      .sign(signerKey);
    const assocSubmit = await assocTx.execute(this.client);
    await assocSubmit.getReceipt(this.client);
  }

  /**
   * Executes a transfer transaction sending HBAR and multiple tokens
   * from the operator to the recipient.
   *
   * Each token transfer generates synthetic transfer logs which might be
   * later used in relay acceptance tests.
   *
   * @param tokenIds - Tokens to transfer
   * @param recipientId - Recipient account
   * @returns Transaction record of the executed transfer
   */
  private async executeCryptoTransfer(tokenIds: TokenId[], recipientId: AccountId) {
    const tokenAmount = 5_000_000;

    const cryptoTransfer = new TransferTransaction();
    for (const tokenId of tokenIds) {
      cryptoTransfer
        .addTokenTransfer(tokenId, this.operatorId, -tokenAmount)
        .addTokenTransfer(tokenId, recipientId, tokenAmount);
    }
    const transferTransaction = await cryptoTransfer.execute(this.client);

    return await transferTransaction.getRecord(this.client);
  }
}
