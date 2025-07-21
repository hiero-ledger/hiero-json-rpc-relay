// SPDX-License-Identifier: Apache-2.0

export class JsonRpcError extends Error {
  code: any;
  data: any;
  constructor(message, code, data) {
    super();

    this.message = message;
    this.code = code;

    if (typeof data !== 'undefined') {
      this.data = data;
    }
  }
}

export class ParseError extends JsonRpcError {
  constructor() {
    super('Parse error', -32700, undefined);
  }
}

export class InvalidRequest extends JsonRpcError {
  constructor() {
    super('Invalid Request', -32600, undefined);
  }
}

export class MethodNotFound extends JsonRpcError {
  constructor(methodName: string) {
    super(`Method ${methodName} not found`, -32601, undefined);
  }
}

export class InvalidParams extends JsonRpcError {
  constructor() {
    super('Invalid params', -32602, undefined);
  }
}

export class InternalError extends JsonRpcError {
  /**
   * @param err The error object that caused this `InternalError`.
   */
  constructor(err: unknown) {
    const message = err && typeof err === 'object' && 'message' in err ? err.message : 'Internal error';
    super(message, -32603, undefined);
  }
}

export class Unauthorized extends JsonRpcError {
  constructor() {
    super('Unauthorized', -32604, undefined);
  }
}

export class ServerError extends JsonRpcError {
  constructor(code) {
    if (code < -32099 || code > -32000) {
      throw new Error('Invalid error code');
    }
    super('Server error', code, undefined);
  }
}

export class IPRateLimitExceeded extends JsonRpcError {
  constructor(methodName) {
    super(`IP Rate limit exceeded on ${methodName}`, -32605, undefined);
  }
}

export class HBARRateLimitExceeded extends JsonRpcError {
  constructor() {
    super('HBAR Rate limit exceeded', -32606, undefined);
  }
}
