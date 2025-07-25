// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import crypto from 'crypto';

import { ConfigService } from '../../../src/services';
import { LoggerService } from '../../../src/services/loggerService';

chai.use(chaiAsPromised);

describe('LoggerService tests', async function () {
  it('should be able to mask sensitive information', async () => {
    for (const sensitiveField of LoggerService.SENSITIVE_FIELDS) {
      const hex = crypto.randomBytes(32).toString('hex');
      const res = LoggerService.maskUpEnv(sensitiveField, hex);
      expect(res).to.equal(`${sensitiveField} = **********`);
    }
  });

  it('should be able to return plain information', async () => {
    const envName = 'CHAIN_ID';
    const res = ConfigService.get(envName);

    expect(LoggerService.maskUpEnv(envName, res)).to.equal(`${envName} = ${res}`);
  });
});
