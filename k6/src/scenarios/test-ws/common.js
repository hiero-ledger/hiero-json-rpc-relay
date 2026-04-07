// SPDX-License-Identifier: Apache-2.0

import ws from 'k6/ws';
import { check } from 'k6';
import { scenarioDurationGauge } from './index.js';

const errorField = 'error';
const resultField = 'result';

const isDebugMode = __ENV['DEBUG_MODE'] === 'true';

let requestId = 1;

function getPayLoad(methodName, paramInput = []) {
  return JSON.stringify({
    id: requestId++,
    jsonrpc: '2.0',
    method: methodName,
    params: paramInput,
  });
}

function connectToWebSocket(url, methodName, scenarioName, params = [], responseChecks = {}) {
  return ws.connect(url, {}, (socket) => {
    socket.on('open', () => {
      const startTime = Date.now();
      const message = getPayLoad(methodName, params);
      if (isDebugMode) {
        console.log('Connected, sending request: ' + message);
      }
      socket.send(message);

      socket.on('message', (message) => {
        check(message, responseChecks);
        scenarioDurationGauge.add(Date.now() - startTime, { scenario: scenarioName });
        socket.close();
      });
    });

    socket.on('close', function () {
      if (isDebugMode) {
        console.log('Disconnected');
      }
    });

    socket.on('error', (e) => {
      if (isDebugMode) {
        console.error('Received WebSocketError:', e);
      }
    });
  });
}

function isNonErrorResponse(message) {
  try {
    const response = JSON.parse(message);
    const success = response.hasOwnProperty(resultField) && !response.hasOwnProperty(errorField);
    if (isDebugMode) {
      console.log(`isNonErrorResponse: message=${message}, result=${success}`);
    }
    return success;
  } catch (e) {
    return false;
  }
}

function isErrorResponse(message) {
  try {
    const response = JSON.parse(message);
    const success = response.hasOwnProperty(errorField) && !response.hasOwnProperty(resultField);
    if (isDebugMode) {
      console.log(`isErrorResponse: message=${message}, result=${success}`);
    }
    return success;
  } catch (e) {
    return false;
  }
}

export { connectToWebSocket, isNonErrorResponse, isErrorResponse };
