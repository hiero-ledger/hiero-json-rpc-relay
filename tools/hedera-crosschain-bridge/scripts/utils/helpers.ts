// SPDX-License-Identifier: Apache-2.0
/**
 * Retrieves the network configuration for the specified network.
 *
 * @param network - The name of the network (e.g., 'hedera', 'sepolia').
 * @returns An object containing optional `blockExplorerUrl` and `lzEndpointAddress` properties for the given network,
 *          or `undefined` if the network is not found.
 */
export const getNetworkConfigs = (network: string) => {
  // Map network to config
  const networkConfig: Record<string, { blockExplorerUrl?: string; lzEndpointAddress?: string; lzEid?: string }> = {
    hedera: {
      blockExplorerUrl: process.env.HEDERA_BLOCK_EXPLORER_URL,
      lzEndpointAddress: process.env.HEDERA_LZ_ENDPOINT_V2,
      lzEid: process.env.HEDERA_LZ_EID_V2,
    },
    sepolia: {
      blockExplorerUrl: process.env.SEPOLIA_BLOCK_EXPLORER_URL,
      lzEndpointAddress: process.env.SEPOLIA_LZ_ENDPOINT_V2,
      lzEid: process.env.SEPOLIA_LZ_EID_V2,
    },
  };

  return networkConfig[network];
};

/**
 * Creates an execution summary with raw values table and optional block explorer links table
 * @param data - Array of data items with key, value, and optional explorer type
 * @param blockExplorerUrl - Block explorer base URL (optional)
 */
export const logExecutionSummary = (
  data: Array<{
    key: string;
    value: string;
    explorerType?: 'address' | 'tx';
  }>,
  blockExplorerUrl?: string,
) => {
  // Always show the raw values table
  console.log('Execution Summary:');
  const rawValuesTable = data.reduce(
    (acc, { key, value }) => {
      acc[key] = value;
      return acc;
    },
    {} as Record<string, string>,
  );
  console.table(rawValuesTable);

  // Show block explorer links table only if blockExplorerUrl is available
  if (blockExplorerUrl) {
    const explorerItems = data.filter((item) => item.explorerType);
    if (explorerItems.length > 0) {
      console.log('\nBlock Explorer Links:');
      const explorerTable = explorerItems.reduce(
        (acc, { key, value, explorerType }) => {
          acc[key] = `${blockExplorerUrl}/${explorerType}/${value}`;
          return acc;
        },
        {} as Record<string, string>,
      );
      console.table(explorerTable);
    }
  }
};
