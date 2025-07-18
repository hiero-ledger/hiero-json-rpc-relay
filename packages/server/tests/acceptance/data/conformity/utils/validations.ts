// SPDX-License-Identifier: Apache-2.0
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { expect } from 'chai';

import { ErrorResponse, JsonRpcResponse, Method, Schema } from './interfaces';

let execApisOpenRpcData: any = null;
function getExecApisOpenRpcData() {
  if (!execApisOpenRpcData) {
    execApisOpenRpcData = require('../../../../../../../openrpc_exec_apis.json');
  }
  return execApisOpenRpcData;
}

const ajv = new Ajv({ strict: false });
addFormats(ajv);

/**
 * Validates response format by comparing actual response against expected response structure.
 *
 * @param actualResponse - The actual response received from the API call
 * @param expectedResponse - The expected response structure to validate against (can be object, string, or ErrorResponse)
 * @param wildcards - Array of property paths to ignore during validation (default: empty array)
 * @returns {boolean} Returns true if the response format has issues (validation failed), false if format is valid
 *
 * @description
 * This function performs comprehensive response validation including:
 * - Parsing expected response if provided as string
 * - Checking error state consistency between actual and expected responses
 * - Missing key detection in response structure
 * - Deep value comparison with wildcard support
 *
 * @example
 * ```typescript
 * const actualResponse = { result: "0x123", id: 1 };
 * const expectedResponse = '{"result": "0x123", "id": 1}';
 * const hasIssues = hasResponseFormatIssues(actualResponse, expectedResponse);
 * console.log(hasIssues); // false - format is valid
 * ```
 *
 * @example
 * ```typescript
 * const actualResponse = { result: "0x123" };
 * const expectedResponse = { result: "0x123", id: 1 };
 * const hasIssues = hasResponseFormatIssues(actualResponse, expectedResponse);
 * console.log(hasIssues); // true - missing 'id' key
 * ```
 *
 * @example
 * ```typescript
 * const actualResponse = { result: "0x123", timestamp: "2023-01-01" };
 * const expectedResponse = { result: "0x123", timestamp: "2023-01-02" };
 * const wildcards = ["timestamp"];
 * const hasIssues = hasResponseFormatIssues(actualResponse, expectedResponse, wildcards);
 * console.log(hasIssues); // false - timestamp ignored due to wildcard
 * ```
 */
export function hasResponseFormatIssues(
  actualResponse: Record<string, unknown> | ErrorResponse | JsonRpcResponse,
  expectedResponse: Record<string, unknown> | string | ErrorResponse,
  wildcards: string[] = [],
): boolean {
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

  return hasValuesMismatch(actualResponse, parsedExpectedResponse, wildcards);
}

/**
 * Checks if the actual response is missing required error properties
 *
 * @param actual - The actual response to check
 * @param expected - The expected error response
 * @returns {boolean} - Returns true if error properties are missing or mismatched, false if all required properties exist
 */
function hasErrorResponseMismatch(actual: Record<string, unknown>, expected: ErrorResponse): boolean {
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
 *
 * @param actual - The actual array from the response
 * @param expected - The expected array to compare against
 * @param wildcards - Array of property paths to ignore during comparison
 * @param path - Current property path being evaluated
 * @returns {boolean} - Returns true if arrays have different values, false if they match
 */
function hasArrayValuesMismatch(actual: unknown[], expected: unknown[], wildcards: string[], path: string): boolean {
  if (actual.length !== expected.length) {
    return true;
  }

  for (let i = 0; i < expected.length; i++) {
    if (hasValuesMismatch(actual[i], expected[i], wildcards, `${path}[${i}]`)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if an object is missing required properties or has mismatched values
 *
 * @param actual - The actual object from the response
 * @param expected - The expected object to compare against
 * @param wildcards - Array of property paths to ignore during comparison
 * @param path - Current property path being evaluated
 * @returns {boolean} - Returns true if properties are missing or values are mismatched, false if all match
 */
function hasObjectPropertiesMismatch(
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
    if (hasValuesMismatch(actual[key], expected[key], wildcards, newPath)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if complex types (objects or arrays) have mismatches in their structure or values
 *
 * @param actual - The actual object/array from the response
 * @param expected - The expected object/array to compare against
 * @param wildcards - Array of property paths to ignore during comparison
 * @param path - Current property path being evaluated
 * @returns {boolean} - Returns true if mismatches are found, false if values match
 */
function hasComplexTypeMismatch(actual: object | null, expected: object, wildcards: string[], path: string): boolean {
  if (actual === null) {
    return true;
  }

  const isExpectedArray = Array.isArray(expected);
  const isActualArray = Array.isArray(actual);

  if (isExpectedArray !== isActualArray) {
    return true;
  }

  if (isExpectedArray) {
    return hasArrayValuesMismatch(actual as unknown[], expected as unknown[], wildcards, path);
  }

  return hasObjectPropertiesMismatch(
    actual as Record<string, unknown>,
    expected as Record<string, unknown>,
    wildcards,
    path,
  );
}

/**
 * Compares actual and expected values to determine if they match according to validation rules.
 *
 * @param actual - The actual value received from the response
 * @param expected - The expected value to compare against
 * @param wildcards - Array of property paths that should be ignored during comparison
 * @param path - Current property path being evaluated (used for nested object traversal)
 * @returns {boolean} - Returns true if values are different/don't match, false if they match
 *
 * @description
 * This function performs deep comparison between actual and expected values with special handling for:
 * - Error responses: Validates error structure when expected response contains an error property
 * - Null/undefined values: Handles null checks appropriately
 * - Type mismatches: Returns true (different) when types don't match
 * - Complex objects: Delegates to hasComplexTypeMismatch for arrays and objects
 * - Primitive values: Uses direct comparison for primitive types
 */
function hasValuesMismatch(actual: unknown, expected: unknown, wildcards: string[], path = ''): boolean {
  if (path === '' && expected && typeof expected === 'object' && (expected as ErrorResponse).error) {
    return hasErrorResponseMismatch(actual as Record<string, unknown>, expected as ErrorResponse);
  }

  if (expected == null) {
    return actual != null;
  }

  if (typeof actual !== typeof expected) {
    return true;
  }

  if (typeof expected === 'object') {
    return hasComplexTypeMismatch(actual as object | null, expected, wildcards, path);
  }

  return arePrimitivesDifferent(actual, expected);
}

export const findSchema = function (file: string): Schema | undefined {
  const data = getExecApisOpenRpcData();
  return (data.methods as Method[]).find((method) => method.name === file)?.result?.schema;
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
