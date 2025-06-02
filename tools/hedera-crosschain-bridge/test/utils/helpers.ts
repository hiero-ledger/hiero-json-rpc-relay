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

/**
 * Deploys a smart contract on the specified network.
 *
 * @param network - The target network for deployment ('hedera' or 'sepolia')
 * @param contractName - The name of the contract to deploy
 * @param params - Optional array of constructor parameters for the contract
 * @returns Promise that resolves to the deployed contract address
 * @throws Error if required environment variables are missing or network is unsupported
 */
export async function deployContractOnNetwork(
  network: string,
  contractName: string,
  params: any[] = [],
): Promise<string> {
  // Configure provider based on network
  let provider;
  let wallet;

  if (network === 'hedera') {
    if (!process.env.HEDERA_RPC_URL || !process.env.HEDERA_PK) {
      throw new Error('HEDERA_RPC_URL and HEDERA_PK environment variables are required for Hedera deployment');
    }
    provider = new ethers.providers.JsonRpcProvider(process.env.HEDERA_RPC_URL);
    wallet = new ethers.Wallet(process.env.HEDERA_PK, provider);
  } else if (network === 'sepolia') {
    if (!process.env.SEPOLIA_RPC_URL || !process.env.SEPOLIA_PK) {
      throw new Error('SEPOLIA_RPC_URL and SEPOLIA_PK environment variables are required for Sepolia deployment');
    }
    provider = new ethers.providers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
    wallet = new ethers.Wallet(process.env.SEPOLIA_PK, provider);
  } else {
    throw new Error(`Unsupported network: ${network}`);
  }

  console.log(`Deploying ${contractName} on ${network}...`);
  const ContractFactory = await ethers.getContractFactory(contractName, wallet);
  const contract = await ContractFactory.deploy(...params);
  await contract.deployed();

  console.log(`Deployed ${contractName} on ${network} at address: ${contract.address}`);
  return contract.address;
}
