// SPDX-License-Identifier: Apache-2.0

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
   * @param details - The details of the request.
   */
  constructor(details: { requestId: string; ipAddress: string; connectionId?: string; method?: string }) {
    this.requestId = details.requestId;
    this.ipAddress = details.ipAddress;
    this.connectionId = details.connectionId;
  }
}
