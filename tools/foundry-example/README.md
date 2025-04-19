## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

This directory provides an example of how Hedera developers can utilize foundry in their development process against the Hedera test (remote & local) networks

## Documentation

https://book.getfoundry.sh/

## Git Submodules Management

### Preface

Typically, it's more straightforward to manage Git submodules at the top level of a repository. When submodules are handled within a nested directory (like `foundry-example`), additional manual setup is required for every new clone of the parent repository. This is because Git doesn't inherently save nested repositories when the parent repo is pushed, meaning the submodule structure of the nested directory won't automatically persist across clones.

A more ideal solution would be to manage these submodules directly from the root of the `hiero-json-rpc-relay` repository. This way, after cloning and checking out the relevant branch, one could simply run `git submodule update --init --recursive`(or `forge install`) to initialize and update all submodules without any additional setup.

However, for cases where the submodule management in a nested directory as is attempted here with the `.gitmodules` present in `foundry-example`, the following steps will guide you through setting it up:

### Setup Steps for `foundry-example`:

1. **Navigate to the `foundry-example` directory**:
    ```bash
    cd path_to/hiero-json-rpc-relay/tools/foundry-example
    ```

2. Create a .gitmodules file with the content listed below:
   ```bash
   touch .gitmodules
   ```
   File Content:
   ```
   [submodule "lib/forge-std"]
	    path = lib/forge-std
	    url = https://github.com/foundry-rs/forge-std
    [submodule "lib/openzeppelin-contracts"]
	    path = lib/openzeppelin-contracts
	    url = https://github.com/OpenZeppelin/openzeppelin-contracts
	    branch = release-v4.9
    [submodule "lib/hedera-smart-contracts"]
	    path = lib/hedera-smart-contracts
	    url = https://github.com/hashgraph/hedera-smart-contracts
	    branch = main
   ```

3. **Initialize it as a Git repository**:
    ```bash
    git init
    ```

4. **Remove any existing submodule directories in the `lib` folder**. This ensures that we're starting from a clean state:
    ```bash
    rm -rf lib/*
    ```

5. **Add the necessary submodules**(despite these already being defined in the `.gitmodules`):
    ```bash
    git submodule add https://github.com/foundry-rs/forge-std lib/forge-std
    git submodule add -b release-v5.0 https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts
    git submodule add https://github.com/hashgraph/hedera-smart-contracts lib/hedera-smart-contracts
    ```

    Also run `forge install` to download any submodules that any of the above dependencies depend on.

**Note**: These steps need to be executed for each fresh clone of the main repository if you wish to interact with the `foundry-example` submodules.

## Usage

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

### Format

```shell
$ forge fmt
```

### Gas Snapshots

```shell
$ forge snapshot
```

### Anvil

```shell
$ anvil
```

### Deploy

```shell
$ forge script script/Counter.s.sol:CounterScript --rpc-url <your_rpc_url> --private-key <your_private_key>
```

### Cast

```shell
$ cast <subcommand>
```

### Help

```shell
$ forge --help
$ anvil --help
$ cast --help
```
