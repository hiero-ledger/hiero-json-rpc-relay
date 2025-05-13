// SPDX-License-Identifier: Apache-2.0

import { IParamValidation, IPrimitiveValidator } from '../../types';
import { PRIMITIVE_VALIDATORS } from '../primitiveValidators/validatorRegistry';
import { predefined } from '../../errors/JsonRpcError';
import { requiredIsMissing } from '../helper';

/**
 * Service for validating RPC method parameters
 */
// export class RpcParamValidator implements IValidationService {
export class RpcParamValidator {
  /**
   * Validates RPC method parameters against a validation schema
   *
   * @param params - The parameters to validate
   * @param validationSchema - The schema to validate against
   * @throws {JsonRpcError} If validation fails
   */
  public validateRpcParams(params: any[], validationSchema: Record<number, IParamValidation>): void {
    for (const index of Object.keys(validationSchema)) {
      const validation = validationSchema[Number(index)];
      const param = params[Number(index)];

      this.validateParam(index, param, validation);
    }
  }

  /**
   * Validates a single request parameter
   *
   * @param index - The parameter index or name
   * @param param - The parameter value
   * @param validation - The validation schema
   * @throws {JsonRpcError} If validation fails
   */
  public validateParam(index: number | string, param: any, validation: IParamValidation): void {
    const primitiveValidator = this.getPrimitiveValidators(validation.type);

    if (primitiveValidator === undefined) {
      throw predefined.INTERNAL_ERROR(`Missing or unsupported param type '${validation.type}'`);
    }

    // Check if required parameter is missing
    if (requiredIsMissing(param, validation.required)) {
      throw predefined.MISSING_REQUIRED_PARAMETER(index);
    } else if (!validation.required && param === undefined) {
      // If parameter is undefined and not required, no need to validate
      return;
    }

    if (param === null) {
      throw predefined.INVALID_PARAMETER(index, `The value passed is not valid: ${param}.`);
    }

    // Handle array of validators for compound types (e.g., 'blockHash|blockNumber')
    if (Array.isArray(primitiveValidator)) {
      const results: boolean[] = [];
      for (const validator of primitiveValidator) {
        const result = validator.test(param);
        results.push(result);
      }
      if (!results.some((item) => item === true)) {
        const errorMessages = primitiveValidator.map((validator) => validator.error).join(' OR ');
        throw predefined.INVALID_PARAMETER(index, `The value passed is not valid: ${param}. ${errorMessages}`);
      }
    } else {
      // Single validator
      if (!primitiveValidator.test(param)) {
        const paramString = typeof param === 'object' ? JSON.stringify(param) : param;
        throw predefined.INVALID_PARAMETER(index, `${primitiveValidator.error}, value: ${paramString}`);
      }
    }
  }

  /**
   * Gets the validator(s) for a parameter type
   *
   * @param validationType - The type of validation to perform
   * @returns The validator or array of validators for compound types
   */
  private getPrimitiveValidators(validationType: string): IPrimitiveValidator | IPrimitiveValidator[] | undefined {
    // Handle compound types (with pipes)
    if (validationType?.includes('|')) {
      return validationType.split('|').map((type) => PRIMITIVE_VALIDATORS[type]);
    }

    // Get single type validator
    return PRIMITIVE_VALIDATORS[validationType];
  }
}
