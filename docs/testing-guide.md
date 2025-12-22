# Testing Guide

## Overview

This guide provides an overview of the testing strategies and best practices for our project.
It includes information on unit tests, integration tests, and end-to-end tests.

### Overall Best Practices

- Write tests before writing code to ensure you are not biasing the tests towards the implementation.
- Use a consistent naming convention for tests to make them easy to identify.
- Keep tests small and focused on a single aspect of the code.
- Run tests frequently to catch bugs early in the development process.
- Use a continuous integration system to automate test execution.

## Unit Tests

Unit tests are used to test individual components or functions in isolation. They should be fast and cover a wide range
of edge cases.

### Best Practices

**Important Note**: Always prefer integration tests over unit tests when execution time is almost the same.

- Write tests for all public methods and functions.
- Ensure tests are deterministic and do not rely on external state.
- Use the least amount of mocks and stub only what's truly necessary to isolate the unit under test.

## Integration Tests

Integration tests verify that different parts of the system work together as expected.
They are typically slightly slower than unit tests and may involve external systems like databases or APIs.

### Best Practices

- Test the integration points between components. For example, test the interaction between a service and a database.
- Use an in-memory test database or mock calls to external services such as API calls to avoid affecting production
  data.
- Ensure tests clean up any data they create. This is especially important for tests that modify the state of the
  system.
- When possible, write tests in such a way that they can be run in parallel to speed up the test suite.

## End-to-End Tests

End-to-end tests simulate real user scenarios and verify that the entire system works as expected. They are the slowest
type of tests but provide the highest level of confidence.

### Best Practices

- Write end-to-end tests for critical user journeys.
- End-to-end tests should cover the most common user scenarios and not edge cases.
- Any edge-case scenarios should be covered by unit and integration tests.
- Use tools like ethers.js or web3.js to interact with smart contracts in end-to-end tests.
- Run end-to-end tests in a clean environment to avoid interference from other tests.

## Rules for Testing

This section outlines the rules and guidelines for writing and maintaining tests in our project.

### General Rules

- All new features must include appropriate tests. This includes unit tests, integration tests, and end-to-end tests
  where applicable.
- Refactor existing tests (or add new tests for any new edge-cases) when refactoring code to ensure they remain accurate
  and relevant.
- Tests should be written in a way that they can be easily understood and maintained.
- Use descriptive test names that clearly indicate what is being tested.
- Do not test multiple things in a single test. Each test should focus on a single aspect of the code.
- Avoid using hard-coded values; use constants or configuration files instead.
- Dynamic calculation of values (instead of hardcoding) is preferred where possible.

### Specific Rules

- Unit tests should cover at least 90% of the code and are more oriented towards the edge cases.
- Should have integration tests for all the components that interact with each other.
- Never rely only on unit tests, always have integration tests.
- End-to-end (acceptance) tests should be included in the continuous integration pipeline.
- End-to-end tests should cover the most common user scenarios and not edge cases.
- Pretty much all critical user journeys should be covered by end-to-end tests.

### Error Handling

- Tests should handle expected errors gracefully and assert the correct error messages.
- Avoid using try-catch blocks to handle exceptions in tests, instead use `rejectedWith` or `throws` assertions to
  verify the error (e.g., `expect(..).to.be.rejectedWith(expectedMessage)` or
  `expect(() => methodThatThrows(arg1, arg2)).to.throw(expectedMessage)`).
- Ensure that tests fail if an unexpected error occurs.
- Use `chai-as-promised` for testing promises and async functions. (e.g.,
  `expect(..).to.eventually.equal(expectedValue)`).

### Mocking

- Use mocks and stubs to isolate the unit under test from external dependencies.
- Use a mocking library like `sinon` to create mocks and stubs.
- Avoid over-mocking. Only mock what is necessary to isolate the unit under test.
- Prefer spies to stubs when possible to verify that a method was called without affecting its behavior.
- Use `sinon-chai` to make assertions on spies and stubs. (e.g., `expect(spy).to.have.been.calledOnce`).
- Avoid mocking the system under test. Only mock external dependencies.

### Performance

- Ensure that tests run quickly to avoid slowing down the development process.
- Use parallel test execution where possible to speed up the test suite.
- Do not use sleep statements or other artificial delays in tests to wait for asynchronous operations to complete.
  Instead, spy on the asynchronous operation and await it in the test to ensure it has completed.
- Make sure that any common setup which is expensive is done only once and reused across tests.
- Do not rely on **_external_** services or databases in unit tests to avoid slowing down the test suite.
- Use an in-memory test database or mock external services in integration tests to speed up test execution.

### Documentation

- The combined title of the `describe` and `it` blocks should be descriptive enough for the reader to understand what is
  being tested.
- Anything which is not self-explanatory from the combined title of the `describe` and `it` should be documented with
  comments.
- Use comments to explain WHYs and not WHATs. The WHAT should be clear from the test itself.

## Common Pitfalls

### Flaky Tests

- Ensure tests are deterministic and do not rely on external factors.
- Use mocks and stubs to isolate tests.

### Overlapping Tests

- Avoid dependencies between tests.
- Ensure each test can run independently.

## Formatting

### General Rules

- Use consistent formatting for tests to make them easy to read and understand.
- Use a consistent naming convention for tests to make them easy to identify.
- Use descriptive variable names to make the test code self-explanatory.
- Use `before`, `beforeEach`, `after`, and `afterEach` hooks to set up and tear down test fixtures.
- Use `describe` blocks to group related tests together.

### Naming and Structure

- Use the following naming convention for test files: `<module under test>.spec.ts`
- The outermost describe should include the name of the module in the test suite:
  `describe('<name of module/class under test>', () => { ... })`.
