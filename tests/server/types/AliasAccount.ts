// SPDX-License-Identifier: Apache-2.0

import { type AccountId, type KeyList, type PrivateKey } from '@hashgraph/sdk';
import { type ethers } from 'ethers';

import type ServicesClient from '../clients/servicesClient';

export interface AliasAccount {
  readonly alias: AccountId;
  readonly accountId: AccountId;
  readonly address: string;
  readonly client: ServicesClient;
  readonly privateKey: PrivateKey;
  readonly wallet: ethers.Wallet;
  readonly keyList: KeyList | undefined;
}
