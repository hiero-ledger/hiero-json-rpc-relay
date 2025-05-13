// SPDX-License-Identifier: Apache-2.0

import { ICallTracerConfig, IObjectValidatorDefinition, IOpcodeLoggerConfig, ITracerConfigWrapper } from '../../types';
import { BaseObjectValidator } from '.';
import { predefined } from '../../errors/JsonRpcError';

/**
 * Call tracer config object definition
 */
export const CALL_TRACER_CONFIG_OBJECT: IObjectValidatorDefinition = {
  name: 'CallTracerConfig',
  failOnEmpty: true,
  failOnUnexpectedParams: false,
  properties: {
    onlyTopCall: {
      type: 'boolean',
      nullable: false,
      required: false,
    },
  },
};

/**
 * Opcode logger config object definition
 */
export const OPCODE_LOGGER_CONFIG_OBJECT: IObjectValidatorDefinition = {
  name: 'OpcodeLoggerConfig',
  failOnEmpty: true,
  failOnUnexpectedParams: false,
  properties: {
    // Will be ignored in the implementation,
    // added here only for validation purposes
    disableMemory: {
      type: 'boolean',
      nullable: false,
      required: false,
    },
    enableMemory: {
      type: 'boolean',
      nullable: false,
      required: false,
    },
    disableStack: {
      type: 'boolean',
      nullable: false,
      required: false,
    },
    disableStorage: {
      type: 'boolean',
      nullable: false,
      required: false,
    },
  },
};

/**
 * Tracer config wrapper object definition
 */
export const TRACER_CONFIG_WRAPPER_OBJECT: IObjectValidatorDefinition = {
  name: 'TracerConfigWrapper',
  failOnEmpty: true,
  failOnUnexpectedParams: false,
  properties: {
    tracer: {
      type: 'tracerType',
      nullable: false,
      required: false,
    },
    tracerConfig: {
      type: 'tracerConfig',
      nullable: false,
      required: false,
    },
  },
};

/**
 * Call tracer config object validator
 */
export class CallTracerConfigObjectValidator extends BaseObjectValidator<ICallTracerConfig> {
  constructor(config: any) {
    super(CALL_TRACER_CONFIG_OBJECT, config);
  }
}

/**
 * Opcode logger config object validator
 */
export class OpcodeLoggerConfigObjectValidator extends BaseObjectValidator<IOpcodeLoggerConfig> {
  constructor(config: any) {
    super(OPCODE_LOGGER_CONFIG_OBJECT, config);
  }
}

/**
 * Tracer config wrapper object validator
 */
export class TracerConfigWrapperObjectValidator extends BaseObjectValidator<ITracerConfigWrapper> {
  constructor(config: any) {
    super(TRACER_CONFIG_WRAPPER_OBJECT, config);
  }

  validate(): boolean {
    // Must have at least one of tracer or tracerConfig
    if (!this.object.hasOwnProperty('tracer') && !this.object.hasOwnProperty('tracerConfig')) {
      throw predefined.INVALID_PARAMETER(
        'TracerConfigWrapper',
        'Must contain either a tracer or tracerConfig property',
      );
    }

    return super.validate();
  }
}
