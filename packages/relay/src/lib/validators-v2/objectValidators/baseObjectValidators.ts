// SPDX-License-Identifier: Apache-2.0

import { JsonRpcError, predefined } from '../../errors/JsonRpcError';
import { IObjectValidatorDefinition, IObjectValidator } from '../../types';
import { isValidAndNonNullableParam, requiredIsMissing } from '../helper';
import { PRIMITIVE_VALIDATORS } from '../primitiveValidators';

/**
 * Base class for object validators
 */
export abstract class BaseObjectValidator<T extends object = any> implements IObjectValidator<T> {
  protected readonly _object: T;
  protected readonly objectValidator: IObjectValidatorDefinition;

  constructor(objectValidator: IObjectValidatorDefinition, object: T) {
    this.objectValidator = objectValidator;
    this._object = object;
  }

  get object(): T {
    return this._object;
  }

  validate(): boolean {
    if (this.objectValidator.failOnUnexpectedParams) {
      this.checkForUnexpectedParams();
    }
    if (this.objectValidator.deleteUnknownProperties) {
      this.deleteUnknownProperties();
    }

    return this.validateObject();
  }

  name(): string {
    return this.objectValidator.name;
  }

  protected checkForUnexpectedParams(): void {
    const expectedParams = Object.keys(this.objectValidator.properties);
    const actualParams = Object.keys(this.object);
    const unknownParam = actualParams.find((param) => !expectedParams.includes(param));
    if (unknownParam) {
      throw predefined.INVALID_PARAMETER(`'${unknownParam}' for ${this.objectValidator.name}`, `Unknown parameter`);
    }
  }

  protected deleteUnknownProperties(): void {
    const expectedParams = Object.keys(this.objectValidator.properties);
    const actualParams = Object.keys(this.object);
    const unknownParams = actualParams.filter((param) => !expectedParams.includes(param));
    for (const param of unknownParams) {
      delete this.object[param];
    }
  }

  protected validateObject(): boolean {
    for (const property of Object.keys(this.objectValidator.properties)) {
      const validation = this.objectValidator.properties[property];
      const param = this.object[property];

      if (requiredIsMissing(param, validation.required)) {
        throw predefined.MISSING_REQUIRED_PARAMETER(`'${property}' for ${this.objectValidator.name}`);
      }

      if (isValidAndNonNullableParam(param, validation.nullable ?? false)) {
        try {
          const validator = PRIMITIVE_VALIDATORS[validation.type];
          if (!validator.test(param)) {
            const paramString = typeof param === 'object' ? JSON.stringify(param) : param;
            throw predefined.INVALID_PARAMETER(
              `'${property}' for ${this.objectValidator.name}`,
              `${validator.error}, value: ${paramString}`,
            );
          }
        } catch (error: any) {
          if (error instanceof JsonRpcError) {
            const paramString = typeof param === 'object' ? JSON.stringify(param) : param;
            throw predefined.INVALID_PARAMETER(
              `'${property}' for ${this.objectValidator.name}`,
              `Invalid value: ${paramString}`,
            );
          }

          throw error;
        }
      }
    }

    const paramsMatchingFilters = Object.keys(this.objectValidator.properties).filter(
      (key) => this.object[key] !== undefined,
    );
    return !this.objectValidator.failOnEmpty || paramsMatchingFilters.length > 0;
  }
}
