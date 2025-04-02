# Hedera Golang Example Project

This Hedera Golang Example Project offers boilerplate code for testing and deploying smart contracts via golang ethereum. It can be configured to communicate with both community-hosted and local ([Hedera Local Node](https://github.com/hashgraph/hedera-local-node)) instances of the [Hedera JSON RPC Relay](https://github.com/hiero-ledger/hiero-json-rpc-relay).

This project utilizes the ethereum/go-ethereum library to prepare the connection client. Please note that there are alternative libraries available for the Go language, such as ethrpc.

## Project Files and Folders

- `/contracts` - This folder holds:
   - All the Solidity smart contract files that make up the core logic of your dApp. Contracts are written in `.sol` files.
   - Go files generated with `abigen`, which are used to interact with the smart contracts from the Go code. These files include Go bindings for the Solidity contracts, allowing you to call smart contract methods directly from your Go application.

### How to Generate Go Files with `abigen`

The `/contracts` folder currently contains Go files generated with the `abigen` tool. These files are used to interact with the Solidity contracts. Here’s how the Go files were generated:

1. **Install Solidity Compiler (`solc`)**:
   - Install `solc` by following the instructions in the [Solidity documentation](https://docs.soliditylang.org/en/latest/installing-solidity.html).
   - On Ubuntu, you can run:
     ```sh
     sudo apt install solc
     ```

2. **Install `abigen`**:
   - Install `abigen` using the Go toolchain:
     ```sh
     go install github.com/ethereum/go-ethereum/cmd/abigen@latest
     ```

3. **Generate ABI and Binary Files**:
   - Compile your Solidity contract to generate the ABI and binary files. For example, for a contract named `Greeter.sol`:
     ```sh
     solc --abi Greeter.sol -o .
     solc --bin Greeter.sol -o .
     ```

4. **Generate Go Bindings**:
   - Use `abigen` to generate the Go bindings:
     ```sh
     abigen --bin=Greeter.bin --abi=Greeter.abi --pkg=greeter --out=Greeter.go
     ```

The `Greeter.go` file will was created in the `/contracts` folder and can be used in your Go application to deploy and interact with the `Greeter` Smart Contract.

## Requirements
Install go: https://go.dev/doc/install

## Setup

1. Clone this repo to your local machine:

```shell
git clone https://github.com/hiero-ledger/hiero-json-rpc-relay.git
```

2. Once you've cloned the repository, open your IDE terminal and navigate to the root directory of the project:

```shell
cd hiero-json-rpc-relay/tools/golang-example
```

3. Run the following command to install all the necessary dependencies:

```shell
go get github.com/ethereum/go-ethereum/ethclient \
       github.com/ethereum/go-ethereum \
       github.com/ethereum/go-ethereum/accounts/abi/bind \
       github.com/ethereum/go-ethereum/crypto \
       github.com/joho/godotenv
go get -t hedera-golang-example-project
```

4. Get your Hedera testnet account hex encoded private key from the [Hedera Developer Portal](https://portal.hedera.com/register) and update the `.env.example` `OPERATOR_PRIVATE_KEY`

5. Copy `.env.example` to `.env`

6. Run the test script from the root directory of the project. The default network is set to "testnet."

```shell
go test -v
```

7. Run the following command to deploy the smart contract and run setGreeting / greet methods on it.
```shell
# builds the script
go build .

# runs the script on mainnet
./headera-golang-example-project --mainnet

# runs the script on testnet
./headera-golang-example-project

# runs the script on previewnet
./headera-golang-example-project --previewnet
```
