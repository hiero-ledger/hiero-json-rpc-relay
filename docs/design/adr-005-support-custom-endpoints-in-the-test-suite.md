
| status   | date       | decision-makers                                                                                                                                                                                                                                                                                                                                               | consulted | informed |
|----------|------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------|----------|
| proposed | 2025-05-20 | [Mariusz Jasuwienas](https://github.com/arianejasuwienas) <mariusz.jasuwienas@arianelabs.com>, [Piotr Swierzy](https://github.com/se7enarianelabs) <piotr.swierzy@arianelabs.com>, [Michał Walczak](https://github.com/mwb-al) <michal.walczak@arianelabs.com>, [Fernando Paris Huertas](https://github.com/Ferparishuertas) <fernando.paris@swirldslabs.com> |           |          |


## ADR-005: Support custom endpoints in the test suite

### Context and problem statement

Our current test suite setup does not support easily adding custom endpoints or tests, limiting testing flexibility.

### Decision Drivers

* Flexibility for development and testing
* Enhanced ability to validate custom endpoints

### Considered Options

1. Keep current fixed setup. 
2. Allow injection of custom endpoints into the schema config (before the schema file is generated) and custom tests into their respective test configuration.
3. Allow injection of custom endpoints into the schema config (update the schema file after it is already generated) and custom tests into their respective test configuration.

### Decision Outcome

**Chosen Option:** Allow injection of custom endpoints and tests.

### Pros and Cons of the Options

#### Option 1: Fixed Setup

* Good, simplicity and predictability.
* Bad, lack of testing flexibility.

#### Option 2: Allow custom endpoints by modifying the schema config before the `openrpc.json` file is generated

* Good, increased testing coverage and flexibility.
* Bad, introduces complexity in test management.
* Not ideal, as it would require updating the initial config files used to generate the schema, making the process more complicated.

#### Option 2: Allow custom endpoints by modifying the schema config after the `openrpc.json` file is generated (Chosen)

* Good, increased testing coverage and flexibility.
* Good, since we can continue using the config generator as before and just append custom endpoints to the generated schema as a final step.
* Bad, introduces complexity in test management.

### Links

* [hiero-json-rpc-relay issue](https://github.com/hiero-ledger/hiero-json-rpc-relay/issues/3761)
