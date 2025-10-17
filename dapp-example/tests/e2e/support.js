import { synpressCommandsForMetaMask } from '@synthetixio/synpress/cypress/support';

// Optional: Error handling
Cypress.on('uncaught:exception', () => {
  return false;
});

synpressCommandsForMetaMask();
