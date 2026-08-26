// SPDX-License-Identifier: Apache-2.0

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ethers } from 'ethers';
import { type Server } from 'http';
import { type AddressInfo } from 'net';
import sinon from 'sinon';
import { createPublicClient, http, type PublicClient } from 'viem';
import { Web3 } from 'web3';

import { ConfigService } from '../../src/config-service/services';
import { Relay } from '../../src/relay';
import { MirrorNodeClient } from '../../src/relay/lib/clients';
import { TransactionService } from '../../src/relay/lib/services/ethService/transactionService/TransactionService';
import { initializeServer } from '../../src/server/server';

use(chaiAsPromised);

const TX_ID = '0.0.1234@1700000000.000000001';
const REJECT_DETAIL = 'transaction 0.0.1234 failed precheck with status WRONG_NONCE';
const REJECT_HEDERA_STATUS = 'WRONG_NONCE';
const TIMEOUT_DETAIL = 'timeout exceeded';

const HASHES = {
  validated: '0x' + '1'.repeat(64),
  rejected: '0x' + '2'.repeat(64),
  timedout: '0x' + '3'.repeat(64),
  pending: '0x' + '4'.repeat(64),
};

const RECEIPT = {
  blockHash: '0xd693b532a80fed6392b428604171fb32fdbf953728a3a7ecc7d4062b1652c042',
  blockNumber: '0x11',
  cumulativeGasUsed: '0x7b',
  effectiveGasPrice: '0xad78ebc5ac620000',
  from: '0x0000000000000000000000000000000000001f41',
  to: '0x0000000000000000000000000000000000001389',
  gasUsed: '0x7b',
  logs: [],
  logsBloom: '0x' + '0'.repeat(512),
  status: '0x1',
  transactionHash: HASHES.validated,
  transactionIndex: '0x0',
  contractAddress: null,
  type: '0x2',
};

interface DecodedError {
  code?: number;
  data?: { txHash?: string; detail?: string; hederaStatus?: string; transactionId?: string; provisional?: boolean };
}

async function captureError(request: Promise<unknown>): Promise<any> {
  try {
    await request;
  } catch (error) {
    return error;
  }
  throw new Error('expected the receipt request to reject with a -32003 error, but it resolved');
}

function assertRejected(decoded: DecodedError): void {
  expect(decoded.code).to.equal(-32003);
  expect(decoded.data).to.be.an('object');
  expect(decoded.data!.txHash).to.equal(HASHES.rejected);
  expect(decoded.data!.detail).to.equal(REJECT_DETAIL);
  expect(decoded.data!.hederaStatus).to.equal(REJECT_HEDERA_STATUS);
  expect(decoded.data!.transactionId).to.equal(TX_ID);
  expect(decoded.data!.provisional).to.not.equal(true);
}

function assertTimedout(decoded: DecodedError): void {
  expect(decoded.code).to.equal(-32003);
  expect(decoded.data).to.be.an('object');
  expect(decoded.data!.txHash).to.equal(HASHES.timedout);
  expect(decoded.data!.provisional).to.equal(true);
  expect(decoded.data!.transactionId).to.equal(TX_ID);
}

describe('client-libraries: eth_getTransactionReceipt tracing decode', function () {
  this.timeout(20_000);

  let server: Server;
  let ethersProvider: ethers.JsonRpcProvider;
  let viemClient: PublicClient;
  let web3: Web3;

  const libraries = [
    {
      name: 'ethers',
      request: (hash: string): Promise<unknown> => ethersProvider.send('eth_getTransactionReceipt', [hash]),
      decode: (err: any): DecodedError => ({ code: err?.error?.code, data: err?.error?.data }),
    },
    {
      name: 'viem',
      request: (hash: string): Promise<unknown> =>
        viemClient.request({ method: 'eth_getTransactionReceipt' as any, params: [hash as `0x${string}`] as any }),
      decode: (err: any): DecodedError => ({ code: err?.code, data: err?.cause?.data }),
    },
    {
      name: 'web3.js',
      request: (hash: string): Promise<unknown> =>
        web3.requestManager.send({ method: 'eth_getTransactionReceipt', params: [hash] }),
      decode: (err: any): DecodedError => ({
        code: err?.cause?.code ?? err?.innerError?.code,
        data: err?.data ?? err?.cause?.data,
      }),
    },
  ];

  before(async () => {
    sinon.stub(ConfigService, 'getAllMasked').returns({ CHAIN_ID: '0x12a' } as any);
    sinon.stub(Relay.prototype as any, 'waitForMirrorNode').resolves();

    const { app, relay } = await initializeServer();

    sinon
      .stub(MirrorNodeClient.prototype, 'getContractResultWithRetry')
      .callsFake(async (_method: string, params: any[]) =>
        String(params?.[0] ?? '').toLowerCase() === HASHES.validated
          ? ({
              hash: HASHES.validated,
              block_hash: RECEIPT.blockHash,
              block_number: 17,
              transaction_index: 0,
              result: 'SUCCESS',
            } as any)
          : null,
      );
    sinon.stub(TransactionService.prototype as any, 'handleSyntheticTransactionReceipt').resolves(null);
    sinon.stub(TransactionService.prototype as any, 'handleRegularTransactionReceipt').resolves(RECEIPT);

    const tracing: any = (relay.eth() as any).transactionService.transactionTracingService;
    await tracing.recordRejected(HASHES.rejected, {
      error: REJECT_DETAIL,
      hederaStatus: REJECT_HEDERA_STATUS,
      transactionId: TX_ID,
    });
    await tracing.recordTimedout(HASHES.timedout, { error: TIMEOUT_DETAIL, transactionId: TX_ID });

    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const network = new ethers.Network('hedera-local', 298);
    ethersProvider = new ethers.JsonRpcProvider(url, network, { staticNetwork: network });
    viemClient = createPublicClient({ transport: http(url) });
    web3 = new Web3(new Web3.providers.HttpProvider(url));
  });

  after(() => {
    ethersProvider.destroy();
    sinon.restore();
    server.close();
  });

  for (const library of libraries) {
    describe(library.name, function () {
      it('decodes a successful (validated) receipt', async () => {
        expect(await library.request(HASHES.validated)).to.deep.equal(RECEIPT);
      });

      it('returns null for a still-pending transaction', async () => {
        expect(await library.request(HASHES.pending)).to.equal(null);
      });

      it('decodes a final -32003 with the failure payload for a rejected transaction', async () => {
        assertRejected(library.decode(await captureError(library.request(HASHES.rejected))));
      });

      it('decodes a provisional -32003 for a timed-out transaction', async () => {
        assertTimedout(library.decode(await captureError(library.request(HASHES.timedout))));
      });
    });
  }
});