- Multiple tests over the same method should be grouped under the name of the method:
  `describe('<name of method under test>', () => { ... })`.
- Use the following naming convention for nested groups of tests:
  `describe('given <common condition for group of tests>', () => { ... })`.
- Use the following naming convention for test cases: `it('should <expected behavior of method>', () => { ... })`.

### Example

```typescript
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { MyClass } from './my-class';
import type { ICacheClient } from './cache-client';
import { CacheClientFactory } from './cache-client-factory';

chai.use(chaiAsPromised);

describe('MyClass', function() {
  let cacheClient: ICacheClient;
  let myClass: MyClass;

  beforeEach(function() {
    // Common setup for all tests
    cacheClient = CacheClientFactory.create();
    myClass = new MyClass(cacheClient);
  });

  afterEach(async function() {
    // Do not forget to clean up any changes in the state of the system
    await cacheClient.clear();
  });

  describe('myMethod', function() {
    describe('given a valid input', function() {
      let validInput: string;

      beforeEach(function() {
        // Set up for a valid input
        validInput = 'valid input';
      });

      it('should return the expected result', function() {
        const result = myClass.myMethod(validInput);
        expect(result).to.equal('expected result');
      });

      it('should call the dependency method with correct arguments', async function() {
        const expectedArgs = ['expected', 'arguments'];
        const spy = sinon.spy(myClass, 'dependencyMethod');

        myClass.myMethod(validInput);

        expect(spy).to.have.been.calledOnceWith(...expectedArgs);
      });

      it('should change someState after calling myMethod', async function() {
        const expectedArgs = ['expected', 'arguments'];
        const spy = sinon.spy(myClass, 'dependencyMethod');

        myClass.myMethod(validInput);

        // Await until the asynchronous dependency method has finished executing before doing the assertions
        expect(spy).to.have.been.calledOnce;
        await expect(spy.returnValues[0]).to.be.fulfilled; // or .rejectedWith('expected error message')
        expect(myClass.someState).to.equal('expected value');
      });
    });

    describe('given an invalid input', function() {
      let invalidInput: string;

      beforeEach(function() {
        // Set up for an invalid input
        invalidInput = 'invalid input';
      });

      it('should throw an error', function() {
        expect(() => myClass.myMethod(invalidInput)).to.throw('expected error message');
      });

      it('should not call the dependency method', function() {
        const spy = sinon.spy(myClass, 'dependencyMethod');
        expect(() => myClass.myMethod(invalidInput)).to.throw;
        expect(spy).not.to.have.been.called;
      });
    });
  });

  describe('anotherMethod', () => {
    // Tests for anotherMethod
    // Use analogous formatting to the tests for myMethod
  });
});
```

## Utilizing Helper Methods

### `overrideEnvsInMochaDescribe`

Temporarily overrides environment variables for the duration of the encapsulating describe block.

### `withOverriddenEnvsInMochaTest`

Overrides environment variables for the duration of the provided tests.

### `useInMemoryRedisServer`

Sets up an in-memory Redis server for testing purposes.

### `startRedisInMemoryServer`

Starts an in-memory Redis server.

### `stopRedisInMemoryServer`

Stops the in-memory Redis server.

### Example

```typescript
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import pino from 'pino';
import { overrideEnvsInMochaDescribe, useInMemoryRedisServer, withOverriddenEnvsInMochaTest } from './helpers';

import type { ICacheClient } from './cache-client';
import { CacheClientFactory } from './cache-client-factory';

chai.use(chaiAsPromised);

describe('MyClass', function() {
  const logger = pino();

  // Start an in-memory Redis server on a specific port
  useInMemoryRedisServer(logger, 6379);
  
  // Override environment variables for the duration of the describe block
  overrideEnvsInMochaDescribe({
    MY_ENV_VAR: 'common-value-of-env-applied-to-tests-unless-overridden-in-inner-describe',
    MY_ENV_VAR_2: 'another-common-value-of-env-applied-to-tests-unless-overridden-in-inner-describe',
  });

  let serviceThatDependsOnEnv: ServiceThatDependsOnEnv;
  let cacheClient: ICacheClient;
  let myClass: MyClass;

  beforeEach(function() {
    // Common setup for all tests
    serviceThatDependsOnEnv = new ServiceThatDependsOnEnv();
    cacheClient = CacheClientFactory.create();
    myClass = new MyClass(serviceThatDependsOnEnvcacheClient cacheClient);
  });

  afterEach(async function() {
    // Do not forget to clean up any changes in the state of the system
    await cacheClient.clear();
  });

  describe('myMethod', function() {
    it('should <expected behavior>', function() {
      const expectedValue = 'expected result when MY_ENV_VAR is not overridden';
      const result = myClass.myMethod();
      expect(result).to.equal(expectedValue);
    });

    // Override environment variables for the duration of the provided tests
    withOverriddenEnvsInMochaTest({ MY_ENV_VAR: 'overridden-value-of-env' }, function() {
      it('should <expected behavior when MY_ENV_VAR is overridden>', () => {
        const expectedValue = 'expected result when MY_ENV_VAR is overridden';
        const result = myClass.myMethod();
        expect(result).to.equal(expectedValue);
      });

      it('should <another expected behavior when MY_ENV_VAR is overridden>', function() {
        const expectedArgs = ['expected', 'arguments'];
        const spy = sinon.spy(serviceThatDependsOnEnv, 'methodThatDependsOnEnv');
        myClass.myMethod();
        expect(spy).to.have.been.calledOnceWith(...expectedArgs);
      });
    });
  });
});
```

## Conclusion

Following these guidelines will help ensure that our tests are effective, maintainable, and provide a high level of
confidence in the quality of our code.
