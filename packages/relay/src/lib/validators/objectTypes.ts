// SPDX-License-Identifier: Apache-2.0

import { TracerType } from '../constants';
import { predefined } from '../errors/JsonRpcError';
import { validateObject } from './utils';

export type IObjectSchema = {
  name: string;
  properties: {
    [prop: string]: IObjectParamSchema;
  };
  failOnEmpty?: boolean;
  failOnUnexpectedParams?: boolean;
  deleteUnknownProperties?: boolean;
};

type IObjectParamSchema = {
  type: string;
  nullable: boolean;
  required?: boolean;
};

export const OBJECTS_VALIDATIONS: { [key: string]: IObjectSchema } = {
  blockHashObject: {
    name: 'BlockHashObject',
    failOnUnexpectedParams: true,
    properties: {
      blockHash: {
        type: 'blockHash',
        nullable: false,
      },
    },
  },
  blockNumberObject: {
    name: 'BlockNumberObject',
    failOnUnexpectedParams: true,
    properties: {
      blockNumber: {
        type: 'blockNumber',
        nullable: false,
      },
    },
  },
  filter: {
    name: 'FilterObject',
    failOnUnexpectedParams: true,
    properties: {
      blockHash: {
        type: 'blockHash',
        nullable: false,
      },
      fromBlock: {
        type: 'blockNumber',
        nullable: false,
      },
      toBlock: {
        type: 'blockNumber',
        nullable: false,
      },
      address: {
        type: 'addressFilter',
        nullable: false,
      },
      topics: {
        type: 'topics',
        nullable: false,
      },
    },
  },
  callTracerConfig: {
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
  },
  opcodeLoggerConfig: {
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
  },
  tracerConfigWrapper: {
    name: 'TracerConfigWrapper',
    failOnEmpty: true,
    failOnUnexpectedParams: true,
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
      // OpcodeLogger config properties at top level
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
  },
  transaction: {
    name: 'TransactionObject',
    failOnUnexpectedParams: false,
    deleteUnknownProperties: true,
    properties: {
      from: {
        type: 'address',
        nullable: false,
      },
      to: {
        type: 'address',
        nullable: true,
      },
      gas: {
        type: 'hex',
        nullable: false,
      },
      gasPrice: {
        type: 'hex',
        nullable: false,
      },
      maxPriorityFeePerGas: {
        type: 'hex',
        nullable: false,
      },
      maxFeePerGas: {
        type: 'hex',
        nullable: false,
      },
      value: {
        type: 'hex',
        nullable: false,
      },
      data: {
        type: 'hexEvenLength',
        nullable: true,
      },
      type: {
        type: 'hex',
        nullable: false,
      },
      chainId: {
        type: 'hex',
        nullable: false,
      },
      nonce: {
        type: 'hex',
        nullable: false,
      },
      input: {
        type: 'hex',
        nullable: false,
      },
      accessList: {
        type: 'array',
        nullable: false,
      },
    },
  },
  ethSubscribeLogsParams: {
    name: 'EthSubscribeLogsParamsObject',
    failOnUnexpectedParams: true,
    properties: {
      address: {
        type: 'addressFilter',
        nullable: false,
        required: false,
      },
      topics: {
        type: 'topics',
        nullable: false,
      },
    },
  },
};

export function validateSchema(schema: IObjectSchema, object: any) {
  const expectedParams = Object.keys(schema.properties);
  const actualParams = Object.keys(object);
  if (schema.failOnUnexpectedParams) {
    const unknownParam = actualParams.find((param) => !expectedParams.includes(param));
    if (unknownParam) {
      throw predefined.INVALID_PARAMETER(`'${unknownParam}' for ${schema.name}`, `Unknown parameter`);
    }
  }
  if (schema.deleteUnknownProperties) {
    const unknownParams = actualParams.filter((param) => !expectedParams.includes(param));
    for (const param of unknownParams) {
      delete object[param];
    }
  }
  return validateObject(object, schema);
}

export function validateEthSubscribeLogsParamObject(param: any): boolean {
  const schema = OBJECTS_VALIDATIONS.ethSubscribeLogsParams;
  const valid = validateSchema(schema, param);
  // Check if the address is an array and has a length of 0
  // address and is not an empty array
  if (valid && Array.isArray(param.address) && param.address.length === 0 && schema.properties.address.required) {
    throw predefined.MISSING_REQUIRED_PARAMETER(`'address' for ${schema.name}`);
  }

  return valid;
}

export function validateTracerConfigWrapper(param: any): boolean {
  const schema = OBJECTS_VALIDATIONS.tracerConfigWrapper;
  const valid = validateSchema(schema, param);
  const { tracer, tracerConfig } = param;

  const callTracerKeys = Object.keys(OBJECTS_VALIDATIONS.callTracerConfig.properties);
  const opcodeLoggerKeys = Object.keys(OBJECTS_VALIDATIONS.opcodeLoggerConfig.properties);

  // Check for opcodeLogger config properties at the top level
  const topLevelKeys = Object.keys(param);
  const hasTopLevelOpcodeLoggerKeys = topLevelKeys.some((k) => opcodeLoggerKeys.includes(k));

  // Check for tracer config properties in nested tracerConfig
  let hasNestedCallTracerKeys = false;
  let hasNestedOpcodeLoggerKeys = false;
  if (tracerConfig) {
    const configKeys = Object.keys(tracerConfig);
    hasNestedCallTracerKeys = configKeys.some((k) => callTracerKeys.includes(k));
    hasNestedOpcodeLoggerKeys = configKeys.some((k) => opcodeLoggerKeys.includes(k));
  }

  // Don't allow both top-level and nested config properties at the same time
  if (hasTopLevelOpcodeLoggerKeys && tracerConfig) {
    throw predefined.INVALID_PARAMETER(
      1,
      `Cannot specify tracer config properties both at top level and in 'tracerConfig' for ${schema.name}`,
    );
  }

  // Determine which tracer type should be used
  const effectiveTracer = tracer ?? TracerType.OpcodeLogger; // Default to opcodeLogger if no tracer specified

  // Validate that opcodeLogger config properties are only used with opcodeLogger tracer
  if (hasTopLevelOpcodeLoggerKeys && effectiveTracer !== TracerType.OpcodeLogger) {
    throw predefined.INVALID_PARAMETER(
      1,
      `opcodeLogger config properties for ${schema.name} are only valid when tracer=${TracerType.OpcodeLogger}`,
    );
  }

  // Validate nested config properties with tracer types (existing logic)
  if (hasNestedCallTracerKeys && effectiveTracer === TracerType.OpcodeLogger) {
    throw predefined.INVALID_PARAMETER(
      1,
      `callTracer config properties for ${schema.name} are only valid when tracer=${TracerType.CallTracer}`,
    );
  }

  if (hasNestedOpcodeLoggerKeys && effectiveTracer !== TracerType.OpcodeLogger) {
    throw predefined.INVALID_PARAMETER(
      1,
      `opcodeLogger config properties for ${schema.name} are only valid when tracer=${TracerType.OpcodeLogger}`,
    );
  }

  return valid;
}
