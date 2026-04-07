// SPDX-License-Identifier: Apache-2.0

require('dotenv').config();
require('@nomicfoundation/hardhat-toolbox');
const CONSTANTS = require('./test/constants');

module.exports = {
  solidity: {
    compilers: [
      {
        version: '0.8.22',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      }
    ]
  },
  defaultNetwork: 'hedera_testnet',
  networks: {
    hedera_testnet: {
      url: 'https://testnet.hashio.io/api',
      accounts: [process.env.HEDERA_PK],
      chainId: 296
    },
    bsc_testnet: {
      url: 'https://data-seed-prebsc-1-s1.binance.org:8545',
      chainId: 97,
      gasPrice: 20000000000,
      accounts: [process.env.BSC_PK]
    }
  }
};

const getEndpointAddress = (network) => {
  let ENDPOINT_V2;

  // we're using the official LZ endpoints
  // a list of all endpoint addresses can be found here https://docs.layerzero.network/v2/developers/evm/technical-reference/deployed-contracts
  if (network === 'hedera_testnet') {
    ENDPOINT_V2 = '0xbD672D1562Dd32C23B563C989d8140122483631d';
  } else if (network === 'bsc_testnet') {
    ENDPOINT_V2 = '0x6EDCE65403992e310A62460808c4b910D972f10f';
  }

  return ENDPOINT_V2;
};

task('deploy-whbar', 'Deploy WHBAR')
  .setAction(async (taskArgs, hre) => {
    const contractFactory = await ethers.getContractFactory('WHBAR');
    const contract = await contractFactory.deploy();
    await contract.deployTransaction.wait();

    console.log(`(${hre.network.name}) WHBAR to ${contract.address} txHash ${contract.deployTransaction.hash}`);
  });

task('deploy-erc20', 'Deploy ERC20 token')
  .addParam('mint', 'Initial mint')
  .addParam('decimals', 'Decimals')
  .setAction(async (taskArgs, hre) => {
    const contractFactory = await ethers.getContractFactory('ERC20Mock');
    const contract = await contractFactory.deploy(taskArgs.mint, taskArgs.decimals);
    await contract.deployTransaction.wait();

    console.log(`(${hre.network.name}) ERC20 deployed to ${contract.address} txHash ${contract.deployTransaction.hash}`);
  });

task('deploy-erc721', 'Deploy ERC721 token')
  .setAction(async (taskArgs, hre) => {
    const contractFactory = await ethers.getContractFactory('ERC721Mock');
    const contract = await contractFactory.deploy();
    await contract.deployTransaction.wait();

    console.log(`(${hre.network.name}) ERC721 deployed to ${contract.address} txHash ${contract.deployTransaction.hash}`);
  });

task('deploy-oapp', 'Deploy OApp contract')
  .setAction(async (taskArgs, hre) => {
    const ethers = hre.ethers;
    const signers = await ethers.getSigners();
    const ENDPOINT_V2 = getEndpointAddress(hre.network.name);

    const contractFactory = await ethers.getContractFactory('ExampleOApp');
    const contract = await contractFactory.deploy(ENDPOINT_V2, signers[0].address);
    await contract.deployTransaction.wait();

    console.log(`(${hre.network.name}) ExampleOApp deployed to ${contract.address} txHash ${contract.deployTransaction.hash}`);
  });

task('deploy-oft', 'Deploy OFT contract')
  .addParam('mint', 'Initial mint')
  .addParam('decimals', 'Decimals')
  .setAction(async (taskArgs, hre) => {
    const ethers = hre.ethers;
    const signers = await ethers.getSigners();
    const ENDPOINT_V2 = getEndpointAddress(hre.network.name);

    const contractFactory = await ethers.getContractFactory('ExampleOFT');
    const contract = await contractFactory.deploy('T_NAME', 'T_SYMBOL', ENDPOINT_V2, signers[0].address, taskArgs.mint, taskArgs.decimals);
    await contract.deployTransaction.wait();

    console.log(`(${hre.network.name}) ExampleOFT deployed to ${contract.address} txHash ${contract.deployTransaction.hash}`);
  });

task('deploy-hts-connector', 'Deploy HTS connector contract')
  .setAction(async (taskArgs, hre) => {
    const ethers = hre.ethers;
    const signers = await ethers.getSigners();
    const ENDPOINT_V2 = getEndpointAddress(hre.network.name);

    const contractFactory = await ethers.getContractFactory('ExampleHTSConnector');
    const contract = await contractFactory.deploy('T_NAME', 'T_SYMBOL', ENDPOINT_V2, signers[0].address, {
      gasLimit: 10_000_000,
      value: '30000000000000000000' // 30 hbars
    });
    await contract.deployTransaction.wait();

    console.log(`(${hre.network.name}) ExampleHTSConnector deployed to ${contract.address} txHash ${contract.deployTransaction.hash}`);
  });

