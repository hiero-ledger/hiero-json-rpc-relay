// SPDX-License-Identifier: Apache-2.0

require('dotenv').config();
require('@nomicfoundation/hardhat-toolbox');
const SDK = require('@hashgraph/sdk');
const { fundECDSA, fundED25519, capitalizeFirstLetter } = require('./fund');

module.exports = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 500
      },
      evmVersion: 'cancun',
    }
  },
  mocha: {
    timeout: 3600000
  },
  defaultNetwork: process.env.NETWORK,
  networks: {
    hedera_mainnet: {
      url: 'https://mainnet.hashio.io/api',
      accounts: [process.env.ECDSA_HEX_PRIVATE_KEY],
      chainId: 295
    },
    hedera_testnet: {
      url: 'https://testnet.hashio.io/api',
      accounts: [process.env.ECDSA_HEX_PRIVATE_KEY],
      chainId: 296
    },
    hedera_previewnet: {
      url: 'https://previewnet.hashio.io/api',
      accounts: [process.env.ECDSA_HEX_PRIVATE_KEY],
      chainId: 297
    },
    bsc_testnet: {
      url: 'https://data-seed-prebsc-1-s1.binance.org:8545',
      chainId: 97,
      gasPrice: 20000000000,
      accounts: [process.env.ECDSA_HEX_PRIVATE_KEY]
    }
  }
};

task('deploy-whbar-multichain')
  .setAction(async (taskArgs, hre) => {
    const targetNetworks = process.env.MULTICHAIN_NETWORKS.split(',');

    const networksConfig = hre.config.networks;
    const existentNetworks = Object.keys(networksConfig).filter(el => targetNetworks.includes(el));
    if (existentNetworks.length !== targetNetworks.length) {
      throw Error('The network you passed is not defined in hardhat.config.js.');
    }

    const wallet = new ethers.Wallet(process.env.ECDSA_HEX_PRIVATE_KEY);
    const signerCrossChainInfo = {};
    for (const network of targetNetworks) {
      const provider = new ethers.JsonRpcProvider(
        networksConfig[network].url,
        new ethers.Network(network, networksConfig[network].chainId),
        { batchMaxSize: 1 }
      );

      signerCrossChainInfo[network] = {
        nonce: await provider.getTransactionCount(wallet.address),
        balance: await provider.getBalance(wallet.address)
      };
    }

    let signerNonce = Object.values(signerCrossChainInfo)[0].nonce;
    for (const info of Object.values(signerCrossChainInfo)) {
      if (info.nonce !== signerNonce) {
        console.log(signerCrossChainInfo);
        console.log('----- Nonces are not the same on all targeted networks.');
        throw Error('Nonces are not the same on all targeted networks.');
      }

      if (info.balance === 0n) {
        console.log(signerCrossChainInfo);
        console.log('-----  The signer doesnt have enough balance on some network to cover deployment gas.');
        throw Error('The signer doesnt have enough balance on some network to cover deployment gas.');
      }
    }

    if (process.env.INITIAL_BALANCE !== '0') {
      throw Error('The INITIAL_VALUE env var must be 0 for cross-chain deployment.');
    }

    for (const network of targetNetworks) {
      const provider = new ethers.JsonRpcProvider(
        networksConfig[network].url,
        new ethers.Network(network, networksConfig[network].chainId),
        { batchMaxSize: 1 }
      );

      const connectedWallet = wallet.connect(provider);
      const contractFactory = await ethers.getContractFactory('WHBAR', connectedWallet);
      const contract = await contractFactory.deploy();
      await contract.waitForDeployment();

      console.log(`(${network}) WHBAR deployed to: ` + contract.target);
    }
  });

task('deploy-whbar', 'Deploy WHBAR')
  .setAction(async (taskArgs, hre) => {
    const contractFactory = await ethers.getContractFactory('WHBAR');
    const contract = await contractFactory.deploy();
    await contract.waitForDeployment();

    console.log(`(${hre.network.name}) WHBAR deployed to: ` + contract.target);

    await fundECDSA(hre, Number(process.env.INITIAL_BALANCE), contract.target);
  });

task('deploy-whbar-using-ed25519-signer-key', 'Deploy WHBAR using ED25519 signer key')
  .setAction(async (taskArgs, hre) => {
    const networkName = hre.network.name.split('_')[1];
    const client = SDK.Client[`for${capitalizeFirstLetter(networkName)}`]();

    client.setOperator(process.env.ED25519_ACCOUNT_ID, SDK.PrivateKey.fromStringED25519(process.env.ED25519_HEX_PRIVATE_KEY));

    const { bytecode } = await hre.artifacts.readArtifact('WHBAR');

    const contractCreateTx = new SDK.ContractCreateFlow()
      .setBytecode(bytecode)
      .setGas(250_000);

    const contractCreateTxResponse = contractCreateTx.execute(client);
    const contractCreateReceipt = (await contractCreateTxResponse).getReceipt(client);
    const { contractId } = await contractCreateReceipt;

    console.log(`(${hre.network.name}) deployed WHBAR has id ${contractId}`);

    await fundED25519(hre, Number(process.env.INITIAL_BALANCE), contractId.toString());
  });
