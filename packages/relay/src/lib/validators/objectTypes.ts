// SPDX-License-Identifier: Apache-2.0

import { TracerType } from '../constants';
import { predefined } from '../errors/JsonRpcError';
import {
  ICallTracerConfig,
  IObjectSchema,
  IObjectValidation,
  IOpcodeLoggerConfig,
  ITracerConfigWrapper,
} from '../types';
import { Validator } from '.';

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

export class DefaultValidation<T extends object = any> implements IObjectValidation<T> {
  private readonly _object: T;
  protected readonly schema: IObjectSchema;

  constructor(schema: IObjectSchema, object: T) {
    this.schema = schema;
    this._object = object;
  }

  get object(): T {
    return this._object;
  }

  validate() {
    if (this.schema.failOnUnexpectedParams) {
      this.checkForUnexpectedParams();
    }
    if (this.schema.deleteUnknownProperties) {
      this.deleteUnknownProperties();
    }
    return Validator.validateObject(this.object, this.schema);
  }

  name() {
    return this.schema.name;
  }

  checkForUnexpectedParams() {
    const expectedParams = Object.keys(this.schema.properties);
    const actualParams = Object.keys(this.object);
    const unknownParam = actualParams.find((param) => !expectedParams.includes(param));
    if (unknownParam) {
      throw predefined.INVALID_PARAMETER(`'${unknownParam}' for ${this.schema.name}`, `Unknown parameter`);
    }
  }

  deleteUnknownProperties() {
    const expectedParams = Object.keys(this.schema.properties);
    const actualParams = Object.keys(this.object);
    const unknownParams = actualParams.filter((param) => !expectedParams.includes(param));
    for (const param of unknownParams) {
      delete this.object[param];
    }
  }
}

export class TransactionObject extends DefaultValidation {
  constructor(transaction: any) {
    super(OBJECTS_VALIDATIONS.transaction, transaction);
  }
}

export class FilterObject extends DefaultValidation {
  constructor(filter: any) {
    super(OBJECTS_VALIDATIONS.filter, filter);
  }

  validate() {
    if (this.object.blockHash && (this.object.toBlock || this.object.fromBlock)) {
      throw predefined.INVALID_PARAMETER(0, "Can't use both blockHash and toBlock/fromBlock");
    }
    return super.validate();
  }
}

export class BlockHashObject extends DefaultValidation {
  constructor(param: any) {
    super(OBJECTS_VALIDATIONS.blockHashObject, param);
  }
}

export class BlockNumberObject extends DefaultValidation {
  constructor(param: any) {
    super(OBJECTS_VALIDATIONS.blockNumberObject, param);
  }
}

export class EthSubscribeLogsParamsObject extends DefaultValidation {
  constructor(param: any) {
    super(OBJECTS_VALIDATIONS.ethSubscribeLogsParams, param);
  }

  validate() {
    const valid = super.validate();
    // address and is not an empty array
    if (
      valid &&
      Array.isArray(this.object.address) &&
      this.object.address.length === 0 &&
      OBJECTS_VALIDATIONS.ethSubscribeLogsParams.properties.address.required
    ) {
      throw predefined.MISSING_REQUIRED_PARAMETER(`'address' for ${this.schema.name}`);
    }

    return valid;
  }
}

export class CallTracerConfig extends DefaultValidation<ICallTracerConfig> {
  constructor(config: any) {
    super(OBJECTS_VALIDATIONS.callTracerConfig, config);
  }
}

export class OpcodeLoggerConfig extends DefaultValidation<IOpcodeLoggerConfig> {
  constructor(config: any) {
    super(OBJECTS_VALIDATIONS.opcodeLoggerConfig, config);
  }
}

export class TracerConfigWrapper extends DefaultValidation<ITracerConfigWrapper> {
  constructor(config: any) {
    super(OBJECTS_VALIDATIONS.tracerConfigWrapper, config);
  }

  validate() {
    const valid = super.validate();

    const { tracer, tracerConfig } = this.object;

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
        `callTracer 'tracerConfig' for ${this.name()} is only valid when tracer=${TracerType.CallTracer}`,
      );
    }

    if (hasOpcodeLoggerKeys && tracer !== TracerType.OpcodeLogger) {
      throw predefined.INVALID_PARAMETER(
        1,
        `opcodeLogger 'tracerConfig' for ${this.name()} is only valid when tracer=${TracerType.OpcodeLogger}`,
      );
    }
    return valid;
  }
}
