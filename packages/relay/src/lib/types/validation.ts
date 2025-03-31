// SPDX-License-Identifier: Apache-2.0

/**
 * Represents a validation rule for a parameter
 */
export interface IParamValidation {
  /**
   * The type of parameter to validate against
   * Can be a ParamType enum value or a compound type string with pipe symbol (e.g., 'blockNumber|blockHash')
   */
  type: ParamType | string;

  /**
   * Whether the parameter is required
   */
  required: boolean;

  /**
   * Optional custom error message
   */
  errorMessage?: string;
}

/**
 * Standard parameter types supported by the validator
 * These are the basic types used in parameter validation schemas
 */
export enum ParamType {
  // Basic types
  ADDRESS = 'address',
  BLOCK_NUMBER = 'blockNumber',
  BLOCK_HASH = 'blockHash',
  TRANSACTION_HASH = 'transactionHash',
  TRANSACTION_ID = 'transactionId',
  BLOCK_NUMBER_OR_HASH = 'blockNumber|blockHash',
  TRANSACTION_HASH_OR_ID = 'transactionHash|transactionId',

  // Hex types
  HEX = 'hex',
  HEX64 = 'hex64',

  // Complex objects
  TRANSACTION = 'transaction',
  BLOCK_PARAMS = 'blockParams',
  FILTER = 'filter',

  // Debug tracer types
  TRACER_TYPE = 'tracerType',
  TRACER_CONFIG = 'tracerConfig',
  TRACER_CONFIG_WRAPPER = 'tracerConfigWrapper',
  COMBINED_TRACER_TYPE = 'tracerType|tracerConfig|tracerConfigWrapper',

  // Basic JavaScript types
  BOOLEAN = 'boolean',
  ARRAY = 'array',
}

/**
 * Validation rule for a parameter type
 */
export interface ITypeValidator {
  /**
   * Validates the parameter value against this type
   */
  validate: (value: any) => boolean;

  /**
   * Error message when validation fails
   */
  errorMessage: string;
}

/**
 * Registry of validation schemas for RPC methods
 */
export type ValidationSchemaRegistry = Map<string, Record<number, IParamValidation>>;

export type IMethodValidation = {
  [index: number]: IMethodParamSchema;
};

export type IMethodParamSchema = {
  type: string;
  required?: boolean;
};

export type IObjectSchema = {
  name: string;
  properties: {
    [key: string]: IObjectParamSchema;
  };
  failOnEmpty?: boolean;
  failOnUnexpectedParams?: boolean;
  deleteUnknownProperties?: boolean;
};

export type IObjectParamSchema = {
  type: string;
  nullable: boolean;
  required?: boolean;
};

export interface IObjectValidation<T extends object = any> {
  get object(): T;
  validate(): boolean;
  name(): string;
  checkForUnexpectedParams(): void;
  deleteUnknownProperties(): void;
}

export type ITypeValidation = {
  test: (param: any) => boolean;
  error: string;
};
