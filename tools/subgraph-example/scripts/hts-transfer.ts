// SPDX-License-Identifier: Apache-2.0

import {
  AccountId,
  TokenId,
  Client,
  LocalProvider,
  Wallet,
  TokenAssociateTransaction,
  TransferTransaction,
  PrivateKey,
  ReceiptStatusError,
} from "@hashgraph/sdk";
import { ethers } from "ethers";

export async function transferHtsFT(receiver: string, hre: any) {
  const networks = await import("../subgraph/networks.json");

  const wallet = new Wallet(
    process.env.OPERATOR_ID!,
    process.env.OPERATOR_KEY!,
    new LocalProvider({
      client: Client.forNetwork(JSON.parse(process.env.HEDERA_NETWORK!)),
    }),
  );
  const account = new ethers.Wallet(receiver);
  const privateKey = PrivateKey.fromStringECDSA(account.privateKey);
  const tokenId = TokenId.fromSolidityAddress(
    networks.default.local.ExampleHTSFT.address,
  );
  const accountId = AccountId.fromString("0.0.1013");

  try {
    let associateTx = await new TokenAssociateTransaction()
      .setAccountId(accountId)
      .setTokenIds([tokenId])
      .freezeWithSigner(wallet);
    await associateTx.sign(privateKey);
    await (
      await (await associateTx.signWithSigner(wallet)).executeWithSigner(wallet)
    ).getReceiptWithSigner(wallet);
  } catch (error) {
    if (error instanceof ReceiptStatusError && error.status._code === 194) {
      console.log("Token already associated with account");
    } else {
      console.log(error);
    }
  }
  const transferTx = await (
    await (
      await (
        await new TransferTransaction()
          .addTokenTransfer(tokenId, wallet.getAccountId(), -10)
          .addTokenTransfer(tokenId, accountId, 10)
          .freezeWithSigner(wallet)
      ).signWithSigner(wallet)
    ).executeWithSigner(wallet)
  ).getReceiptWithSigner(wallet);

  console.log(`HTS Token transfer has status: ${transferTx.status.toString()}`);
}
