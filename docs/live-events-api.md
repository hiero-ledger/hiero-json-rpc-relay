With the implementation of [HIP 694](https://hips.hedera.com/hip/hip-694), the Hedera JSON RPC Relay now includes a websocket server which allows users to receive data from contract events in real time.


## Establishing a connection

Example connection using ethers.js (v5.7.0):

```js
const provider = await new ethers.providers.WebSocketProvider(WEBSOCKET_ENDPOINT_URL);
```

Where
- WEBSOCKET_ENDPOINT_URL - The websocket endpoint, default is `ws://localhost:8546`


## API

The server expects to receive messages that are JSON encoded strings of data with the following structure:

```js
{
  method: METHOD,
  params: [PARAM1, PARAM2, ...]
}
```

The WebSocket server supports all standard JSON-RPC methods available on the HTTP relay (see [rpc-api.md](./rpc-api.md)), plus the following WebSocket-specific methods for real-time subscriptions:

- `eth_subscribe`
- `eth_unsubscribe`

Upon receiving a message with a valid `method` and `params` the server will emit a message with a stringified JSON-RPC format:
  
Success Response
```json
  {
    "id": 1,
    "jsonrpc": "2.0",
    "result": "..."
  }
  ```

Error Response
  ```json
  {
    "id": 2,
    "jsonrpc": "2.0",
    "error": {
        "code": "",
        "message": "..."
    }
  }
  ```

### eth_subscribe

The `eth_subscribe` method is used to establish a subscription, which listens for events. Whenever an event occurs the resulting data is sent to the subscribed client. When a subscription is successfully established the server responds with a `subscriptionId`:

```json
  {
    "id": 1,
    "jsonrpc": "2.0",
    "result": "0x4a563af33c4871b51a8b108aa2fe1dd5"
  }
```

When calling the `eth_subscribe` method 2 parameters should be specified:
1. `params[0]` is used to specify the type of event. Possible values are:
- `logs` - subscribes to newly created Logs from specified Contracts. The result data is in the [Log](https://besu.hyperledger.org/en/stable/Reference/API-Objects/#log-object) format.
- `newHeads` - subscribes to newly created blocks. The result data is a [Block](https://besu.hyperledger.org/23.4.0/public-networks/how-to/use-besu-api/rpc-pubsub#new-headers).

2.  `params[1]` is used to specify filters. Logs can be filtered by `address` and/or `topics`:

```typescript
{
    address?: String | [String], 
    topics?: [String]
}
```

When a related event occurs the server sends the data in the following format:

```js
{
  "method": "eth_subscription",
  "params": {
    "subscription": SUBSCRIPTION_ID,
    "result": DATA
  }
}
```


### eth_unsubscribe

Terminates an active subscription. Expects `params[0]` to have the value of the `subscriptionId`. Returns a boolean:

```js
  {
    "id": 1,
    "jsonrpc": "2.0",
    "result": "true"
  }
```


### newHeads
```js
  {
    "id":1,
    "jsonrpc":"2.0",
    "method":"eth_subscribe",
    "params":["newHeads"]
  }
```

### Errors

#### Errors that close the connection

| Code | Message                                                | Reason                                                                                                                                                        |
|------|--------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 4001 | Exceeded maximum connections from a single IP address  | The maximum allowed connections from a single IP address have been reached.                                                                                   |
| 4002 | Connection timeout expired                             | Connections are automatically closed after a certain amount of time. You can handle this error by opening a new connection and re-creating your subscriptions |
| 4003 | Connection limit exceeded                              | The maximum allowed connections have been reached.                                                                                                            |

#### JSON-RPC errors

| Code   | Message                                | Reason                                                            |
|--------|----------------------------------------|-------------------------------------------------------------------|
| -32602 | Invalid parameter                      | Wrong parameter format                                            |
| -32600 | Invalid request                        | Could not parse the message data                                  |
| -32601 | Unsupported JSON-RPC method            | The `method` field is missing or invalid                          |
| -32608 | Exceeded maximum allowed subscriptions | The maximum allowed subscriptions per connection has been reached |
| -32603 | Internal error                         |                                                                   |


### Example code

Below is an example code that subscribes to a specified contract address and listens for logs that contain the specified `topics`:

```javascript
  const provider = await new ethers.providers.WebSocketProvider(WS_RELAY_URL);

  provider._websocket.on('close', (code, message) => {
    // Handle the close event
    console.error(`Websocket closed: ${code}`);
    console.error(message);
  })

  provider.on({
      address: CONTRACT_ADDRES,
      topics: [
          TOPIC1,
          TOPIC2
      ]
  }, (log) => {
    // Handle the received log data
  });
```