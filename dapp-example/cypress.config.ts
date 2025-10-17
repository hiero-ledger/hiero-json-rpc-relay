import { defineConfig } from 'cypress';
import { configureSynpressForMetaMask } from '@synthetixio/synpress/cypress';

export default defineConfig({
  userAgent: 'synpress',
  chromeWebSecurity: true,
  viewportWidth: 1024,
  viewportHeight: 768,
  video: false,
  screenshotOnRunFailure: false,
  defaultCommandTimeout: 180000,
  pageLoadTimeout: 40000,
  requestTimeout: 40000,
  responseTimeout: 50000,
  taskTimeout: 60000,
  env: {
    coverage: false,
  },
  retries: {
    runMode: 3,
    openMode: 0,
  },
  e2e: {
    baseUrl: 'http://localhost:3000',
    specPattern: 'tests/e2e/specs/**/*.{js,jsx,ts,tsx}',
    supportFile: 'tests/e2e/support.js',
    testIsolation: false, // Important for reusing the cached browser context
    setupNodeEvents(on, config) {
      return configureSynpressForMetaMask(on, config);
    },
  },
  reporter: 'cypress-multi-reporters',
  reporterOptions: {
    reporterEnabled: 'spec, mocha-junit-reporter',
    mochaJunitReporterOptions: {
      includePending: true,
    },
  },
});
