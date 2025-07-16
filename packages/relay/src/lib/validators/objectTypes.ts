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

  if (!tracerConfig) {
    return valid;
  }

  const callTracerKeys = Object.keys(OBJECTS_VALIDATIONS.callTracerConfig.properties);
  const opcodeLoggerKeys = Object.keys(OBJECTS_VALIDATIONS.opcodeLoggerConfig.properties);

  const configKeys = Object.keys(tracerConfig);
  const hasCallTracerKeys = configKeys.some((k) => callTracerKeys.includes(k));
  const hasOpcodeLoggerKeys = configKeys.some((k) => opcodeLoggerKeys.includes(k));

  // we want to accept ICallTracerConfig only if the tracer is callTracer
  // this config is not valid for opcodeLogger and vice versa
  // accept only IOpcodeLoggerConfig with opcodeLogger tracer
  if (hasCallTracerKeys && tracer === TracerType.OpcodeLogger) {
    throw predefined.INVALID_PARAMETER(
      1,
      `callTracer 'tracerConfig' for ${schema.name} is only valid when tracer=${TracerType.CallTracer}`,
    );
  }

  if (hasOpcodeLoggerKeys && tracer !== TracerType.OpcodeLogger) {
    throw predefined.INVALID_PARAMETER(
      1,
      `opcodeLogger 'tracerConfig' for ${schema.name} is only valid when tracer=${TracerType.OpcodeLogger}`,
    );
  }
  return valid;
}
