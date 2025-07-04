// SPDX-License-Identifier: Apache-2.0
import { expect } from 'chai';

import { updateRequestParams } from './overwrites';
import { sendRequestToRelay } from './utils';
import { checkResponseFormat, findSchema, isResponseValid } from './validations';

export function splitReqAndRes(content: string) {
  /**
   * Splits a given input string into distinct segments representing the request, the response, and optional wildcard fields.
   *
   * @param {string} content - The input string to be segmented.
   * @returns {{ request: string, response: string, wildcards: string[] }} - An object containing the separated request, response strings, and wildcard fields.
   */
  const lines = content
    .split('\n')
    .map((line: any) => line.trim())
    .filter((line: any) => line.length > 0);
  const wildcards: string[] = []; // Add explicit type annotation here

  const requestLine = lines.find((line: any) => line.startsWith('>>'));
  const responseLine = lines.find((line: any) => line.startsWith('<<'));
  const wildcardLine = lines.find((line: any) => line.startsWith('## wildcard:'));

  if (wildcardLine) {
    wildcards.push(
      ...wildcardLine
        .replace('## wildcard:', '')
        .trim()
        .split(',')
        .map((field: any) => field.trim()),
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

export async function processFileContent(relayUrl: string, directory: any, file: any, content: any) {
  /**
   * Processes a file from the execution apis repo
   * containing test request and response data.
   *
   * @param {string} file - The name of the file being processed.
   * @param {Object} content - The content of the file, consisting of request and response data.
   * @returns {Array<string>} - An array of missing keys in the response data.
   */
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
    const valid = checkResponseFormat(response.response.data, content.response, wildcards);
    console.log(
      `Inside processFileContent, valid: ${valid}, response: ${JSON.stringify(
        response.response.data,
      )}, content: ${JSON.stringify(content)}, wildcards: ${JSON.stringify(wildcards)}`,
    );
    expect(valid).to.be.false;
    console.log('Error response validation finished.');
  } else {
    console.log('Validating a success response.');
    if (schema && wildcards.length === 0) {
      console.log('Using schema validation.');
      const valid = isResponseValid(schema, response);
      console.log(`Schema validation result: ${valid}`);
      expect(valid).to.be.true;
      if (response.result) {
        console.log('Comparing response result with expected result.');
        expect(response.result).to.be.equal(JSON.parse(content.response).result);
      }
    } else {
      console.log('Using response format check (key-by-key comparison).');
      const hasMissingKeys = checkResponseFormat(response, JSON.parse(content.response), wildcards);
      console.log(`Missing keys check result: ${hasMissingKeys}`);
      expect(hasMissingKeys).to.be.false;
    }
    console.log('Success response validation finished.');
  }
}
