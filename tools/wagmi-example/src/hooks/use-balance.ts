// SPDX-License-Identifier: Apache-2.0

import { useAccount, useBalance } from 'wagmi';

function calculateBalance(value: BigInt, decimals: number) {
  return Number(value) / 10 ** decimals;
}

export function useAccountBalance() {
  const { address } = useAccount();

  const { data } = useBalance({ address });

  const balance = data && calculateBalance(data.value, data.decimals);

  return { balance };
}
