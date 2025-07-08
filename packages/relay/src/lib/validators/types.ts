// SPDX-License-Identifier: Apache-2.0

import { predefined } from '../errors/JsonRpcError';
import { ICallTracerConfig, IOpcodeLoggerConfig, ITracerConfig, ITracerConfigWrapper } from '../types';
import * as Constants from './constants';
import { OBJECTS_VALIDATIONS, validateSchema, validateTracerConfigWrapper } from './objectTypes';
import { validateArray } from './utils';

export const TYPES = {
  address: {
    test: (param) => new RegExp(Constants.BASE_HEX_REGEX + '{40}$').test(param),
    error: Constants.ADDRESS_ERROR,
  },
  addressFilter: {
    test: (param: string | string[]) => {
      return Array.isArray(param)
        ? validateArray(param.flat(), 'address')
        : new RegExp(Constants.BASE_HEX_REGEX + '{40}$').test(param);
    },
    error: `${Constants.ADDRESS_ERROR} or an array of addresses`,
  },
  array: {
    test: (param: any, innerType?: any) => {
      return Array.isArray(param) ? validateArray(param, innerType) : false;
    },
    error: 'Expected Array',
  },
  blockHash: {
    test: (param: string) => new RegExp(Constants.BASE_HEX_REGEX + '{64}$').test(param),
    error: Constants.BLOCK_HASH_ERROR,
  },
  blockNumber: {
    test: (param: string) =>
      (/^0[xX]([1-9A-Fa-f][0-9A-Fa-f]{0,13}|0)$/.test(param) && Number.MAX_SAFE_INTEGER >= Number(param)) ||
      ['earliest', 'latest', 'pending', 'finalized', 'safe'].includes(param),
    error: Constants.BLOCK_NUMBER_ERROR,
  },
  boolean: {
    test: (param: boolean) => param === true || param === false,
    error: 'Expected boolean type',
  },
  blockParams: {
    test: (param: any) => {
      if (Object.prototype.toString.call(param) === '[object Object]') {
        if (Object.prototype.hasOwnProperty.call(param, 'blockHash')) {
          return validateSchema(OBJECTS_VALIDATIONS.blockHashObject, param);
        }
        return validateSchema(OBJECTS_VALIDATIONS.blockNumberObject, param);
      }
      return (
        (/^0[xX]([1-9A-Fa-f]+[0-9A-Fa-f]{0,13}|0)$/.test(param) && Number.MAX_SAFE_INTEGER >= Number(param)) ||
        ['earliest', 'latest', 'pending', 'finalized', 'safe'].includes(param)
      );
    },
    error: Constants.BLOCK_PARAMS_ERROR,
  },
  filter: {
    test: (param: any) => {
      if (Object.prototype.toString.call(param) === '[object Object]') {
        if (param.blockHash && (param.toBlock || param.fromBlock)) {
          throw predefined.INVALID_PARAMETER(0, "Can't use both blockHash and toBlock/fromBlock");
        }
        return validateSchema(OBJECTS_VALIDATIONS.filter, param);
      }

      return false;
    },
    error: `Expected FilterObject`,
  },
  hex: {
    test: (param: string) => new RegExp(Constants.BASE_HEX_REGEX + '*$').test(param),
    error: Constants.DEFAULT_HEX_ERROR,
  },
  hexEvenLength: {
    test: (param: string) => new RegExp(Constants.BASE_HEX_REGEX + '*$').test(param) && !(param.length % 2),
    error: Constants.EVEN_HEX_ERROR,
  },
  hex64: {
    test: (param: string) => new RegExp(Constants.BASE_HEX_REGEX + '{1,64}$').test(param),
    error: Constants.HASH_ERROR,
  },
  topicHash: {
    test: (param: string) => new RegExp(Constants.BASE_HEX_REGEX + '{64}$').test(param) || param === null,
    error: Constants.TOPIC_HASH_ERROR,
  },
  topics: {
    test: (param: string[] | string[][]) => {
      return Array.isArray(param) ? validateArray(param.flat(), 'topicHash') : false;
    },
    error: `Expected an array or array of arrays containing ${Constants.HASH_ERROR} of a topic`,
  },
  transaction: {
    test: (param: any) => {
      if (Object.prototype.toString.call(param) === '[object Object]') {
        return validateSchema(OBJECTS_VALIDATIONS.transaction, param);
      }

      return false;
    },
    error: 'Expected TransactionObject',
  },
  transactionHash: {
    test: (param: string) => new RegExp(Constants.BASE_HEX_REGEX + '{64}$').test(param),
    error: Constants.TRANSACTION_HASH_ERROR,
  },
  tracerType: {
    test: (param: any): param is Constants.TracerType =>
      typeof param === 'string' &&
      Object.values(Constants.TracerType)
        .map((tracerType) => tracerType.toString())
        .includes(param),
    error: 'Expected TracerType',
  },
  callTracerConfig: {
    test: (param: any): param is ICallTracerConfig => {
      if (param && typeof param === 'object') {
        return validateSchema(OBJECTS_VALIDATIONS.callTracerConfig, param);
      }
      return false;
    },
    error: 'Expected CallTracerConfig',
  },
  opcodeLoggerConfig: {
    test: (param: any): param is IOpcodeLoggerConfig => {
      if (param && typeof param === 'object') {
        return validateSchema(OBJECTS_VALIDATIONS.opcodeLoggerConfig, param);
      }
      return false;
    },
    error: 'Expected OpcodeLoggerConfig',
  },
  tracerConfig: {
    test: (param: Record<string, any>): param is ITracerConfig => {
      if (param && typeof param === 'object') {
        const isEmptyObject = Object.keys(param).length === 0;
        const isValidCallTracerConfig = TYPES.callTracerConfig.test(param);
        const isValidOpcodeLoggerConfig = TYPES.opcodeLoggerConfig.test(param);
        return isEmptyObject || isValidCallTracerConfig || isValidOpcodeLoggerConfig;
      }
      return false;
    },
    error: 'Expected TracerConfig',
  },
  tracerConfigWrapper: {
    test: (param: any): param is ITracerConfigWrapper => {
      if (param && typeof param === 'object') {
        return validateTracerConfigWrapper(param);
      }
      return false;
    },
    error: 'Expected TracerConfigWrapper which contains a valid TracerType and/or TracerConfig',
  },
} satisfies {
  [paramTypeName: string]: {
    test: (param: any) => boolean;
    error: string;
  };
};
