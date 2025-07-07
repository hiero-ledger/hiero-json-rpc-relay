// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { describe, it } from 'mocha';
import sinon from 'sinon';

import { IParamValidation, RPC_PARAM_VALIDATION_RULES_KEY, rpcParamValidationRules } from '../../../src/lib/validators';
import * as validator from '../../../src/lib/validators';

describe('rpcParamValidationRules decorator', () => {
  // Reset sinon after each test
  afterEach(() => {
    sinon.restore();
  });

  describe('Decorator application', () => {
    class TestClass {
      // @ts-ignore
      @rpcParamValidationRules({
        0: { type: 'address', required: true },
        1: { type: 'blockNumber', required: false },
      })
      addressAndBlockMethod(address: string, blockNumber?: string) {
        return `${address}-${blockNumber || 'latest'}`;
      }

      // @ts-ignore
      @rpcParamValidationRules({
        0: { type: 'transactionHash', required: true },
        1: { type: 'boolean', required: false, errorMessage: 'Custom error message' },
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
      expect(addressSchema[0].type).to.equal('address');
      expect(addressSchema[0].required).to.be.true;
      expect(addressSchema[1].type).to.equal('blockNumber');
      expect(addressSchema[1].required).to.be.false;

      const customSchema = testInstance.customErrorMethod[RPC_PARAM_VALIDATION_RULES_KEY];
      expect(customSchema).to.be.an('object');
      expect(customSchema[0].type).to.equal('transactionHash');
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
    let validateParamsStub: sinon.SinonStub;

    beforeEach(() => {
      // Create a stub for the validateParam function from validators/utils
      validateParamsStub = sinon.stub(validator, 'validateParams');
    });

    it('should allow schema retrieval for validation', () => {
      class TestValidationClass {
        // @ts-ignore
        @rpcParamValidationRules({
          0: { type: 'address', required: true },
          1: { type: 'blockNumber', required: false },
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
      validator.validateParams(params, schema);

      // Verify our validation stub was called with correct parameters
      expect(validateParamsStub.calledWith(['0xaddress', '0xblock'], schema)).to.be.true;
    });
  });

  describe('Schema structure', () => {
    it('should support various parameter types', () => {
      const schema: Record<number, IParamValidation> = {
        0: { type: 'address', required: true },
        1: { type: ['blockNumber', 'blockHash'], required: false },
        2: { type: 'hex', required: true, errorMessage: 'Must be hex' },
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
      expect(appliedSchema[0].type).to.equal('address');
      expect(appliedSchema[1].type).to.deep.equal(['blockNumber', 'blockHash']);
      expect(appliedSchema[2].type).to.equal('hex');
      expect(appliedSchema[2].errorMessage).to.equal('Must be hex');
    });

    it('should support custom type strings', () => {
      const customType = ['custom', 'type', 'string'];

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
          0: { type: 'address', required: true },
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
