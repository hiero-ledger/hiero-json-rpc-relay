# Hedera Hardhat Viem Example Project

This Hedera Hardhat Viem Example Project offers boilerplate code for testing and deploying smart contracts via Hardhat with Viem. It includes configuration for both community-hosted and local ([Hedera Local Node](https://github.com/hashgraph/hedera-local-node)) instances of the [Hedera JSON RPC Relay](https://github.com/hiero-ledger/hiero-json-rpc-relay). 

:fire: Check out the step-by-step tutorial [here](https://docs.hedera.com/hedera/tutorials/smart-contracts/deploy-a-smart-contract-using-hardhat-and-hedera-json-rpc-relays).

# Viem vs Ethers.js Comparison

This comparison aims to assist developers in selecting the most suitable library for their specific project requirements. For further information about Viem, please visit [https://viem.sh/docs/introduction](https://viem.sh/docs/introduction).

| Feature               | Viem                                                                 | Ethers.js                               |
|-----------------------|----------------------------------------------------------------------|-----------------------------------------|
| Performance           | [Optimized for speed](https://viem.sh/docs/introduction#performance) | Reliable performance                    |
| API Design            | Intuitive, developer-friendly                                        | Well-designed, widely used              |
| Documentation         | Comprehensive and clear                                              | Good, but may vary by feature           |
| Debugging             | Advanced debugging tools                                             | Standard debugging capabilities         |
| Ecosystem Integration | Seamless integration with certain tools                              | Broad integration with many tools       |

Viem already includes out-of-the-box configuration for Hedera public networks: [testnet, mainnet, and previewnet](https://github.com/wevm/viem/blob/cc105f801ec69640d3d806d86b35e36002d8c912/src/chains/index.ts#L113-L115).

## Project Files and Folders

- `hardhat.config.js` - This is the configuration file for your Hardhat project development environment. It centralizes and defines various settings like Hedera networks, Solidity compiler versions, plugins, and tasks.

- `/contracts` - This folder holds all the Solidity smart contract files that make up the core logic of your dApp. Contracts are written in `.sol` files.

- `/test` - This folder contains test scripts that help validate your smart contracts' functionality. These tests are crucial for ensuring that your contracts behave as expected.
  
-  `/scripts` - This folder contains essential JavaScript files for tasks such as deploying smart contracts to the Hedera network. 

- `.env.example` - This file is contains the environment variables needed by the project. Copy this file to a `.env` file and fill in the actual values before starting the development server or deploying smart contracts. To expedite your test setup and deployment, some variables are pre-filled in this example file.

## Setup

1. Clone this repo to your local machine:

```shell
git clone https://github.com/hiero-ledger/hiero-json-rpc-relay.git
```

2. Once you've cloned the repository, open your IDE terminal and navigate to the root directory of the project:

```shell
cd hiero-json-rpc-relay/tools/hardhat-viem-example
```

3. Run the following command to install all the necessary dependencies:

```shell
npm install
```

4. Get your Hedera testnet account hex encoded private key from the [Hedera Developer Portal](https://portal.hedera.com/register) and update the `.env.example` `TESTNET_OPERATOR_PRIVATE_KEY`

5. Copy `.env.example` to `.env`

6. Run the test script from the root directory of the project. The default network is set to "local."

```shell
# runs test on default network
npx hardhat test

# runs test on testnet 
npx hardhat test --network testnet
```

Expect an output similar to the following:
```shell
  RPC
The address 0xe0b73F64b0de6032b193648c08899f20b5A6141D has 10000000000000000000000 weibars
    ✔ should be able to get the account balance (1678ms)
Greeter deployed to: 0xD9d0c5C0Ff85758BdF05A7636F8036d4D065F5B6
    ✔ should be able to deploy a contract (11456ms)
Contract call result: initial_msg
    ✔ should be able to make a contract view call (1249ms)
Updated call result: updated_msg
Contract call result: updated_msg
    ✔ should be able to make a contract call (6806ms)


  4 passing (22s)
```

7. Run the following command to deploy the smart contract. 
```shell
# deploys to the default network
npx hardhat deploy-contract

# deploys to testnet
npx hardhat deploy-contract --network testnet
```

# Contributing
Contributions are welcome. Please see the
[contributing guide](https://github.com/hashgraph/.github/blob/main/CONTRIBUTING.md)
to see how you can get involved.

# Code of Conduct
This project is governed by the
[Contributor Covenant Code of Conduct](https://github.com/hashgraph/.github/blob/main/CODE_OF_CONDUCT.md). By
participating, you are expected to uphold this code of conduct. Please report unacceptable behavior
to [oss@hedera.com](mailto:oss@hedera.com).

# License
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
