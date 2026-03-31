// SPDX-License-Identifier: Apache-2.0

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ConfigService } = require('../../dist/services');

// @ts-ignore
ConfigService.getInstance();

process.exit();
