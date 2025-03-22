// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { describe, it } from 'mocha';
import sinon from 'sinon';

import { RPC_LAYOUT, RPC_PARAM_LAYOUT_KEY, rpcParamLayoutConfig } from '../../../src/lib/decorators';
import { RequestDetails } from '../../../src/lib/types';
import { Utils } from '../../../src/utils';

describe('rpcParamLayoutConfig decorator', () => {
  // Sample request details for testing
  const requestDetails = new RequestDetails({
    requestId: 'test-request-id',
    ipAddress: '127.0.0.1',
  });

  // Reset sinon after each test
  afterEach(() => {
    sinon.restore();
  });

  describe('Decorator application', () => {
    class TestClass {
      // @ts-ignore
      @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
      requestDetailsOnlyMethod() {
        return 'request-details-only';
      }

      // @ts-ignore
      @rpcParamLayoutConfig(RPC_LAYOUT.custom((params) => [params[1], params[0]]))
      customLayoutMethod(param1: string, param2: string) {
        return `${param1}-${param2}`;
      }

      regularMethod() {
        return 'regular-method';
      }
    }

    let testInstance: TestClass;

    beforeEach(() => {
      testInstance = new TestClass();
    });

    it('should add RPC_PARAM_LAYOUT_KEY to decorated methods', () => {
      expect(testInstance.requestDetailsOnlyMethod[RPC_PARAM_LAYOUT_KEY]).to.equal(RPC_LAYOUT.REQUEST_DETAILS_ONLY);
      expect(typeof testInstance.customLayoutMethod[RPC_PARAM_LAYOUT_KEY]).to.equal('function');
      expect(testInstance.regularMethod[RPC_PARAM_LAYOUT_KEY]).to.be.undefined;
    });

    it('should maintain method functionality after decoration', () => {
      expect(testInstance.requestDetailsOnlyMethod()).to.equal('request-details-only');
      expect(testInstance.customLayoutMethod('a', 'b')).to.equal('a-b');
      expect(testInstance.regularMethod()).to.equal('regular-method');
    });
  });

  describe('RPC_LAYOUT.REQUEST_DETAILS_ONLY', () => {
    it('should be a string constant', () => {
      expect(RPC_LAYOUT.REQUEST_DETAILS_ONLY).to.equal('request-details-only');
    });

    it('should be processed correctly by Utils.arrangeRpcParams', () => {
      const mockMethod = function () {};
      mockMethod[RPC_PARAM_LAYOUT_KEY] = RPC_LAYOUT.REQUEST_DETAILS_ONLY;

      const result = Utils.arrangeRpcParams(mockMethod, ['param1', 'param2'], requestDetails);
      expect(result).to.deep.equal([requestDetails]);
    });
  });

  describe('RPC_LAYOUT.custom', () => {
    it('should return the provided function', () => {
      const customFn = (params: any[]) => [params[1], params[0]];
      const result = RPC_LAYOUT.custom(customFn);
      expect(result).to.equal(customFn);
    });

    it('should be processed correctly by Utils.arrangeRpcParams', () => {
      const customFn = (params: any[]) => [params[1], params[0]];
      const mockMethod = function () {};
      mockMethod[RPC_PARAM_LAYOUT_KEY] = customFn;

      const result = Utils.arrangeRpcParams(mockMethod, ['param1', 'param2'], requestDetails);
      expect(result).to.deep.equal(['param2', 'param1', requestDetails]);
    });
  });

  describe('Integration with Utils.arrangeRpcParams', () => {
    it('should handle methods with no layout configuration', () => {
      const mockMethod = function () {};
      const result = Utils.arrangeRpcParams(mockMethod, ['param1', 'param2'], requestDetails);
      expect(result).to.deep.equal(['param1', 'param2', requestDetails]);
    });

    it('should handle empty params array with default behavior', () => {
      const mockMethod = function () {};
      const result = Utils.arrangeRpcParams(mockMethod, [], requestDetails);
      expect(result).to.deep.equal([requestDetails]);
    });

    it('should handle undefined params with default behavior', () => {
      const mockMethod = function () {};
      const result = Utils.arrangeRpcParams(mockMethod, undefined, requestDetails);
      expect(result).to.deep.equal([requestDetails]);
    });
  });

  describe('Complex custom layouts', () => {
    it('should support complex parameter transformations', () => {
      const complexTransform = (params: any[]) => {
        return [{ first: params[0], second: params[1] }, params[2] ? parseInt(params[2], 10) : 0];
      };

      const mockMethod = function () {};
      mockMethod[RPC_PARAM_LAYOUT_KEY] = RPC_LAYOUT.custom(complexTransform);

      const result = Utils.arrangeRpcParams(mockMethod, ['a', 'b', '42'], requestDetails);
      expect(result).to.deep.equal([{ first: 'a', second: 'b' }, 42, requestDetails]);
    });
  });
});
