// SPDX-License-Identifier: Apache-2.0

import { predefined } from '@hashgraph/json-rpc-relay/dist/lib/errors/JsonRpcError';
import { ITransactionReceipt } from '@hashgraph/json-rpc-relay/src/lib/types';
import { BlockTag, ethers } from 'ethers';

import Assertions from '../helpers/assertions';
import constants from '../helpers/constants';
import { Utils } from '../helpers/utils';

export default class RelayClient {
  readonly provider: ethers.JsonRpcProvider;

  constructor(relayUrl: string) {
    const fr: ethers.FetchRequest = new ethers.FetchRequest(relayUrl);
    this.provider = new ethers.JsonRpcProvider(fr);
  }

  /**
   * Calls the specified methodName with the provided params
   * @param methodName
   * @param params
   */
  async call(methodName: string, params: any[]) {
    return await this.provider.send(methodName, params);
  }

  /**
   * Sends a batch request.
   *
   * The `payload` is an array of JSON-RPC requests.
   * The `method` and `params` fields correspond to the arguments of the `call` method.
   *
   * @param payload
   * @returns
   */
  async callBatch(payload: { id: number; method: string; params: any[] }[]) {
    const request = this.provider._getConnection();
    request.setHeader('content-type', 'application/json');
    request.body = JSON.stringify(payload.map((r) => ({ ...r, jsonrpc: '2.0' })));
    const response = await request.send();
    response.assertOk();

    return response.bodyJson;
  }

  /**
   * Calls the specified methodName with the provided params and asserts that it fails
   * @param methodName
   * @param params
   * @param expectedRpcError
   */
  async callFailing(methodName: string, params: any[], expectedRpcError = predefined.INTERNAL_ERROR()) {
    try {
      await this.call(methodName, params);
      Assertions.expectedError();
    } catch (e: any) {
      if (expectedRpcError.message.includes('execution reverted')) {
        if (e?.info) {
          Assertions.jsonRpcError(e.info.error, expectedRpcError);
        } else if (e?.error) {
          Assertions.jsonRpcError(e.error, expectedRpcError);
        } else {
          Assertions.expectedError();
        }
      } else {
        Assertions.jsonRpcError(e?.response?.bodyJson?.error, expectedRpcError);
      }
    }
  }

  /**
   * Calls the specified methodName and asserts that it is not supported
   * @param methodName
   * @param params
   */
  async callUnsupported(methodName: string, params: any[]) {
    try {
      await this.call(methodName, params);
      Assertions.expectedError();
    } catch (e: any) {
      Assertions.unsupportedResponse(e?.response?.bodyJson);
    }
  }

  /**
   * Gets the account balance by executing `eth_getBalance`
   * @param address
   * @param block
   */
  async getBalance(address: ethers.AddressLike, block: BlockTag = 'latest') {
    return this.provider.getBalance(address, block);
  }

  /**
   * @param evmAddress
   * Returns: The nonce of the account with the provided `evmAddress`
   */
  async getAccountNonce(evmAddress: string): Promise<number> {
    const nonce = await this.provider.send('eth_getTransactionCount', [evmAddress, 'latest']);
    return Number(nonce);
  }

  /**
   * This invokes the relay logic from eth.ts/sendRawTransaction.
   *
   * Returns: Transaction hash
   * @param signedTx
   */
  async sendRawTransaction(signedTx): Promise<string> {
    return this.provider.send('eth_sendRawTransaction', [signedTx]);
  }

  /**
   * Returns the result of eth_gasPrice as a Number.
   */
  async gasPrice(): Promise<number> {
    return Number(await this.call('eth_gasPrice', []));
  }

  /**
   * Polls for a valid transaction receipt by repeatedly checking until one is found.
   *
   * @param {string} txHash - The transaction hash to get the receipt for
   * @returns {Promise<ITransactionReceipt>} A promise that resolves to the transaction receipt
   */
  async pollForValidTransactionReceipt(txHash: string): Promise<ITransactionReceipt> {
    const receipt = await this.provider.send(constants.ETH_ENDPOINTS.ETH_GET_TRANSACTION_RECEIPT, [txHash]);
    if (receipt) return receipt;

    await Utils.wait(1000);
    return this.pollForValidTransactionReceipt(txHash);
  }
}
