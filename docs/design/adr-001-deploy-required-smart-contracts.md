| status   | date       | decision-makers                                                                                                                                                                                                                                                                                                                                               | consulted | informed |
|----------|------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------|----------|
| proposed | 2025-05-20 | [Mariusz Jasuwienas](https://github.com/arianejasuwienas) <mariusz.jasuwienas@arianelabs.com>, [Piotr Swierzy](https://github.com/se7enarianelabs) <piotr.swierzy@arianelabs.com>, [Michał Walczak](https://github.com/mwb-al) <michal.walczak@arianelabs.com>, [Fernando Paris Huertas](https://github.com/Ferparishuertas) <fernando.paris@swirldslabs.com> |           |          |

## ADR-001: Deploy required Smart Contracts

### Context and Problem Statement

Certain execution-apis tests are currently skipped due to missing smart contracts on our Hedera network.
This omission prevents comprehensive validation of our JSON-RPC API's conformity with Ethereum's specification.

### Decision Drivers

* Ensuring comprehensive test coverage
* Alignment with Ethereum API standards
* Improved accuracy and reliability of test results

### Considered Options

1. Continue skipping tests.
2. Deploy the missing smart contracts to support currently skipped tests.

### Decision Outcome

**Chosen Option:** Deploy the missing smart contracts to support currently skipped tests.

### Pros and Cons of the Options

#### Option 1: Continue Skipping Tests

* Good, as it maintains the current operational status quo.
* Bad, as it leaves significant gaps in test coverage.

#### Option 2: Deploy Smart Contracts (Chosen)

* Good, increases test coverage and conformity to Ethereum standards.
* Bad, requires additional initial effort for deployment and maintenance.

### Links

* [execution-apis](https://github.com/ethereum/execution-apis)
