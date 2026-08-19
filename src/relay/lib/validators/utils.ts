// SPDX-License-Identifier: Apache-2.0

import { JsonRpcError, predefined } from '../errors/JsonRpcError';
import { type IObjectSchema } from './objectTypes';
import { TYPES } from './types';

export function validateObject<T extends object>(object: T, filters: IObjectSchema): boolean {
  const properties = object as Record<string, unknown>;

  for (const property of Object.keys(filters.properties)) {
    const validation = filters.properties[property];
    const param = properties[property];

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
      } catch (error) {
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

  const paramsMatchingFilters = Object.keys(filters.properties).filter((key) => properties[key] !== undefined);
  return !filters.failOnEmpty || paramsMatchingFilters.length > 0;
}

export function validateArray(array: unknown[], innerType?: string): boolean {
  if (!innerType) return true;

  const isInnerType = (element: unknown): boolean => TYPES[innerType as keyof typeof TYPES].test(element);

  return array.every(isInnerType);
}

export function requiredIsMissing(param: unknown, required: boolean | undefined): boolean {
  return required === true && param === undefined;
}

export function isValidAndNonNullableParam(param: unknown, nullable: boolean): boolean {
  return param !== undefined && (param !== null || !nullable);
}
