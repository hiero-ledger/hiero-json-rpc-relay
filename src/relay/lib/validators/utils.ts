// SPDX-License-Identifier: Apache-2.0

import { JsonRpcError, predefined } from '../errors/JsonRpcError';
import { IObjectSchema } from './objectTypes';
import { TYPES } from './types';

export function validateObject<T extends object = any>(object: T, filters: IObjectSchema) {
  for (const property of Object.keys(filters.properties)) {
    const validation = filters.properties[property];
    const param = object[property];

    if (requiredIsMissing(param, validation.required)) {
      throw predefined.MISSING_REQUIRED_PARAMETER(`'${property}' for ${filters.name}`);
    }

    if (isValidAndNonNullableParam(param, validation.nullable)) {
      try {
        const result = TYPES[validation.type].test(param);

        if (!result) {
          const paramString = typeof param === 'object' ? JSON.stringify(param) : param;
          throw predefined.INVALID_PARAMETER(
            `'${property}' for ${filters.name}`,
            `${TYPES[validation.type].error}, value: ${paramString}`,
          );
        }
      } catch (error: any) {
        if (error instanceof JsonRpcError) {
          const paramString = typeof param === 'object' ? JSON.stringify(param) : param;
          throw predefined.INVALID_PARAMETER(
            `'${property}' for ${filters.name}`,
            `${TYPES[validation.type].error}, value: ${paramString}`,
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

  const isInnerType = (element: any) => TYPES[innerType].test(element);

  return array.every(isInnerType);
}

export function requiredIsMissing(param: any, required: boolean | undefined): boolean {
  return required === true && param === undefined;
}

export function isValidAndNonNullableParam(param: any, nullable: boolean): boolean {
  return param !== undefined && (param !== null || !nullable);
}
