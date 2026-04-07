import {
    Client,
    PrivateKey,
    Hbar,
    AccountId,
    AccountBalanceQuery,
    AccountInfoQuery,
    TransferTransaction,
} from "@hashgraph/sdk";

import dotenv from "dotenv";

dotenv.config();

/*
 * This script is for demonstration purposes only and should only be run from a secure enviroment. It will print the
 * private key to the output. This should not be run on mainnet as it could put assets at risk.
 */

async function main() {
    let client;

    try {
        // Defaults the operator account ID and key such that all generated transactions will be paid for
        // by this account and be signed by this key
        client = Client.forName(process.env.HEDERA_NETWORK).setOperator(
            AccountId.fromString(process.env.OPERATOR_ID),
            PrivateKey.fromString(process.env.OPERATOR_KEY)
        );
    } catch (error) {
        throw new Error(
            "Environment variables HEDERA_NETWORK, OPERATOR_ID, and OPERATOR_KEY are required."
        );
    }

    /*
     * Hedera supports a form of lazy account creation.
     *
     * You can "create" an account by generating a private key, and then deriving the public key,
     * without any need to interact with the Hedera network.  The public key more or less acts as the user's
     * account ID.  This public key is an account's aliasKey: a public key that aliases (or will eventually alias)
     * to a Hedera account.
     *
     * An AccountId take on multiple forms. 2 notable mentions are 1.: a normal AccountId with a null aliasKey member takes the form 0.0.123,
     * while an account ID with a non-null aliasKey member takes the form
     * 0.0.302a300506032b6570032100114e6abc371b82dab5c15ea149f02d34a012087b163516dd70f44acafabf7777
     * Note the prefix of "0.0." indicating the shard and realm.  Also note that the aliasKey is stringified
     * as a hex-encoded ASN1 DER representation of the key.
     *
     * An AccountId with an aliasKey can be used just like a normal AccountId for the purposes of queries and
     * transactions, however most queries and transactions involving such an AccountId won't work until Hbar has
     * been transferred to the aliasKey account.
     *
     * There is no record in the Hedera network of an account associated with a given aliasKey
     * until an amount of Hbar is transferred to the account.  The moment that Hbar is transferred to that aliasKey
     * AccountId is the moment that that account actually begins to exist in the Hedera ledger.
     */

    console.log('"Creating" a new account');

    const privateKey = PrivateKey.generateECDSA();
    const publicKey = privateKey.publicKey;

    // Assuming that the target shard and realm are known.
    // For now they are virtually always 0 and 0.
    const aliasAccountId = publicKey.toAccountId(0, 0);

    /*
     * Note that no queries or transactions have taken place yet.
     * This account "creation" process is entirely local.
     */

    console.log("Transferring some Hbar to the new account");
    const response = await new TransferTransaction()
        .addHbarTransfer(client.operatorAccountId, new Hbar(10).negated())
        .addHbarTransfer(aliasAccountId, new Hbar(10))
        .execute(client);
    await response.getReceipt(client);

    const balance = await new AccountBalanceQuery()
        .setAccountId(aliasAccountId)
        .execute(client);

    console.log(`Balances of the new account: ${balance.toString()}`);

    const info = await new AccountInfoQuery()
        .setAccountId(aliasAccountId)
        .execute(client);

    /*
     * Note that once an account exists in the ledger, it is assigned a normal AccountId, which can be retrieved
     * via an AccountInfoQuery.
     *
     * Users may continue to refer to the account by its aliasKey AccountId, but they may also
     * now refer to it by its normal AccountId
     */

    console.log(`The normal account ID: ${info.accountId.toString()}`);
    console.log(`The aliased account ID: 0.0.${info.aliasKey.toString()}`);
    console.log(`The private key (use this in sdk/Hedera native wallets): ${privateKey.toString()}`);
    console.log(`The raw private key (use this for JSON RPC wallet import): ${privateKey.toStringRaw()}`);

    console.log("Example complete!");
    client.close();
}

void main();
