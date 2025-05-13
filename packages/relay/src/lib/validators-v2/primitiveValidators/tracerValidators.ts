// SPDX-License-Identifier: Apache-2.0

import { ICallTracerConfig, IOpcodeLoggerConfig, IPrimitiveValidator, ITracerConfig } from '../../types';
import { TracerType } from '../../constants';
import { validateObject } from '../helper';
import {
  CallTracerConfigObjectValidator,
  OpcodeLoggerConfigObjectValidator,
  TracerConfigWrapperObjectValidator,
} from '../objectValidators';
/**
 * Tracer type validator
 */
export const tracerTypeValidator: IPrimitiveValidator = {
  test: (param: any): param is TracerType =>
    typeof param === 'string' &&
    Object.values(TracerType)
      .map((tracerType) => tracerType.toString())
      .includes(param),
  error: 'Expected TracerType',
};

/**
 * Call tracer config validator
 */
export const callTracerConfigValidator: IPrimitiveValidator = {
  test: (param: any): param is ICallTracerConfig => {
    if (param && typeof param === 'object') {
      return validateObject(param, new CallTracerConfigObjectValidator(param));
    }
    return false;
  },
  error: 'Expected CallTracerConfig',
};

/**
 * Opcode logger config validator
 */
export const opcodeLoggerConfigValidator: IPrimitiveValidator = {
  test: (param: any): param is IOpcodeLoggerConfig => {
    if (param && typeof param === 'object') {
      return validateObject(param, new OpcodeLoggerConfigObjectValidator(param));
    }
    return false;
  },
  error: 'Expected OpcodeLoggerConfig',
};

/**
 * Generic tracer config validator
 */
export const tracerConfigValidator: IPrimitiveValidator = {
  test: (param: Record<string, any>): param is ITracerConfig => {
    if (param && typeof param === 'object') {
      const isEmptyObject = Object.keys(param).length === 0;
      const isValidCallTracerConfig = callTracerConfigValidator.test(param);
      const isValidOpcodeLoggerConfig = opcodeLoggerConfigValidator.test(param);
      return isEmptyObject || isValidCallTracerConfig || isValidOpcodeLoggerConfig;
    }
    return false;
  },
  error: 'Expected TracerConfig',
};

/**
 * Tracer config wrapper validator
 */
export const tracerConfigWrapperValidator: IPrimitiveValidator = {
  test: (param: any) => {
    if (param && typeof param === 'object') {
      return validateObject(param, new TracerConfigWrapperObjectValidator(param));
    }
    return false;
  },
  error: 'Expected TracerConfigWrapper which contains a valid TracerType and/or TracerConfig',
};
