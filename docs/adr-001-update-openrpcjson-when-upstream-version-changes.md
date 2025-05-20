
| status   | date       | decision-makers                                                                                                                                                                                                                                                                                                                                               | consulted | informed |
|----------|------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------|----------|
| proposed | 2025-05-20 | [Mariusz Jasuwienas](https://github.com/arianejasuwienas) <mariusz.jasuwienas@arianelabs.com>, [Piotr Swierzy](https://github.com/se7enarianelabs) <piotr.swierzy@arianelabs.com>, [Michał Walczak](https://github.com/mwb-al) <michal.walczak@arianelabs.com>, [Fernando Paris Huertas](https://github.com/Ferparishuertas) <fernando.paris@swirldslabs.com> |           |          |


## ADR-001: Detect discrepancies between local JSON-RPC schema and upstream specification

### Context and Problem Statement

We maintain a local OpenRPC schema file (`openrpc.json`) that documents our Ethereum-compatible JSON-RPC interface for Hedera. This file is versioned in our GitHub repository and intended to reflect the current implementation.

However, discrepancies have been observed between our documented schema and the actual live API. These discrepancies can arise due to either changes in the implementation or updates in the upstream Ethereum Execution API specifications.

Because our documentation lives in the repository and must be manually maintained, we cannot rely solely on automation to correct differences. Instead, we must focus on detecting and surfacing discrepancies reliably so that maintainers can resolve them.

Additionally, the upstream `openrpc.json` file (published by the Ethereum Execution APIs) resolves all `$ref` references inline, which causes structural differences compared to our schema unless we perform a similar dereferencing step during comparison.

### Considered Options

1. Continue manually checking for changes in the remote repository.
2. Add validation process in the Github Action.

### Decision Outcome

**Chosen Option:** Add validation process in the Github Action.

We propose to introduce a validation process that:

* Triggers on any push to the `main` branch
* Downloads the latest `openrpc.json` from the Ethereum Execution API specs repository
* Resolves all `$ref` references in both the upstream and local schema files to ensure comparable structure
* Compares the resolved versions to identify differences
* Fails the workflow with a clear error message if discrepancies are detected

No automated updates will be made to the repository. Instead, this process will serve as an early warning system to highlight discrepancies.

### Pros and Cons of the Options

#### Option 1: Continue manually checking for changes in the remote repository

* Bad, requires manual effort to detect changes and update the schema.
* Bad, there is a high risk of missing updates.

#### Option 2: Add validation process in the Github Action

* Good, improves visibility into discrepancies between our schema and upstream.
* Good, maintainers retain full control over when and how to update the schema.
* Bad, manual effort is still required to update the schema when differences are detected.
* Bad, requires additional logic to dereference and normalize JSON schema structure for comparison.
