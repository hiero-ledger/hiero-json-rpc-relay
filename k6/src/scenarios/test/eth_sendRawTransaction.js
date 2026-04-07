// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';

import { TestScenarioBuilder } from '../../lib/common.js';
import { isNonErrorResponse, httpParams, getPayLoad } from './common.js';

const url = __ENV.RELAY_BASE_URL;

const methodName = 'eth_sendRawTransaction';
const { options, run } = new TestScenarioBuilder()
  .name(methodName) // use unique scenario name among all tests
  .request((testParameters, iteration, vuIndex, iterationByVu) => {
    // Ideal case: Each VU gets its own dedicated wallet for clean nonce ordering
    if (vuIndex < testParameters.wallets.length) {
      const selectedWallet = testParameters.wallets[vuIndex];
      const txIndex = iterationByVu % selectedWallet.signedTxs.length;
      const selectedTx = selectedWallet.signedTxs[txIndex];

      return http.post(url, getPayLoad(methodName, [selectedTx]), httpParams);
    }

    // Shared wallet mode: Multiple VUs share wallets using global iteration for uniqueness
    const walletIndex = vuIndex % testParameters.wallets.length;
    const selectedWallet = testParameters.wallets[walletIndex];
    const txIndex = iteration % selectedWallet.signedTxs.length;
    const selectedTx = selectedWallet.signedTxs[txIndex];

    return http.post(url, getPayLoad(methodName, [selectedTx]), httpParams);
  })
  .check(methodName, (r) => isNonErrorResponse(r))
  .testDuration('5s')
  .maxDuration(4000)
  .build();

export { options, run };
