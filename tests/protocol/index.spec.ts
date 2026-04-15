// SPDX-License-Identifier: Apache-2.0

// Important! Load env variables before importing anything else
import path from 'node:path';

import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { registerAcceptanceSuite } from '../acceptance-runner';

registerAcceptanceSuite({ testDir: __dirname, wsServer: 'always' });
