// SPDX-License-Identifier: Apache-2.0

import {
  AccountCreateTransaction,
  AccountId,
  Client,
  Hbar,
  HbarUnit,
  PrivateKey,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenId,
  TokenSupplyType,
  TokenType,
  TransferTransaction,
} from '@hashgraph/sdk';

/**
 * Fixture for generating large blocks by executing multiple crypto transfers.
 */
export class LargeBlocksFixture {
  private readonly operatorId: AccountId;

  constructor(private readonly client: Client) {
    this.operatorId = client.getOperator()!.accountId!;
  }

  /**
   * Creates a large block by executing multiple crypto and token transfers.
   *
   * @param numberOfCryptoTransfers - Number of transfer transactions to execute
   */
  public async createLargeBlockWithCryptoTransfer(numberOfCryptoTransfers: number) {
    const tokenId = await this.createToken();
    const { accountId, accountKey } = await this.createSecondAccount();

    const [recipientId, senderId] = [accountId, this.operatorId];

    await this.associate([tokenId], recipientId, accountKey);

    // Wait for all the previously queued transactions to be already mined (removing flakiness)
    await new Promise((r) => setTimeout(r, 3000));

    for (let i = 0; i < numberOfCryptoTransfers; i++) {
      await this.executeCryptoTransfer(tokenId, senderId, recipientId);
    }
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
   * Creates a secondary account for testing purposes.
   *
   * @returns Object containing the new account id and its private key
   */
  private async createSecondAccount() {
    const accountKey = PrivateKey.generateED25519();
    const accountCreateTx = await new AccountCreateTransaction()
      .setKeyWithoutAlias(accountKey.publicKey)
      .setInitialBalance(new Hbar(1))
      .execute(this.client);

    const receipt = await accountCreateTx.getReceipt(this.client);
    return { accountId: receipt.accountId!, accountKey };
  }

  /**
   * Executes a crypto and token transfer between two accounts.
   *
   * @param tokenId - Token to transfer
   * @param senderId - Sender account ID
   * @param recipientId - Recipient account ID
   */
  private async executeCryptoTransfer(tokenId: TokenId, senderId: AccountId, recipientId: AccountId) {
    const amount = Hbar.from(1, HbarUnit.Tinybar);

    const cryptoTransfer = new TransferTransaction();
    cryptoTransfer
      .addHbarTransfer(senderId, amount.negated())
      .addHbarTransfer(recipientId, amount)
      .addTokenTransfer(tokenId, this.operatorId, -1)
      .addTokenTransfer(tokenId, recipientId, 1);
    await cryptoTransfer.execute(this.client);
  }

  /**
   * Creates a fungible token for testing transfers.
   *
   * @returns The created token id
   */
  private async createToken() {
    const tokenCreateTx = await new TokenCreateTransaction()
      .setTokenName('TransactionsTests')
      .setTokenSymbol('TT')
      .setTokenType(TokenType.FungibleCommon)
      .setDecimals(6)
      .setInitialSupply(1_000_000_000)
      .setTreasuryAccountId(this.operatorId)
      .setSupplyType(TokenSupplyType.Infinite)
      .execute(this.client);
    const tokenCreateReceipt = await tokenCreateTx.getReceipt(this.client);
    return tokenCreateReceipt.tokenId!;
  }
}
