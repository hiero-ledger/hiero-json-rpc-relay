
| status   | date       | decision-makers                                                                                                                                                                                                                                                                                                                                               | consulted | informed |
|----------|------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------|----------|
| proposed | 2025-05-20 | [Mariusz Jasuwienas](https://github.com/arianejasuwienas) <mariusz.jasuwienas@arianelabs.com>, [Piotr Swierzy](https://github.com/se7enarianelabs) <piotr.swierzy@arianelabs.com>, [Michał Walczak](https://github.com/mwb-al) <michal.walczak@arianelabs.com>, [Fernando Paris Huertas](https://github.com/Ferparishuertas) <fernando.paris@swirldslabs.com> |           |          |

## ADR-007: Implement Retesteth for state transition testing

### Context and Problem Statement

While schema-level testing is helpful, it does not verify the correctness of internal state transitions within the blockchain. Retesteth enables testing of low-level blockchain behavior and can help uncover hidden bugs or inconsistencies in contract execution.

### Decision Drivers

* Detection of subtle state-related bugs
* Ensuring consensus behavior conformity
* Complementing RPC-level tests with deeper checks

### Considered Options

1. Rely solely on current API-level tests.
2. Integrate Retesteth for state transition testing.

### Decision Outcome

**Chosen Option:** Integrate Retesteth for low-level state transition testing.

### Pros and Cons of the Options

#### Option 1: Current API Tests Only

* Good, simpler test environment.
* Bad, does not catch deep protocol-level issues.

#### Option 2: Retesteth (Chosen)

* Good, detects consensus-critical edge cases.
* Good, supports custom test definitions.
* Bad, requires tests preparation and GitHub action configuration (including runners setup).

### Links

* [Retesteth Tutorial](https://ethereum-tests.readthedocs.io/en/latest/retesteth-tutorial.html)
