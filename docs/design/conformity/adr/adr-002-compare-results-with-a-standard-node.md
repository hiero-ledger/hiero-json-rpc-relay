## ADR-002: Compare results with a standard node

### Context and Problem Statement

Currently, our tests validate only the response format of the JSON-RPC API. This does not ensure that the actual response values conform to those produced by a standard Ethereum-compatible node. A deeper comparison would provide confidence that our implementation behaves equivalently under real-world conditions. There have been proposals to compare against nodes such as EthereumJS TestRPC (Ganache) and Anvil.

### Decision Drivers

* Enhanced test accuracy
* Comprehensive behavioral conformity with Ethereum nodes
* Ease of debugging differences
* Preference for modern, actively maintained tools

### Considered Options

1. Keep current format-only validation.
2. Use Ganache CLI as a reference node.
3. Use Anvil as a reference node.

### Decision Outcome

**Chosen Option:** Use Anvil as a reference Ethereum-compatible node for response content comparison.

### Pros and Cons of the Options

#### Option 1: Current Validation Method

* Good, low effort to maintain.
* Bad, does not validate the correctness of actual content returned.

#### Option 2: EthereumJS TestRPC

* Good, simple to set up and use.
* Bad, [this library](https://www.npmjs.com/package/ethereumjs-testrpc) is outdated and may not support latest Ethereum features. It was already replaced by GanacheCLI.

#### Option 3: Anvil (Chosen)

* Good, actively maintained and Ethereum-compatible.
* Good, supports advanced developer tooling and up-to-date features.
* Bad, may require a lot of effort to prepare initial state of the blockchain before starting the tests.

### Links

* [Anvil (Foundry)](https://github.com/foundry-rs/foundry)
* [TestRPC on NPM](https://www.npmjs.com/package/ethereumjs-testrpc)
