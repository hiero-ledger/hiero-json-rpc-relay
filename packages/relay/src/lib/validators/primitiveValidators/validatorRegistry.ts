// SPDX-License-Identifier: Apache-2.0

import { IPrimitiveValidator } from '../../types';
import {
  booleanValidator,
  hexValidator,
  hexEvenLengthValidator,
  hex64Validator,
  arrayValidator,
  tracerTypeValidator,
  tracerConfigValidator,
  tracerConfigWrapperValidator,
  addressValidator,
  addressFilterValidator,
  blockHashValidator,
  blockNumberValidator,
  blockParamsValidator,
  transactionHashValidator,
  transactionIdValidator,
  transactionValidator,
  filterValidator,
  topicHashValidator,
  topicsValidator,
  callTracerConfigValidator,
  opcodeLoggerConfigValidator,
} from '.';

/**
 * Registry of all primitive validators
 */
export const PRIMITIVE_VALIDATORS: { [key: string]: IPrimitiveValidator } = {
  // Basic validators
  boolean: booleanValidator,
  hex: hexValidator,
  hexEvenLength: hexEvenLengthValidator,
  hex64: hex64Validator,
  array: arrayValidator,

  // Address validators
  address: addressValidator,
  addressFilter: addressFilterValidator,

  // Block validators
  blockHash: blockHashValidator,
  blockNumber: blockNumberValidator,
  blockParams: blockParamsValidator,

  // Transaction validators
  transactionHash: transactionHashValidator,
  transactionId: transactionIdValidator,
  transaction: transactionValidator,
  topicHash: topicHashValidator,
  topics: topicsValidator,

  // Filter validators
  filter: filterValidator,

  // Tracer Validators
  tracerType: tracerTypeValidator,
  tracerConfig: tracerConfigValidator,
  tracerConfigWrapper: tracerConfigWrapperValidator,
  callTracerConfig: callTracerConfigValidator,
  opcodeLoggerConfig: opcodeLoggerConfigValidator,
};
