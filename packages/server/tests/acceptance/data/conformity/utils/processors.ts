// SPDX-License-Identifier: Apache-2.0
import { expect } from 'chai';

import { FileContent } from './interfaces';
import { updateRequestParams } from './overwrites';
import { sendRequestToRelay } from './utils';
import { findSchema, hasResponseFormatIssues, isResponseValid } from './validations';

/**
 * Splits a given input string into distinct segments representing the request, the response, and optional wildcard fields.
 *
 * @param {string} content - The input string to be segmented.
 * @returns {{ request: string, response: string, wildcards: string[] }} - An object containing the separated request, response strings, and wildcard fields.
 */
export function splitReqAndRes(content: string) {
  const lines = content
    .split('\n')
    .map((line: string) => line.trim())
    .filter((line: string) => line.length > 0);
  const wildcards: string[] = [];

  const requestLine = lines.find((line: string) => line.startsWith('>>'));
  const responseLine = lines.find((line: string) => line.startsWith('<<'));
  const wildcardLine = lines.find((line: string) => line.startsWith('## wildcard:'));

  if (wildcardLine) {
    wildcards.push(
      ...wildcardLine
        .replace('## wildcard:', '')
        .trim()
        .split(',')
        .map((field: string) => field.trim()),
    );
  }

  if (!requestLine || !responseLine) {
    throw new Error('Missing or improperly formatted request/response lines');
  }

  return {
    request: requestLine.slice(2).trim(),
    response: responseLine.slice(2).trim(),
    wildcards,
  };
}

/**
 * Processes file content for API testing by executing requests against a relay server
 * and validating the responses according to various validation strategies.
 *
 * @param {string} relayUrl - The URL of the relay server to send requests to
 * @param {string} directory - The directory path used for schema lookup
 * @param {string} file - The name of the file being processed (used for logging)
 * @param {FileContent} content - The file content object containing request, response, and wildcards
 * @returns {Promise<void>} A promise that resolves when processing is complete
 *
 * @description
 * This function performs the following operations:
 * 1. Updates request parameters based on the file context
 * 2. Sends the modified request to the relay server
 * 3. Validates the response using one of three strategies:
 *    - Error response validation (expects validation to fail)
 *    - Schema validation (when schema exists and no wildcards)
 *    - Response format validation (key-by-key comparison with wildcards support)
 */
export async function processFileContent(relayUrl: string, directory: string, file: string, content: FileContent) {
  console.log('Executing for ', file);
  console.log('Original request:', content.request);
  const modifiedRequest = await updateRequestParams(file, JSON.parse(content.request));
  console.log('Modified request:', JSON.stringify(modifiedRequest));

  const needError = JSON.parse(content.response).error;
  console.log(`Error expected in response: ${!!needError}`);

  const response = await sendRequestToRelay(relayUrl, modifiedRequest, needError);
  console.log('Response from relay:', JSON.stringify(response));

  const schema = findSchema(directory);
  console.log(`Schema found for directory "${directory}": ${!!schema}`);

  const wildcards = content.wildcards || [];
  console.log('Wildcards being used:', JSON.stringify(wildcards));

  if (needError) {
    console.log('Validating an error response.');
    const valid = hasResponseFormatIssues(response, content.response, wildcards);
    expect(valid).to.be.false;
  } else {
    console.log('Validating a success response.');
    if (schema && wildcards.length === 0) {
      console.log('Using schema validation.');
      const valid = isResponseValid(schema, response);
      expect(valid).to.be.true;
    } else {
      console.log('Using response format check (key-by-key comparison).');
      const hasMissingKeys = hasResponseFormatIssues(response, JSON.parse(content.response), wildcards);
      expect(hasMissingKeys).to.be.false;
    }
    console.log('Success response validation finished.');
  }
}
