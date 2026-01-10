// SPDX-License-Identifier: Apache-2.0

/**
 * Symbol used to store parameter layout configuration
 */
export const RPC_PARAM_LAYOUT_KEY = 'hedera-rpc-param-layout';

/**
 * Type for parameter transform function
 */
type ParamTransformFn = (params: any[]) => any[];

/**
 * Built-in parameter layouts for common RPC method patterns
 */
export const RPC_LAYOUT = {
  /**
   * Layout for methods that only need the requestDetails parameter
   */
  REQUEST_DETAILS_ONLY: 'request-details-only',

  /**
   * Create a custom parameter layout using a transform function
   *
   * @param rpcParamRearrangementFn - Function to show custom parameter rearrangement
   */
  custom: (rpcParamRearrangementFn: (params: any[]) => any[]) => rpcParamRearrangementFn,
};

/**
 * Decorator for specifying the parameter layout of an RPC method which is different from the standard layout
 *
 * This decorator defines how RPC parameters should be arranged when passed to the method.
 *
 * @example
 * ```typescript
 * // Method that only needs requestDetails
 * @rpcMethod
 * @rpcParamLayoutConfig(RPC_LAYOUT.REQUEST_DETAILS_ONLY)
 * blockNumber(requestDetails: RequestDetails): Promise<string> {
 *   // Implementation
 * }
 *
 * // Method with specific parameter transformations
 * @rpcMethod
 * @rpcParamLayoutConfig(RPC_LAYOUT.custom(params => [params[0], params[1]]))
 * estimateGas(transaction: IContractCallRequest, _blockParam: string | null, requestDetails: RequestDetails,): Promise<string | JsonRpcError> {
 *   // Implementation
 * }
 * ```
 *
 * @param layout - Parameter layout specification
 */
export function rpcParamLayoutConfig(layout: string | ParamTransformFn) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return function (target: any, _context: ClassMethodDecoratorContext): any {
    target[RPC_PARAM_LAYOUT_KEY] = layout;
    return target;
  };
}
