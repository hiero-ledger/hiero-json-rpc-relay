// SPDX-License-Identifier: Apache-2.0

import { http, createConfig } from 'wagmi';
import { hedera, hederaTestnet } from 'wagmi/chains';
import { coinbaseWallet, injected } from 'wagmi/connectors';

export const config = createConfig({
  chains: [hederaTestnet, hedera],
  connectors: [injected(), coinbaseWallet()],
  transports: {
    [hederaTestnet.id]: http(),
    [hedera.id]: http(),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
