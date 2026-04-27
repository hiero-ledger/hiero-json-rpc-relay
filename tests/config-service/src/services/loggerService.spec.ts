// SPDX-License-Identifier: Apache-2.0

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import crypto from 'crypto';

import { ConfigService } from '../../../../src/config-service/services';
import { LoggerService } from '../../../../src/config-service/services/loggerService';

chai.use(chaiAsPromised);

describe('LoggerService tests', async function () {
  it('should be able to mask sensitive information', async () => {
    LoggerService.SENSITIVE_FIELDS_MAP.forEach((value, key) => {
      if (value === true) {
        const res = LoggerService.maskUpEnv(key, crypto.randomBytes(32).toString('hex'));
        expect(res).to.equal(`${key} = **********`);
      }
    });
  });

  it('should be able to return plain information', async () => {
    const envName = 'CHAIN_ID';
    const res = ConfigService.get(envName);

    expect(LoggerService.maskUpEnv(envName, res)).to.equal(`${envName} = ${res}`);
  });

  it('should mask private keys in PAYMASTER_ACCOUNTS', async () => {
    const paymaster0 = [
      '0.0.801',
      'HEX_ECDSA',
      '0x1111111111111111111111111111111111111111111111111111111111111111',
      '300',
    ];
    const paymaster1 = [
      '0.0.802',
      'HEX_ECDSA',
      '0x2222222222222222222222222222222222222222222222222222222222222222',
      '200',
    ];
    const res = LoggerService.maskUpEnv('PAYMASTER_ACCOUNTS', [paymaster0, paymaster1]);

    expect(res).to.contain(paymaster0[0]);
    expect(res).to.contain(paymaster1[0]);
    expect(res).to.contain(paymaster0[3]);
    expect(res).to.contain(paymaster1[3]);

    expect(res.match(/\*{10}/g).length).to.equal(2);
    expect(res.match(/HEX_ECDSA/g).length).to.equal(2);
    expect(res).to.not.contain(paymaster0[2]);
    expect(res).to.not.contain(paymaster1[2]);
  });
});
