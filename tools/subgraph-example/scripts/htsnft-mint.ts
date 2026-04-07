// SPDX-License-Identifier: Apache-2.0

import {
  TokenId,
  Client,
  LocalProvider,
  Wallet,
  TokenMintTransaction,
} from "@hashgraph/sdk";

export async function mintHtsNft(receiver: string, hre: any) {
  const networks = await import("../subgraph/networks.json");

  const wallet = new Wallet(
    process.env.OPERATOR_ID!,
    process.env.OPERATOR_KEY!,
    new LocalProvider({
      client: Client.forNetwork(JSON.parse(process.env.HEDERA_NETWORK!)),
    }),
  );
  const tokenId = TokenId.fromSolidityAddress(
    networks.default.local.ExampleHTSNFT.address,
  );

  const mintTx = new TokenMintTransaction()
    .setTokenId(tokenId)
    .setMetadata([Buffer.from("2")])
    .freezeWithSigner(wallet);
  let mintTxSign = await (await mintTx).signWithSigner(wallet);
  const mintTxRecipe = await (
    await mintTxSign.executeWithSigner(wallet)
  ).getReceiptWithSigner(wallet);
  console.log(
    `HTS NFT Token mint has status: ${mintTxRecipe.status.toString()}`,
  );
}
