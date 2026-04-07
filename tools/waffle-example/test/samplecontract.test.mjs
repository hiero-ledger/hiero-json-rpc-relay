// SPDX-License-Identifier: Apache-2.0

import { expect, use } from 'chai';
import dotenv from 'dotenv';
import { providers, Wallet } from 'ethers';
import { createFixtureLoader, deployContract, solidity } from 'ethereum-waffle';

import SampleContract from '../build/SampleContract.json' assert { type: "json" };

dotenv.config();
const { JsonRpcProvider } = providers;

use(solidity); // use mocha matchers

describe('RPC', () => {
    let loadFixture;
    let fixture;

    before(async () => {
        const provider = new JsonRpcProvider(process.env.RELAY_ENDPOINT);
        const wallet = new Wallet(process.env.OPERATOR_PRIVATE_KEY, provider);
        loadFixture = createFixtureLoader([wallet]);
        fixture = ([wallet]) => deployContract(wallet, SampleContract);
    });

    it('should emit event', async () => {
        const contract = await loadFixture(fixture);
        await expect(contract.emitEvent())
            .to.emit(contract, 'Notification')
            .withArgs("Hello world!");
    });

    it('should be reverted', async () => {
        const contract = await loadFixture(fixture);
        await expect(contract.revertableFunction()).to.be.reverted;
    });
});
