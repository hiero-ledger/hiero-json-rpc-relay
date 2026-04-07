import {
    Client,
    PrivateKey,
    Hbar,
    AccountId,
    AccountBalanceQuery,
    AccountInfoQuery,
    TransferTransaction, TokenCreateTransaction, TokenAssociateTransaction,
} from "@hashgraph/sdk";

import dotenv from "dotenv";

dotenv.config();

let client;

/*
 * This script is for demonstration purposes only and should only be run from a secure enviroment. It will print the
 * private key to the output. This should not be run on mainnet as it could put assets at risk.
 */

async function main() {

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

    //Create token to be transferred into new accounts
    let resp = await new TokenCreateTransaction()
        .setTokenName("demo")
        .setTokenSymbol("D")
        .setDecimals(3)
        .setInitialSupply(100000)
        .setTreasuryAccountId(client.operatorAccountId)
        .setAdminKey(client.operatorPublicKey)
        .setSupplyKey(client.operatorPublicKey)
        .setFreezeDefault(false)
        .execute(client);

    const tokenId = (await resp.getReceipt(client)).tokenId;

    //Create two accounts and transfer tokens into them
    for (let i=0; i<2; i++) {
        const accountNumber = i+1;
        console.log(`Account ${accountNumber} Details:`);
        const accountId = await createAccountAndAssociate(tokenId);
        await (
            await new TransferTransaction()
                .addTokenTransfer(tokenId, client.operatorAccountId, -10000)
                .addTokenTransfer(tokenId, accountId, 10000)
                .execute(client)
        ).getReceipt(client);

        console.log(
            `  Sent 10 tokens from account ${client.operatorAccountId.toString()} to account ${accountId.toString()} on token ${tokenId.toString()}`
        );

        const balance = await new AccountBalanceQuery()
            .setAccountId(accountId)
            .execute(client);

        console.log(`  Balances of the new account: ${balance.toString()}\n`);
    }

    console.log(`Token Details:`);
    console.log(`  Token ID: ${tokenId}`);
    console.log(`  Ethereum Token Address (use this for token import): 0x${tokenId.toSolidityAddress()}\n`);
    console.log("Example complete!");
    client.close();
}

async function createAccountAndAssociate(tokenId) {
    console.log('  "Creating" a new account');

    const privateKey = PrivateKey.generateECDSA();
    const publicKey = privateKey.publicKey;

    // Assuming that the target shard and realm are known.
    // For now they are virtually always 0 and 0.
    const aliasAccountId = publicKey.toAccountId(0, 0);

    /*
     * Note that no queries or transactions have taken place yet.
     * This account "creation" process is entirely local.
     */

    const hbarAmount = new Hbar(10);
    console.log(`  Transferring ${hbarAmount} to the new account`);
    const response = await new TransferTransaction()
        .addHbarTransfer(client.operatorAccountId, hbarAmount.negated())
        .addHbarTransfer(aliasAccountId, new Hbar(10))
        .execute(client);
    await response.getReceipt(client);

    const info = await new AccountInfoQuery()
        .setAccountId(aliasAccountId)
        .execute(client);

    console.log(`  The normal account ID: ${info.accountId.toString()}`);
    console.log(`  The aliased account ID: 0.0.${info.aliasKey.toString()}`);
    console.log(`  The private key (use this in sdk/Hedera native wallets): ${privateKey.toString()}`);
    console.log(`  The raw private key (use this for JSON RPC wallet import): ${privateKey.toStringRaw()}`);

    //Associate account with token
    await (
        await (
            await new TokenAssociateTransaction()
                .setAccountId(info.accountId)
                .setTokenIds([tokenId])
                .freezeWith(client)
                .sign(privateKey)
        ).execute(client)
    ).getReceipt(client);

    console.log(`  Associated account ${info.accountId} with token ${tokenId.toString()}`);

    return info.accountId;
}

void main();
