# Batch Requests

## Overview

Batch requests consolidate multiple API calls within a single HTTP request. Clients bundle multiple requests into an array and receive an array of responses in return. The server may process these batched requests in any sequence, concurrently. Clients must then correlate the responses to the original requests using the unique ID of each object.

This is a standard JSON-RPC 2.0 feature. For more information, see the [JSON-RPC 2.0 Specification - Batch](https://www.jsonrpc.org/specification#batch)

## Goals / Motivation

1. Adhere to the JSON-RPC 2.0 specification for batch requests
2. Support Tooling that uses batch requests, such as EthersJs v6
3. Support batch requests for all methods that are supported for single requests

## Configuration

1. **BATCH_REQUESTS_ENABLED:** Flag to enable `batch requests`, it can be `true` or `false`, default value is `false`
2. **BATCH_REQUESTS_MAX_SIZE:** If the batch request is enabled, this is the maximum number of requests allowed in a batch request, default value is `100`.
3. **WS_BATCH_REQUESTS_ENABLED:** Flag to enable `batch requests` on the websocket, it can be `true` or `false`, default value is `false`
4. **WS_BATCH_REQUESTS_MAX_SIZE:** If the batch request is enabled, this is the maximum number of requests allowed in a batch request, default value is `20`.
5. **BATCH_REQUESTS_DISALLOWED_METHODS:** A list of methods that are not allowed to be part of a batch request. default: (debug_traceTransaction,debug_traceBlockByNumber,eth_getFilterLogs,eth_uninstallFilter,eth_newFilter,eth_newPendingTransactionFilter,eth_newBlockFilter)

## Implementation

- Current single requests should stay the same as they are currently.

- All batch requests should return a `200` response code, even if there are errors on the individual requests. except in case that fails the validations for the batch request as a whole or common validations.
- Batch requests should be implemented on top of the current implementation, refactored into common flows and common code reused much as possible.

**Common Flow for both Batch and Single Requests:**

1. Validate the request is a valid json
2. Validate the Method is supported (POST only)
3. Validate Authorization Token

**Validations per Each individual request on a batch or as a single request:**

1. Validate JSON-RPC 2.0 Specification
2. Validate Method is supported
3. Validate Method is allowed for batch request
4. Validate and increase the request count for the rate limit

**Validations for the Batch Request as a whole:**

1. Validate that the request is an array
2. Validate Batch Request is enabled
3. Validate Batch Request size is within the limit

#### Batch Request examples

The request object is a JSON array with one or more transactions, a unique `id` should be provided for each request (however due to the experimental feature that allows to send a request without `id` this is not mandatory, and answers will be provided in the same order as received), and all other fields as defined in the [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification) are also needed to comform to the standard.

```json
[
  {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "eth_chainId",
    "params": []
  },
  {
    "id": 2,
    "jsonrpc": "2.0",
    "method": "eth_getBalance",
    "params": ["0x67D8d32E9Bf1a9968a5ff53B87d777Aa8EBBEe69", "latest"]
  },
  {
    "jsonrpc": "2.0",
    "method": "eth_blockNumber",
    "params": [],
    "id": 3
  }
]
```

#### Batch Response example

The response object is a JSON array with each result from the request array. Each response object has the same `id` that corresponds to the request object.

```json
[
  {
    "result": "0x12a",
    "jsonrpc": "2.0",
    "id": 1
  },
  {
    "result": "0x21e19e0c9bab2400000",
    "jsonrpc": "2.0",
    "id": 2
  },
  {
    "result": "0x147",
    "jsonrpc": "2.0",
    "id": 3
  }
]
```

## Errors

There can be success responses and error responses in the same batch request.

### Errors related to Batch Requests

| Error Codes | Error Message                                                | Solution                                                                                               |
| ----------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| -32202      | Batch requests are disabled                                  | Enable batch requests by setting the appropriate `.env` configuration.                                 |
| -32003      | Batch item count exceeded                                    | Increase the item count limit or configure your RPC provider to use the default maximum, which is 100. |
| -32205      | WS Batch requests are disabled                               | Enable WS batch requests by setting the appropriate `.env` configuration..                             |
| -32006      | WS Batch item count exceeded                                 | Increase the item count limit or configure your RPC provider to use the default maximum, which is 20.  |
| -32007      | Method `<method>` is not permitted as part of batch requests | Execute method on single request                                                                       |

### Errors on a Batch Item

This happens when there are errors on one or many individual requests items of the request array.

1. The request item method does not exist (Method not found)
2. The request item does not conform to the JSON-RPC 2.0 specification (Invalid Request)
3. Missing required parameters or wrong parameter type
4. The request item is valid but the result is an error, like an `eth_call` that returns a `revert` or `out of gas` error
5. The request item method is not allowed for batch requests

Example of a response with the above errors (in the same order):

```json
[
    {
        "error": {
            "message": "Method non_existent_method not found",
            "code": -32601
        },
        "jsonrpc": "2.0",
        "id": 1
    },
    {
        "error": {
            "message": "Invalid Request",
            "code": -32600
        },
        "jsonrpc": "2.0",
        "id": null
    },
    {
        "error": {
            "code": -32602,
            "name": "Missing required parameters",
            "message": "[Request ID: 9e2c40fb-3406-4c48-b7ac-7a40e9bdb880] Missing value for required parameter 1"
        },
        "jsonrpc": "2.0",
        "id": 3
    },
    {
        "error": {
            "code": -32005,
            "name": "gasLimit too high",
            "message": "[Request ID: 9e2c40fb-3406-4c48-b7ac-7a40e9bdb880] Transaction gas limit '0xe1f21c67' exceeds block gas limit '15000000'"
        },
        "jsonrpc": "2.0",
        "id": 4
    }
    {
        "error":{
            "code":-32007,
            "name": "Method not allowed for batch requests",
            "message": "Method eth_getFilterLogs is not permitted as part of batch requests"
        },
        "jsonrpc": "2.0",
        "id": 5
    }
]
```

### Bad Request on the Batch Request as a whole

This type of error happens when the whole batch request fails and could happen for the following reasons:

1. The request is not a valid JSON object or Array of objects

```json
{
  "error": {
    "message": "Parse error",
    "code": -32700
  },
  "jsonrpc": "2.0",
  "id": null
}
```

2. The feature is disabled

```json
{
  "error": {
    "code": -32202,
    "name": "Batch requests disabled",
    "message": "Batch requests are disabled"
  },
  "jsonrpc": "2.0",
  "id": null
}
```

3. The request Array size is bigger than the configured limit

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32005,
    "message": "batch item count exceeded"
  }
}
```

## Metrics Capture Enhancement

Currently metrics are captured using a KoaApp middleware that captures the metric `rpc_relay_method_response` per each HTTP request capturing the amount of time it took to process the request in milliseconds (ms).

The metric currently uses the following labels:

1. `method` (method name such as eth_call, eth_getBlockByNumber or batch_request)
2. `status` (HTTP status code)

This approach works for both single and batch requests, however it does not capture the metrics for each individual request within the batch request.

Given the RPC team's heavy reliance on this metric to measure the performance and reliability of the RPC service, it is crucial to maintain its integrity.

### Proposed Solution

The suggested enhancement is to retain the existing metric unchanged while introducing an additional metric `label` to distinguish requests within a batch called `isPartOfBatch`. This label will have the value `true` for all requests within a batch and `false` for all single requests including the `batch_request` method itself.

Since the metric observations that are part of a batch request won't have a corresponding http code response, we will use the `status` label to capture the status of the individual requests within the batch. The `status` label will have the following values: `200` for all successful results, and the corresponding error code for all failed results (e.g. `-32005` for batch item count exceeded).

## Rate Limits

All requests within the batch request count towards the limit per IP and Method, on top of the batch request own limit, that will be the `TIER_1_RATE_LIMIT`.

## Tests

### Relay HTTP Requests

The following tests are added to test the batch requests feature:

1. should execute "eth_chainId" in batch request
2. should execute "eth_chainId" and "eth_accounts" in batch request (Successfully)
3. should execute "eth_chainId" and "eth_accounts" in batch request with invalid request id
4. should execute "eth_chainId" and method not found in batch request
5. should execute "eth_chainId" and method not found and params error in batch request
6. should hit batch request limit (more than 100 requests in the batch)
7. should not execute batch request when disabled
8. batch request be disabled by default
9. batch request
10. should return error for an batch request item method that is not allowed for batch requests

### Websocket Requests

1. should execute "eth_chainId" in batch request ( 2 or 3 requests)
2. should subscribe to multiple events in batch request ( 2 or 3 requests)
3. should hit batch request limit (more than 20 requests in the batch)
4. should not execute batch request when disabled
5. batch request be disabled by default
6. should return error for individual request with invalid request id
7. should return error for individual request with method not found

## Tasks

1. Implement batch request feature on the relay requests
2. Implement batch requests feature on the websocket
3. Implement a Rate Limit Tier for batch requests
4. Refactor Metrics to capture `batch requests` metrics and for each one of the requests within the batch.
