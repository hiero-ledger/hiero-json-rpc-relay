// SPDX-License-Identifier: Apache-2.0

import { Validator } from '.';
import { IMethodParamSchema, IObjectSchema, ITypeValidation } from '../types';
import { JsonRpcError, predefined } from '../errors/JsonRpcError';

export function validateParam(index: number | string, param: any, validation: IMethodParamSchema): void {
  const paramType = getParamType(validation.type);

  if (paramType === undefined) {
    throw predefined.INTERNAL_ERROR(`Missing or unsupported param type '${validation.type}'`);
  }

  if (requiredIsMissing(param, validation.required)) {
    throw predefined.MISSING_REQUIRED_PARAMETER(index);
  } else if (!validation.required && param === undefined) {
    //if parameter is undefined and not required, no need to validate
    //e.g estimateGas method, blockNumber is not required
    return;
  }

  if (param === null) {
    throw predefined.INVALID_PARAMETER(index, `The value passed is not valid: ${param}.`);
  }

  if (Array.isArray(paramType)) {
    const results: any[] = [];
    for (const validator of paramType) {
      const result = validator.test(param);
      results.push(result);
    }
    if (!results.some((item) => item === true)) {
      const errorMessages = paramType.map((validator) => validator.error).join(' OR ');
      throw predefined.INVALID_PARAMETER(index, `The value passed is not valid: ${param}. ${errorMessages}`);
    }
  }

  if (!Array.isArray(paramType)) {
    if (!paramType.test(param)) {
      const paramString = typeof param === 'object' ? JSON.stringify(param) : param;
      throw predefined.INVALID_PARAMETER(index, `${paramType.error}, value: ${paramString}`);
    }
  }
}

function getParamType(validationType: string): ITypeValidation | ITypeValidation[] {
  if (validationType?.includes('|')) {
    return validationType.split('|').map((type) => Validator.TYPES[type]);
  } else {
    return Validator.TYPES[validationType];
  }
}

export function validateObject<T extends object = any>(object: T, filters: IObjectSchema) {
  for (const property of Object.keys(filters.properties)) {
    const validation = filters.properties[property];
    const param = object[property];

    if (requiredIsMissing(param, validation.required)) {
      throw predefined.MISSING_REQUIRED_PARAMETER(`'${property}' for ${filters.name}`);
    }

    if (isValidAndNonNullableParam(param, validation.nullable)) {
      try {
        const result = Validator.TYPES[validation.type].test(param);

        if (!result) {
          const paramString = typeof param === 'object' ? JSON.stringify(param) : param;
          throw predefined.INVALID_PARAMETER(
            `'${property}' for ${filters.name}`,
            `${Validator.TYPES[validation.type].error}, value: ${paramString}`,
          );
        }
      } catch (error: any) {
        if (error instanceof JsonRpcError) {
          const paramString = typeof param === 'object' ? JSON.stringify(param) : param;
          throw predefined.INVALID_PARAMETER(
            `'${property}' for ${filters.name}`,
            `${Validator.TYPES[validation.type].error}, value: ${paramString}`,
          );
        }

        throw error;
      }
    }
  }

  const paramsMatchingFilters = Object.keys(filters.properties).filter((key) => object[key] !== undefined);
  return !filters.failOnEmpty || paramsMatchingFilters.length > 0;
}

export function validateArray(array: any[], innerType?: string): boolean {
  if (!innerType) return true;

  const isInnerType = (element: any) => Validator.TYPES[innerType].test(element);

  return array.every(isInnerType);
}

export function requiredIsMissing(param: any, required: boolean | undefined): boolean {
  return required === true && param === undefined;
}

export function isValidAndNonNullableParam(param: any, nullable: boolean): boolean {
  return param !== undefined && (param !== null || !nullable);
}