task('deploy-hts-connector-existing-token', 'Deploy HTS connector for existing token contract')
  .addParam('token', 'Already existing token address')
  .setAction(async (taskArgs, hre) => {
    const ethers = hre.ethers;
    const signers = await ethers.getSigners();
    const ENDPOINT_V2 = getEndpointAddress(hre.network.name);

    const contractFactory = await ethers.getContractFactory('ExampleHTSConnectorExistingToken');
    const contract = await contractFactory.deploy(taskArgs.token, ENDPOINT_V2, signers[0].address, {
      gasLimit: 10_000_000,
    });
    await contract.deployTransaction.wait();

    console.log(`(${hre.network.name}) ExampleHTSConnectorExistingToken deployed to ${contract.address} txHash ${contract.deployTransaction.hash}`);
  });

task('create-hts-token', 'Create a HTS token')
  .setAction(async (taskArgs, hre) => {
    const ethers = hre.ethers;
    const signers = await ethers.getSigners();

    const contractFactory = await ethers.getContractFactory('CreateHTS');
    const contract = await contractFactory.deploy('T_NAME', 'T_SYMBOL', signers[0].address, {
      gasLimit: 10_000_000,
      value: '30000000000000000000' // 30 hbars
    });
    await contract.deployTransaction.wait();

    console.log(`(${hre.network.name}) Token address ${await contract.htsTokenAddress()} contract address ${contract.address} txHash ${contract.deployTransaction.hash}`);
  });

task('deploy-oft-adapter', 'Deploy OFT adapter contract')
  .addParam('token', 'Token address')
  .setAction(async (taskArgs, hre) => {
    const ethers = hre.ethers;
    const signers = await ethers.getSigners();
    const ENDPOINT_V2 = getEndpointAddress(hre.network.name);

    const contractFactory = await ethers.getContractFactory('ExampleOFTAdapter');
    const contract = await contractFactory.deploy(taskArgs.token, ENDPOINT_V2, signers[0].address);
    await contract.deployTransaction.wait();

    console.log(`(${hre.network.name}) ExampleOFTAdapter for token ${taskArgs.token} deployed to ${contract.address} txHash ${contract.deployTransaction.hash}`);
  });

task('deploy-onft', 'Deploy OFT contract')
  .setAction(async (taskArgs, hre) => {
    const ethers = hre.ethers;
    const signers = await ethers.getSigners();
    const ENDPOINT_V2 = getEndpointAddress(hre.network.name);

    let tokenId;
    if (hre.network.name === 'hedera_testnet') {
      tokenId = 1;
    } else if (hre.network.name === 'bsc_testnet') {
      tokenId = 2;
    }

    const contractFactory = await ethers.getContractFactory('ExampleONFT');
    const contract = await contractFactory.deploy('T_NAME', 'T_SYMBOL', ENDPOINT_V2, signers[0].address, tokenId);
    await contract.deployTransaction.wait();

    console.log(`(${hre.network.name}) ExampleONFT deployed to ${contract.address} txHash ${contract.deployTransaction.hash}`);
  });

task('deploy-onft-adapter', 'Deploy OFT contract')
  .addParam('token', 'Token address')
  .setAction(async (taskArgs, hre) => {
    const ethers = hre.ethers;
    const signers = await ethers.getSigners();
    const ENDPOINT_V2 = getEndpointAddress(hre.network.name);

    const contractFactory = await ethers.getContractFactory('ExampleONFTAdapter');
    const contract = await contractFactory.deploy(taskArgs.token, ENDPOINT_V2, signers[0].address);
    await contract.deployTransaction.wait();

    console.log(`(${hre.network.name}) ExampleONFTAdapter deployed to ${contract.address} txHash ${contract.deployTransaction.hash}`);
  });

task('set-peer', 'Set peer')
  .addParam('source', 'Source contract address')
  .addParam('target', 'Target contract address')
  .setAction(async (taskArgs, hre) => {
    const ethers = hre.ethers;

    let EID;
    if (hre.network.name === 'hedera_testnet') {
      EID = CONSTANTS.BSC_EID;
    } else if (hre.network.name === 'bsc_testnet') {
      EID = CONSTANTS.HEDERA_EID;
    }

    const contract = await ethers.getContractAt('ExampleOApp', taskArgs.source);
    const tx = await contract.setPeer(EID, '0x' + taskArgs.target.substring(2, 42).padStart(64, 0));
    const receipt = await tx.wait();

    if (!receipt.status) {
      process.exit('Execution of setPeer failed. Tx hash: ' + tx.hash);
    }

    console.log(`(${hre.network.name}) Peer for network with EID ${EID} was successfully set, txHash ${tx.hash}`);
  });
