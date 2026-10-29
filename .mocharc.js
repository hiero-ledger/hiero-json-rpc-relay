'use strict';
module.exports = {
  'node-option': ['no-experimental-strip-types'],
  'forbid-only': Boolean(process.env.CI),
  color: true,
  'fail-zero': Boolean(process.env.CI),
  reporter: 'mocha-multi-reporters',
  'reporter-options': `configFile=${__filename}`,
  reporterEnabled: 'spec, xunit',
  xunitReporterOptions: {
    output: `${__dirname}/test-results.${process.pid}.xml`,
  },
};
