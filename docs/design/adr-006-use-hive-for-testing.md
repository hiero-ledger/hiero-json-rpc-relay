
| status   | date       | decision-makers                                                                                                                                                                                                                                                                                                                                               | consulted | informed |
|----------|------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------|----------|
| proposed | 2025-05-20 | [Mariusz Jasuwienas](https://github.com/arianejasuwienas) <mariusz.jasuwienas@arianelabs.com>, [Piotr Swierzy](https://github.com/se7enarianelabs) <piotr.swierzy@arianelabs.com>, [Michał Walczak](https://github.com/mwb-al) <michal.walczak@arianelabs.com>, [Fernando Paris Huertas](https://github.com/Ferparishuertas) <fernando.paris@swirldslabs.com> |           |          |

## ADR-006: Use HIVE for testing

### Context and Problem Statement

Currently, our JSON-RPC API tests rely on a custom setup that validates only response schemas. However, tools like HIVE can validate both schema and actual result content. Running HIVE tests against our implementation would provide a higher assurance level and allow third-party developers to run the same validation externally.

### Decision Drivers

* Improved external validation
* Support for open source, community-validated tooling
* Full validation of schema and content

### Considered Options

1. Continue using custom scripts.
2. Transition to HIVE for testing.

### Decision Outcome

**Chosen Option:** Transition to HIVE for testing.

### Pros and Cons of the Options

#### Option 1: Custom Scripts

* Good, already integrated with our workflows.
* Bad, less robust and not externally reusable.

#### Option 2: HIVE (Chosen)

* Good, comprehensive validation and standardized tool.
* Good, facilitates third-party adoption and trust.
* Bad, may require effort to adapt failing or skipped tests.

### Links

* [HIVE repository](https://github.com/ethereum/hive)
