// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'child_process';
import { ethers } from 'hardhat';

/**
 * Runs a Hardhat deployment script on a specified network.
 *
 * @param network - The target network to deploy to
 * @param pathToScript - The file path to the deployment script
 * @param env - Optional environment variables to pass to the process
 * @returns Promise that resolves to the output string from the deployment process
 * @throws Error if the deployment process fails (non-zero exit code)
 */
export async function runHardhatScript(network: string, pathToScript: string, env?: Record<string, string>) {
  const deploymentProcess = spawn('npx', ['hardhat', 'run', pathToScript, '--network', network], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: process.cwd(),
    env: { ...process.env, ...env },
  });

  let output = '';
  let error = '';

  deploymentProcess.stdout.on('data', (data: Buffer) => {
    output += data.toString();
  });

  deploymentProcess.stderr.on('data', (data: Buffer) => {
    error += data.toString();
  });

  await new Promise((resolve, reject) => {
    deploymentProcess.on('close', (code: number) => {
      if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`Deployment failed with code ${code}: ${error}`));
      }
    });
  });

  return output;
}

export function getNetworkConfigs(network: string) {
  if (network === 'hedera') {
    if (
      !process.env.HEDERA_RPC_URL ||
      !process.env.HEDERA_PK ||
      !process.env.HEDERA_LZ_EID_V2 ||
      !process.env.HEDERA_LZ_ENDPOINT_V2
    ) {
      throw new Error('Missing required environment variables for Hedera network');
    }

    const networkProvider = new ethers.providers.JsonRpcProvider(process.env.HEDERA_RPC_URL);
    const networkSigner = new ethers.Wallet(process.env.HEDERA_PK, networkProvider);

    return {
      lzEID: process.env.HEDERA_LZ_EID_V2,
      lzEndpointV2: process.env.HEDERA_LZ_ENDPOINT_V2,
      networkProvider,
      networkSigner,
    };
  } else if (network === 'sepolia') {
    if (
      !process.env.SEPOLIA_RPC_URL ||
      !process.env.SEPOLIA_PK ||
      !process.env.SEPOLIA_LZ_EID_V2 ||
      !process.env.SEPOLIA_LZ_ENDPOINT_V2
    ) {
      throw new Error('Missing required environment variables for Sepolia network');
    }
    const networkProvider = new ethers.providers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
    const networkSigner = new ethers.Wallet(process.env.SEPOLIA_PK, networkProvider);

    return {
      lzEID: process.env.SEPOLIA_LZ_EID_V2,
      lzEndpointV2: process.env.SEPOLIA_LZ_ENDPOINT_V2,
      networkProvider,
      networkSigner,
    };
  } else {
    throw new Error(`Unsupported network: ${network}`);
  }
}

/**
 * Deploys a smart contract on the specified network.
 *
 * @param network - The target network for deployment ('hedera' or 'sepolia')
 * @param contractName - The name of the contract to deploy
 * @param params - Optional array of constructor parameters for the contract
 * @returns Promise that resolves to the deployed contract address
 * @throws Error if required environment variables are missing or network is unsupported
 */
export async function deployContractOnNetwork(network: string, contractName: string, params: any[] = []) {
  const { networkSigner } = getNetworkConfigs(network);

  console.log(`\nDeploying ${contractName} on ${network}...`);
  const ContractFactory = await ethers.getContractFactory(contractName, networkSigner);
  const contract = await ContractFactory.deploy(...params);
  await contract.deployed();

  console.log(`Deployed ${contractName} on ${network} at address: ${contract.address}`);
  return contract;
}

export async function setLZPeer(
  network: string,
  lzOappContractName: string,
  sourceAddress: string,
  targetAddress: string,
) {
  const { networkSigner } = getNetworkConfigs(network);
  const targetNetwork = network === 'hedera' ? 'sepolia' : 'hedera';
  const { lzEID } = getNetworkConfigs(targetNetwork);

  console.log(
    `\nSetting LZ peers on ${network} network: sourceAddress=${sourceAddress}, targetAddress=${targetAddress}, lzEID=${lzEID}...`,
  );
  const contract = await ethers.getContractAt(lzOappContractName, sourceAddress, networkSigner);
  const tx = await contract.setPeer(lzEID, '0x' + targetAddress.substring(2, 42).padStart(64, '0'));
  const receipt = await tx.wait();

  if (!receipt.status) {
    process.exit('Execution of setPeer failed. Tx hash: ' + tx.hash);
  }

  console.log(`Peer for network with EID ${lzEID} was successfully set, txHash ${tx.hash}`);
  return receipt;
}
