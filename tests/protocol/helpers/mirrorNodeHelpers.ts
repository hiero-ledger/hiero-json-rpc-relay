// SPDX-License-Identifier: Apache-2.0

import MirrorClient from '../../server/clients/mirrorClient';

/**
 * Resolves long-zero addresses to EVM addresses by querying mirror node.
 *
 * @param mirrorNode - MirrorClient used to look up account metadata.
 * @param tx - Transaction object with `from` and `to` fields (long-zero or EVM format).
 * @returns Object containing the resolved EVM addresses, falling back to the original values.
 */
export const resolveAccountEvmAddresses = async (
  mirrorNode: MirrorClient,
  tx: { from: string; to: string },
): Promise<{ from: string; to: string }> => {
  const fromAccountInfo = await mirrorNode.get(`/accounts/${tx.from}`);
  const toAccountInfo = await mirrorNode.get(`/accounts/${tx.to}`);
  return {
    from: fromAccountInfo?.evm_address ?? tx.from,
    to: toAccountInfo?.evm_address ?? tx.to,
  };
};
