
| status   | date       | decision-makers                                                                                                                                                                                                                                                                                                                                               | consulted | informed |
|----------|------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------|----------|
| proposed | 2025-05-20 | [Mariusz Jasuwienas](https://github.com/arianejasuwienas) <mariusz.jasuwienas@arianelabs.com>, [Piotr Swierzy](https://github.com/se7enarianelabs) <piotr.swierzy@arianelabs.com>, [Michał Walczak](https://github.com/mwb-al) <michal.walczak@arianelabs.com>, [Fernando Paris Huertas](https://github.com/Ferparishuertas) <fernando.paris@swirldslabs.com> |           |          |

## ADR-008: Evaluate OpenRPC Schema Utils JS

### Context and Problem Statement

A proposal suggested using the `validateOpenRPCDocument` utility from the OpenRPC Schema Utils JS library to validate OpenRPC documents. However, our current GitHub Actions pipeline already performs this validation using the AJV library.

### Decision Drivers

* Avoiding duplication of validation logic
* Evaluating alternative tools for better efficiency or feature set

### Considered Options

1. Continue using AJV.
2. Replace or augment AJV with Schema Utils JS.

### Decision Outcome

**Chosen Option:** Continue using AJV unless a clear need arises.

### Pros and Cons of the Options

#### Option 1: Continue with AJV (Chosen)

* Good, already integrated and maintained.
* Good, provides sufficient validation.
* Bad, may lack future OpenRPC-specific enhancements.

#### Option 2: Schema Utils JS

* Good, tailored for OpenRPC.
* Bad, redundant with AJV without added value.

### Links

* [OpenRPC Schema Utils](https://open-rpc.github.io/schema-utils-js/functions/validateOpenRPCDocument.html)
