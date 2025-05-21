
| status   | date       | decision-makers                                                                                                                                                                                                                                                                                                                                               | consulted | informed |
|----------|------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------|----------|
| proposed | 2025-05-20 | [Mariusz Jasuwienas](https://github.com/arianejasuwienas) <mariusz.jasuwienas@arianelabs.com>, [Piotr Swierzy](https://github.com/se7enarianelabs) <piotr.swierzy@arianelabs.com>, [Michał Walczak](https://github.com/mwb-al) <michal.walczak@arianelabs.com>, [Fernando Paris Huertas](https://github.com/Ferparishuertas) <fernando.paris@swirldslabs.com> |           |          |

## ADR-003: Investigate blob-related issues

### Context and Problem Statement

Tests related to Ethereum's blob features are skipped because blob support isn't implemented on our node. This might be outdated and warrants investigation.

### Decision Drivers

* Feature completeness
* Conformity to Ethereum API specification

### Considered Options

1. Continue excluding blob tests.
2. Investigate feasibility and enable blob tests if supported.

### Decision Outcome

**Chosen Option:** Investigate feasibility and enable blob tests if supported.

### Pros and Cons of the Options

#### Option 1: Exclude Tests

* Good, avoids additional effort.
* Bad, potential non-compliance with evolving Ethereum specifications.

#### Option 2: Investigate and Enable (Chosen)

* Good, ensures specification compliance.
* Bad, may require significant development efforts.

### Links

* [execution-apis repository](https://github.com/ethereum/execution-apis)
