// SPDX-License-Identifier: Apache-2.0
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { expect } from 'chai';

import { ErrorResponse, JsonRpcResponse, Method, Schema } from './interfaces';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const execApisOpenRpcData = require('../../../../../../../openrpc_exec_apis.json');

const ajv = new Ajv({ strict: false });
addFormats(ajv);

export function checkResponseFormat(
  actualResponse: Record<string, unknown> | ErrorResponse | JsonRpcResponse,
  expectedResponse: Record<string, unknown> | string | ErrorResponse,
  wildcards: string[] = [],
) {
  let parsedExpectedResponse: Record<string, unknown> | ErrorResponse = expectedResponse as Record<string, unknown>;
  if (typeof expectedResponse === 'string') {
    try {
      parsedExpectedResponse = JSON.parse(expectedResponse);
    } catch (e) {
      console.log(`Expected response is not a valid JSON string: ${expectedResponse}`);
      return true;
    }
  }

  const actualHasError = !!(actualResponse as JsonRpcResponse).error;
  const expectedHasError = !!parsedExpectedResponse.error;

  if (actualHasError !== expectedHasError) {
    if (actualHasError) {
      console.log(
        `Received an unexpected error response: ${JSON.stringify((actualResponse as JsonRpcResponse).error)}`,
      );
    } else {
      console.log(`Expected an error response, but received a success response: ${JSON.stringify(actualResponse)}`);
    }
    return true;
  }

  const actualResponseKeys = extractKeys(actualResponse as Record<string, unknown>);
  const expectedResponseKeys = extractKeys(parsedExpectedResponse as Record<string, unknown>);
  const filteredExpectedKeys = expectedResponseKeys.filter((key) => !wildcards.includes(key));
  const missingKeys = filteredExpectedKeys.filter((key) => !actualResponseKeys.includes(key));

  if (missingKeys.length > 0) {
    console.log(`Missing keys in response: ${JSON.stringify(missingKeys)}`);
    return true;
  }

  return checkValues(actualResponse, parsedExpectedResponse, wildcards);
}

/**
 * Checks if the actual response has the required error properties
 */
function checkErrorResponse(actual: Record<string, unknown>, expected: ErrorResponse): boolean {
  if (!actual || typeof actual !== 'object' || !actual.error) {
    return true;
  }
  const requiredErrorKeys = Object.keys(expected.error);
  for (const key of requiredErrorKeys) {
    if (!(key in (actual.error as Record<string, unknown>))) {
      return true;
    }
  }
  return false;
}

function arePrimitivesDifferent(actual: unknown, expected: unknown): boolean {
  return actual !== expected;
}

/**
 * Checks if two arrays have different values
 */
function checkArrayValues(actual: unknown[], expected: unknown[], wildcards: string[], path: string): boolean {
  if (actual.length !== expected.length) {
    return true;
  }

  for (let i = 0; i < expected.length; i++) {
    if (checkValues(actual[i], expected[i], wildcards, `${path}[${i}]`)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if an object has all the required properties with matching values
 */
function checkObjectProperties(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
  wildcards: string[],
  path: string,
): boolean {
  for (const key in expected) {
    const newPath = path ? `${path}.${key}` : key;
    if (wildcards.includes(newPath)) {
      continue;
    }
    if (!(key in actual)) {
      return true;
    }
    if (checkValues(actual[key], expected[key], wildcards, newPath)) {
      return true;
    }
  }
  return false;
}

function checkValues(actual: unknown, expected: unknown, wildcards: string[], path = '') {
  if (path === '' && expected && typeof expected === 'object' && (expected as ErrorResponse).error) {
    return checkErrorResponse(actual as Record<string, unknown>, expected as ErrorResponse);
  }

  if (expected === null || expected === undefined) {
    return actual !== null && actual !== undefined;
  }

  if (typeof actual !== typeof expected) {
    return true;
  }

  if (typeof expected !== 'object') {
    return arePrimitivesDifferent(actual, expected);
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return true;
    }
    return checkArrayValues(actual, expected, wildcards, path);
  }

  return checkObjectProperties(actual as Record<string, unknown>, expected as Record<string, unknown>, wildcards, path);
}

export const findSchema = function (file: string): Schema | undefined {
  return (execApisOpenRpcData.methods as Method[]).find((method) => method.name === file)?.result?.schema;
};

export function isResponseValid(schema: Schema, response: { result: unknown }): boolean {
  const validate = ajv.compile(schema);
  const valid = validate(response.result);

  expect(validate.errors).to.be.null;

  return valid;
}

export function extractKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  let keys: string[] = [];
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const newKey = prefix ? `${prefix}.${key}` : key;
      keys.push(newKey);

      if (typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        keys = keys.concat(extractKeys(obj[key] as Record<string, unknown>, newKey));
      }
    }
  }

  return keys;
}
