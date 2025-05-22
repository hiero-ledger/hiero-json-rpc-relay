
| status   | date       | decision-makers                                                                                                                                                                                                                                                                                                                                               | consulted | informed |
|----------|------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------|----------|
| proposed | 2025-05-20 | [Mariusz Jasuwienas](https://github.com/arianejasuwienas) <mariusz.jasuwienas@arianelabs.com>, [Piotr Swierzy](https://github.com/se7enarianelabs) <piotr.swierzy@arianelabs.com>, [Michał Walczak](https://github.com/mwb-al) <michal.walczak@arianelabs.com>, [Fernando Paris Huertas](https://github.com/Ferparishuertas) <fernando.paris@swirldslabs.com> |           |          |

## ADR-004: Use up-to-date schema and test cases

### Context and Problem Statement

Currently, our testing setup freezes the OpenRPC schema version, potentially causing outdated tests and non-compliance with the latest Ethereum API updates.

### Decision Drivers

* Staying updated with Ethereum API schema
* Avoiding schema drift

### Considered Options

1. Maintain fixed schema version.
2. Continuously use the latest schema version.

### Decision Outcome

**Chosen Option:** Continuously use the latest schema version.

### Pros and Cons of the Options

#### Option 1: Fixed Schema

* Good, predictable testing environment.
* Bad, outdated schema can result in missed compliance issues.

#### Option 2: Latest Schema (Chosen)

* Good, ensures up-to-date conformity checks.
* Bad, potential for increased test instability.

### Links

* [execution-apis main branch](https://github.com/ethereum/execution-apis)
