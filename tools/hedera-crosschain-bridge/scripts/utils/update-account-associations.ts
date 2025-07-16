// SPDX-License-Identifier: Apache-2.0
import { AccountId, AccountUpdateTransaction, Client, PrivateKey } from '@hashgraph/sdk';
import hre, { ethers } from 'hardhat';

function extractHederaNetworkByChainId(chainId: number): string {
  switch (chainId) {
    case 295:
      return 'mainnet';
    case 296:
      return 'testnet';
    case 297:
      return 'previewnet';
    default:
      throw Error('Unsupported Hedera network.');
  }
}

function calculateUpdatedAssociations(currentAssociations: number): number {
  if (currentAssociations == -1) return -1;
  if (currentAssociations == 0) return 20;
  if (currentAssociations > 0) return currentAssociations + 20;
}

export async function main() {
  const network = hre.network;
  const [deployer] = await ethers.getSigners();

  const hederaNetworkName = extractHederaNetworkByChainId(await deployer.getChainId());
  const client = Client.forName(hederaNetworkName);
  const accountQueryUrl = `https://${client._mirrorNetwork._network.keys().next().value}/api/v1/accounts/${
    deployer.address
  }`;
  const accountInfo = await (await fetch(accountQueryUrl)).json();
  const accountId: AccountId = AccountId.fromString(accountInfo.account);
  const privateKey: PrivateKey = PrivateKey.fromStringECDSA(network.config.accounts[0]);
  client.setOperator(accountId, privateKey);

  console.log(
    `\nBumping "Max. Auto. Associations" with 20 for account ${accountId.toString()} on Hedera ${hederaNetworkName}...`,
  );
  const signedTx = await new AccountUpdateTransaction()
    .setMaxAutomaticTokenAssociations(calculateUpdatedAssociations(accountInfo.max_automatic_token_associations))
    .setAccountId(accountId)
    .freezeWith(client)
    .sign(privateKey);
  const txResponse = await signedTx.execute(client);
  const receipt = await txResponse.getReceipt(client);

  if (receipt.status._code == 22) {
    console.log('🎉 The account has been successfully updated.');
  } else {
    throw Error(
      `The account update transaction returned status ${receipt.status._code} which is different than SUCCESS (22).`,
    );
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
