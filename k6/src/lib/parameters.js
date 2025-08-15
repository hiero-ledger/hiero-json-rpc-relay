// SPDX-License-Identifier: Apache-2.0

import http from 'k6/http';

import { logListName, resultListName, transactionListName } from './constants.js';

const getValidResponse = (requestUrl, requestBody, httpVerbMethod) => {
  const response = httpVerbMethod(requestUrl, JSON.stringify(requestBody));
  if (response.status !== 200) {
    throw new Error(`${response.status} received when requesting ${requestUrl}`);
  }
  return JSON.parse(response.body);
};

const getFirstEntity = (entityPath, key) => {
  const body = getValidResponse(entityPath, null, http.get);
  if (!body.hasOwnProperty(key)) {
    throw new Error(`Missing ${key} property in ${entityPath} response`);
  }
  const entity = body[key];
  if (entity.length === 0) {
    throw new Error(`No ${key} were found in the response for request at ${entityPath}`);
  }
  return entity[0];
};

const copyEnvParamsFromEnvMap = (propertyList) => {
  const envProperties = {};
  let allPropertiesFound = true;
  for (const property of propertyList) {
    if (__ENV.hasOwnProperty(property)) {
      envProperties[property] = __ENV[property];
    } else {
      allPropertiesFound = false;
    }
  }
  return {
    allPropertiesFound,
    envProperties,
  };
};

const computeProperties = (propertyList, fallback) => {
  const copyResult = copyEnvParamsFromEnvMap(propertyList);
  if (copyResult.allPropertiesFound) {
    return copyResult.envProperties;
  }
  return Object.assign(copyResult.envProperties, fallback());
};

export const computeLatestContractResultParameters = (configuration) =>
  computeProperties(['DEFAULT_ENTITY_FROM', 'DEFAULT_TIMESTAMP', 'DEFAULT_ENTITY_TO'], () => {
    const contractResultPath = `${configuration.baseApiUrl}/contracts/results?limit=1&order=desc`;
    const firstResult = getFirstEntity(contractResultPath, resultListName);

    return {
      DEFAULT_ENTITY_FROM: firstResult.from.substring(0, 42),
      DEFAULT_TIMESTAMP: firstResult.timestamp,
      DEFAULT_ENTITY_TO: firstResult.to.substring(0, 42),
    };
  });

export const computeLatestEthereumTransactionParameters = (configuration) =>
  computeProperties(['DEFAULT_BLOCK_HASH', 'DEFAULT_ETH_TRANSACTION_ID', 'DEFAULT_TRANSACTION_HASH'], () => {
    const transactionResultPath = `${configuration.baseApiUrl}/transactions?transactiontype=ethereumtransaction&limit=1&order=desc&result=success`;
    const firstResult = getFirstEntity(transactionResultPath, transactionListName);
    const contractResultPath = `${configuration.baseApiUrl}/contracts/results/${firstResult.transaction_id}`;
    const secondResult = getValidResponse(contractResultPath, null, http.get);

    return {
      DEFAULT_BLOCK_HASH: secondResult.block_hash.substring(0, 66),
      DEFAULT_ETH_TRANSACTION_ID: firstResult.transaction_id,
      DEFAULT_TRANSACTION_HASH: secondResult.hash.substring(0, 66),
    };
  });

export const computeLatestLogParameters = (configuration) =>
  computeProperties(['DEFAULT_CONTRACT_ADDRESS', 'DEFAULT_LOG_TIMESTAMP'], () => {
    const logResultPath = `${configuration.baseApiUrl}/contracts/results/logs?limit=1&order=desc`;
    const firstResult = getFirstEntity(logResultPath, logListName);

    return {
      DEFAULT_CONTRACT_ADDRESS: firstResult.address,
      DEFAULT_LOG_TIMESTAMP: firstResult.timestamp,
    };
  });

export const setDefaultValuesForEnvParameters = () => {
  __ENV['MIRROR_BASE_URL'] = __ENV['MIRROR_BASE_URL'] || 'http://localhost:5551';
  __ENV['RELAY_BASE_URL'] = __ENV['RELAY_BASE_URL'] || 'http://localhost:7546';
  __ENV['DEFAULT_DURATION'] = __ENV['DEFAULT_DURATION'] || '120s';
  __ENV['DEFAULT_VUS'] = __ENV['DEFAULT_VUS'] || 10;
  __ENV['DEFAULT_LIMIT'] = __ENV['DEFAULT_LIMIT'] || 100;
  __ENV['DEFAULT_PASS_RATE'] = __ENV['DEFAULT_PASS_RATE'] || 0.95;
  __ENV['DEFAULT_MAX_DURATION'] = __ENV['DEFAULT_MAX_DURATION'] || 500;
  __ENV['STRESS_TEST_TARGET_TOTAL_RPS'] = __ENV['STRESS_TEST_TARGET_TOTAL_RPS'] || 100;

  // Staged RPS phase durations for ramping-arrival-rate executor
  __ENV['RAMP_UP_DURATION'] = __ENV['RAMP_UP_DURATION'] || '2m';
  __ENV['STABLE_DURATION'] = __ENV['STABLE_DURATION'] || '20m';
  __ENV['RAMP_DOWN_DURATION'] = __ENV['RAMP_DOWN_DURATION'] || '1m';
};
