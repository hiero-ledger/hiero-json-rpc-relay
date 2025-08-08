// SPDX-License-Identifier: Apache-2.0

/**
 * Interface representing the details of a request.
 */
export interface IRequestDetails {
  /**
   * The unique identifier for the request.
   * @type {string}
   */
  requestId: string;

  /**
   * The IP address from which the request originated.
   * @type {string}
   */
  ipAddress: string;

  /**
   * The connection ID associated with the request (optional).
   * @type {string | undefined}
   */
  connectionId?: string;
}

/**
 * Represents the details of a request.
 */
export class RequestDetails {
  /**
   * The unique identifier for the request.
   */
  requestId: string;

  /**
   * The IP address from which the request originated.
   */
  ipAddress: string;

  /**
   * The connection ID associated with the request (optional).
   */
  connectionId?: string;

  /**
   * Creates an instance of RequestDetails.
   * @param {IRequestDetails} details - The details of the request.
   */
  constructor(details: IRequestDetails) {
    this.requestId = details.requestId;
    this.ipAddress = details.ipAddress;
    this.connectionId = details.connectionId;
  }
}
