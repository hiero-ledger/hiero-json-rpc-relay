// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { describe, it } from 'mocha';
import sinon from 'sinon';

import {
  RPC_PARAM_VALIDATION_RULES_KEY,
  rpcParamValidationRules,
} from '../../../src/lib/decorators/rpcParamValidationRules.decorator';
import { IParamValidation, ParamType } from '../../../src/lib/types';
import * as validatorUtils from '../../../src/lib/validators/utils';

describe('rpcParamValidationRules decorator', () => {
  // Reset sinon after each test
  afterEach(() => {
    sinon.restore();
  });

  describe('Decorator application', () => {
    class TestClass {
      // @ts-ignore
      @rpcParamValidationRules({
        0: { type: ParamType.ADDRESS, required: true },
        1: { type: ParamType.BLOCK_NUMBER, required: false },
      })
      addressAndBlockMethod(address: string, blockNumber?: string) {
        return `${address}-${blockNumber || 'latest'}`;
      }

      // @ts-ignore
      @rpcParamValidationRules({
        0: { type: ParamType.TRANSACTION_HASH, required: true },
        1: { type: ParamType.BOOLEAN, required: false, errorMessage: 'Custom error message' },
      })
      customErrorMethod(txHash: string, fullTx: boolean = false) {
        return `${txHash}-${fullTx}`;
      }

      regularMethod() {
        return 'regular-method';
      }
    }

    let testInstance: TestClass;

    beforeEach(() => {
      testInstance = new TestClass();
    });

    it('should add RPC_PARAM_VALIDATION_RULES_KEY to decorated methods', () => {
      const addressSchema = testInstance.addressAndBlockMethod[RPC_PARAM_VALIDATION_RULES_KEY];
      expect(addressSchema).to.be.an('object');
      expect(addressSchema[0].type).to.equal(ParamType.ADDRESS);
      expect(addressSchema[0].required).to.be.true;
      expect(addressSchema[1].type).to.equal(ParamType.BLOCK_NUMBER);
      expect(addressSchema[1].required).to.be.false;

      const customSchema = testInstance.customErrorMethod[RPC_PARAM_VALIDATION_RULES_KEY];
      expect(customSchema).to.be.an('object');
      expect(customSchema[0].type).to.equal(ParamType.TRANSACTION_HASH);
      expect(customSchema[1].errorMessage).to.equal('Custom error message');

      expect(testInstance.regularMethod[RPC_PARAM_VALIDATION_RULES_KEY]).to.be.undefined;
    });

    it('should maintain method functionality after decoration', () => {
      expect(testInstance.addressAndBlockMethod('0x123', '0x456')).to.equal('0x123-0x456');
      expect(testInstance.addressAndBlockMethod('0x123')).to.equal('0x123-latest');
      expect(testInstance.customErrorMethod('0xabc', true)).to.equal('0xabc-true');
      expect(testInstance.regularMethod()).to.equal('regular-method');
    });
  });

  describe('Schema validation integration', () => {
    // Mock validation function for testing
    let validateParamStub: sinon.SinonStub;

    beforeEach(() => {
      // Create a stub for the validateParam function from validators/utils
      validateParamStub = sinon.stub(validatorUtils, 'validateParam');
    });

    it('should allow schema retrieval for validation', () => {
      class TestValidationClass {
        // @ts-ignore
        @rpcParamValidationRules({
          0: { type: ParamType.ADDRESS, required: true },
          1: { type: ParamType.BLOCK_NUMBER, required: false },
        })
        testMethod(address: string, blockNumber?: string) {
          return `${address}-${blockNumber || 'latest'}`;
        }
      }

      const instance = new TestValidationClass();
      const schema = instance.testMethod[RPC_PARAM_VALIDATION_RULES_KEY];

      // Verify schema structure
      expect(schema).to.be.an('object');
      expect(Object.keys(schema).length).to.equal(2);

      // Validate using the schema
      const params = ['0xaddress', '0xblock'];

      // Simulate validation with the schema
      for (const [index, param] of params.entries()) {
        if (schema[index]) {
          validatorUtils.validateParam(index, param, schema[index]);
        }
      }

      // Verify our validation stub was called with correct parameters
      expect(validateParamStub.calledWith(0, '0xaddress', schema[0])).to.be.true;
      expect(validateParamStub.calledWith(1, '0xblock', schema[1])).to.be.true;
    });
  });

  describe('Schema structure', () => {
    it('should support various parameter types', () => {
      const schema: Record<number, IParamValidation> = {
        0: { type: ParamType.ADDRESS, required: true },
        1: { type: ParamType.BLOCK_NUMBER_OR_HASH, required: false },
        2: { type: ParamType.HEX, required: true, errorMessage: 'Must be hex' },
      };

      class TestTypeClass {
        // @ts-ignore
        @rpcParamValidationRules(schema)
        testMethod() {
          return 'test';
        }
      }

      const instance = new TestTypeClass();
      const appliedSchema = instance.testMethod[RPC_PARAM_VALIDATION_RULES_KEY];

      // Verify all schema properties were correctly applied
      expect(appliedSchema[0].type).to.equal(ParamType.ADDRESS);
      expect(appliedSchema[1].type).to.equal(ParamType.BLOCK_NUMBER_OR_HASH);
      expect(appliedSchema[2].type).to.equal(ParamType.HEX);
      expect(appliedSchema[2].errorMessage).to.equal('Must be hex');
    });

    it('should support custom type strings', () => {
      const customType = 'custom|type|string';

      class TestCustomTypeClass {
        // @ts-ignore
        @rpcParamValidationRules({
          0: { type: customType, required: true },
        })
        testMethod() {
          return 'test';
        }
      }

      const instance = new TestCustomTypeClass();
      const schema = instance.testMethod[RPC_PARAM_VALIDATION_RULES_KEY];

      expect(schema[0].type).to.equal(customType);
    });
  });

  describe('Multiple decorators interaction', () => {
    it('should work alongside other decorators', () => {
      const mockDecorator = (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) => {
        descriptor.value.MOCK_KEY = 'mock-value';
        return descriptor;
      };

      class TestMultiDecoratorClass {
        // @ts-ignore
        @mockDecorator
        // @ts-ignore
        @rpcParamValidationRules({
          0: { type: ParamType.ADDRESS, required: true },
        })
        testMethod(address: string) {
          return address;
        }
      }

      const instance = new TestMultiDecoratorClass();

      // Both decorators should have applied their metadata
      expect(instance.testMethod[RPC_PARAM_VALIDATION_RULES_KEY]).to.be.an('object');
      expect(instance.testMethod['MOCK_KEY']).to.equal('mock-value');

      // Method should still work
      expect(instance.testMethod('0x123')).to.equal('0x123');
    });
  });
});
