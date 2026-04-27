// SPDX-License-Identifier: Apache-2.0

export class WebSocketError {
  public code: number;
  public message: string;

  constructor(args: { code: number; message: string }) {
    this.code = args.code;
    this.message = args.message;
  }
}

export default {
  CONNECTION_IP_LIMIT_EXCEEDED: new WebSocketError({
    code: 4001,
    message: `Exceeded maximum connections from a single IP address`,
  }),
  TTL_EXPIRED: new WebSocketError({
    code: 4002,
    message: `Connection timeout expired`,
  }),
  CONNECTION_LIMIT_EXCEEDED: new WebSocketError({
    code: 4003,
    message: `Connection limit exceeded`,
  }),
};
