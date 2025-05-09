# Foundry `HTSConnector` contract fuzz testing

#### How to run

- Install forge dependencies
```bash
forge install hashgraph/hedera-forking --no-commit --no-git
```

- Install npm dependencies (openzeppelin and lz contracts)
```bash
npm install
```

- Run tests
```bash
forge test --fork-url https://testnet.hashio.io/api
```
