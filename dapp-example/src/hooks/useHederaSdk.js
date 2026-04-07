import { AccountId, AccountInfoQuery,Client, Hbar, PublicKey, TransferTransaction } from '@hashgraph/sdk';
import { ethers } from 'ethers';
import React from 'react';

const client = Client.forTestnet();

const useHederaSdk = () => {
  const recoveredPublicKeyToAccountId = (publicKey) => {
    const compressed = ethers.SigningKey.computePublicKey(ethers.getBytes(publicKey), true);

    return PublicKey.fromString(compressed).toAccountId(0, 0);
  };

  const transferHbarsToAccount = async (operatorId, operatorPrivateKey, amount, accountId) => {
    client.setOperator(operatorId, operatorPrivateKey);

    const transferTransaction = await new TransferTransaction()
      .addHbarTransfer(client.operatorAccountId, new Hbar(amount).negated())
      .addHbarTransfer(accountId, new Hbar(amount))
      .execute(client);

    return transferTransaction.getReceipt(client);
  };

  const getAccountInfo = async (evmAddress) => {
    return new AccountInfoQuery({ accountId: AccountId.fromEvmAddress(0, 0, evmAddress) }).execute(client);
  };

  return {
    recoveredPublicKeyToAccountId,
    transferHbarsToAccount,
    getAccountInfo,
  };
};

export default useHederaSdk;
