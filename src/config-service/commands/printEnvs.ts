// SPDX-License-Identifier: Apache-2.0

// Need to keep like this to load from compiled output
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ConfigService } = require('../../../dist/config-service/services');

// @ts-ignore
ConfigService.getInstance();

//eslint-disable-next-line n/no-process-exit
process.exit();
