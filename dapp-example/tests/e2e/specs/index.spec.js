import 'cypress-wait-until';
import * as bootstrapInfo from '../../../src/contracts/.bootstrapInfo.json';
import { ethers } from 'ethers';

describe('Test Core Hedera User Scenarios', function () {
  this.timeout(180000);

  const testTimeoutMs = 45000;
  const retries = 2;
  const hollowAccount1 = ethers.Wallet.createRandom();
  const hollowAccount2 = ethers.Wallet.createRandom();

  before(() => {
    cy.visit('http://localhost:3000');
    cy.wait(10000);
    cy.contains('Connect Account').click();
    cy.acceptMetamaskAccess().should('be.true');
    cy.switchToCypressWindow();

    // check the UI
    cy.get('#showAliasBtn').should('not.be.disabled');
    cy.get('#btnDeployContract').should('not.be.disabled');
    cy.get('#btnReadGreeting').should('not.be.disabled');
    cy.get('#btnUpdateGreeting').should('not.be.disabled');
  });

  beforeEach(() => {
    cy.visit('http://localhost:3000');
    cy.contains('Connect Account').click();
  });

  describe('Tests with normal account', function () {
    mandatoryTests();

    it('Deploy contract', { retries: retries }, function () {
      // deploy the contract
      cy.get('#btnDeployContract').should('not.be.disabled').click();

      //Adding cy.wait аs temporary fix due to issue in synpress library https://github.com/Synthetixio/synpress/issues/795
      cy.wait(10000);
      cy.confirmMetamaskTransaction();

      // test a view call
      cy.get('#btnReadGreeting').should('not.be.disabled').click();
      cy.waitUntil(() => cy.get('#contractViewMsg').should('have.text', ' Result: initial_msg '));

      // test a update call
      cy.get('#updateGreetingText').type('updated_text');
      cy.get('#btnUpdateGreeting').should('not.be.disabled').click();
      cy.wait(10000);
      cy.confirmMetamaskTransaction();
      cy.waitUntil(() => cy.get('#contractUpdateMsg').should('have.text', ' Updated text: updated_text '));

      // test the updated msg
      cy.get('#btnReadGreeting').should('not.be.disabled').click();
      cy.waitUntil(() => cy.get('#contractViewMsg').should('have.text', ' Result: updated_text '));
    }).timeout(testTimeoutMs);

    it('Create hollow account 1 via HTS Transfer transaction', { retries: retries }, function () {
      // test the HTS transfer
      console.log(`Transfering 1000 '${bootstrapInfo.HTS_ADDRESS}' HTS tokens to ${hollowAccount1}`);
      cy.get('#htsTokenAddressField').clear().type(bootstrapInfo.HTS_ADDRESS).trigger('change');
      cy.get('#htsReceiverAddressField').type(hollowAccount1.address);
      cy.get('#htsTokenAmountField').clear().type(1000).trigger('change');
      cy.get('#htsTokenTransferBtn').should('not.be.disabled').click();
      cy.wait(10000);
      cy.confirmMetamaskTransaction();

      cy.waitUntil(() => cy.get('#htsTokenMsg').should('have.text', ' Done '));
    }).timeout(testTimeoutMs);

    it('Transfer HBARs to hollow account 1', { retries: retries }, function () {
      cy.get('#sendHbarsToField').clear().type(hollowAccount1.address);
      cy.get('#sendHbarsAmountField').clear().type('10000000000000000').trigger('change');
      cy.get('#sendHbarsBtn').should('not.be.disabled').click();
      cy.wait(10000);
      cy.confirmMetamaskTransaction();

      cy.waitUntil(() => cy.get('#sendHbarMsg').should('have.text', ' Done '));
      cy.waitUntil(() => cy.get('#toBalanceAfterTransfer').should('have.text', ' Balance after transfer: 0.01 '));
    }).timeout(testTimeoutMs);

    it('Second Transfer HBARs to hollow account 1', { retries: retries }, function () {
      cy.get('#sendHbarsToField').clear().type(hollowAccount1.address);
      cy.get('#sendHbarsAmountField').clear().type('60000000000000000000').trigger('change');
      cy.get('#sendHbarsBtn').should('not.be.disabled').click();
      cy.wait(10000);
      cy.confirmMetamaskTransaction();

      cy.waitUntil(() => cy.get('#sendHbarMsg').should('have.text', ' Done '));
      cy.waitUntil(() => cy.get('#toBalanceAfterTransfer').should('have.text', ' Balance after transfer: 60.01 '));
    }).timeout(testTimeoutMs);

    it('Create hollow account 2 via HBARs transfer transaction in contract', { retries: retries }, function () {
      cy.get('#hollowAccountAddressField').clear().type(hollowAccount2.address);
      cy.get('#activateHollowAccountBtn').should('not.be.disabled').click();
      cy.wait(10000);
      cy.confirmMetamaskTransaction();

      cy.waitUntil(() => cy.get('#activateHollowAccountMsg').should('have.text', ' Done '));
    }).timeout(testTimeoutMs);
  });

  describe('Tests with hollow account created via TX', function () {
    mandatoryTests(hollowAccount1.signingKey.privateKey, 3, true);
  });

  describe('Tests with hollow account created via Contract', function () {
    mandatoryTests(hollowAccount2.signingKey.privateKey, 4, true);
  });

  function mandatoryTests(pkToImport = null, accountNumber = 1, shouldAssociateWithHTS = false) {
    if (pkToImport) {
      it('Should switch to hollow account', { retries: retries }, function () {
        cy.disconnectMetamaskWalletFromAllDapps();
        cy.importMetamaskAccount(pkToImport);
        cy.switchMetamaskAccount(accountNumber);

        cy.visit('http://localhost:3000');
        cy.contains('Connect Account').click();
        cy.acceptMetamaskAccess().should('be.true');
        cy.switchToCypressWindow();
      });
    }

    it('Show alias', { retries: retries }, function () {
      cy.get('#showAliasBtn').should('not.be.disabled').click();
      cy.confirmMetamaskSignatureRequest();
      cy.waitUntil(() => cy.get('#aliasField').invoke('text').should('have.length', 66));
    }).timeout(testTimeoutMs);

    const randomHollowAccountAddress = ethers.Wallet.createRandom().address;
    it('Transfer HBARs', { retries: retries }, function () {
      cy.get('#sendHbarsToField').clear().type(randomHollowAccountAddress);
      cy.get('#sendHbarsAmountField').clear().type('10000000000000000').trigger('change');
      cy.get('#sendHbarsBtn').should('not.be.disabled').click();
      cy.wait(15000);
      cy.confirmMetamaskTransaction();

      cy.waitUntil(() => cy.get('#sendHbarMsg').should('have.text', ' Done '));
    }).timeout(testTimeoutMs);

    if (shouldAssociateWithHTS) {
      it('Associate auto created account with HTS token 2', { retries: retries }, function () {
        console.log(`Associate with ${bootstrapInfo.HTS_SECOND_ADDRESS}`);
        cy.get('#htsTokenAssociateAddressField').clear().type(bootstrapInfo.HTS_SECOND_ADDRESS).trigger('change');
        cy.get('#htsTokenAssociateBtn').should('not.be.disabled').click();
        cy.wait(10000);
        cy.confirmMetamaskTransaction();

        cy.waitUntil(() => cy.get('#htsTokenAssociateMsg').should('have.text', ' Done '));
      }).timeout(testTimeoutMs);
    }
  }
});
