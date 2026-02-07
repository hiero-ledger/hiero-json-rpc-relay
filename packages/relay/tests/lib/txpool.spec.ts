// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { expect } from 'chai';
import { ethers } from 'ethers';
import pino from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import constants from '../../../relay/src/lib/constants';
import { numberTo0x } from '../../dist/formatters';
import { TransactionPoolService } from '../../dist/lib/services';
import { TxPoolImpl, TxPoolTransaction } from '../../dist/lib/txpool';
import { Relay } from '../../src/lib/relay';

const logger = pino({ level: 'silent' });

describe('Txpool', async function () {
  let sandbox: sinon.SinonSandbox;
  let txPoolServiceMock: sinon.SinonStubbedInstance<TransactionPoolService>;
  let txPool: TxPoolImpl;

  const rlpTx =
    '0x01f871808209b085a54f4c3c00830186a0949b6feaea745fe564158da9a5313eb4dd4dc3a940880de0b6b3a764000080c080a05e2d00db2121fdd3c761388c64fc72d123f17e67fddd85a41c819694196569b5a03dc6b2429ed7694f42cdc46309e08cc78eb96864a0da58537fe938d4d9f334f2';
  const rlpTxs: Set<string> = new Set([rlpTx]);
  const parsedTx = ethers.Transaction.from(rlpTx);

  const groupByAddressAndNonceTxs: TxPoolTransaction[] = [
    {
      blockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      blockNumber: null,
      transactionIndex: null,
      from: '0x2eD4dF6Ec66f55a5765DeF0A24BFA3bAC29e795e',
      gas: '0x186a0',
      hash: '0x2209a2b1b8e7258a4195411e1c8665683b6fc4c7ac1b11a62a8f331b8e68973f',
      input: '0x',
      nonce: '0x1',
      to: '0x9b6FEaeA745fE564158DA9A5313eb4dd4Dc3A940',
      value: '0xde0b6b3a7640000',
      type: '0x1',
      v: '0x1b',
      r: '0xffe76e17da28e22e1cc16a1321bc32f7c5c6f952f56cbc3b6a1fdd5469670ce4',
      s: '0x7ebe17ef06b8c8b49f5ec0416696f142ac9af2bee5ba66d9f4faddaa9a997f7b',
      gasPrice: '0xa54f4c3c00',
    },
    {
      blockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      blockNumber: null,
      transactionIndex: null,
      from: '0x2eD4dF6Ec66f55a5765DeF0A24BFA3bAC29e795e',
      gas: '0x186a0',
      hash: '0x6bb033c0cd822f66502a5e4a78e6eb46fd54105a92e02347cbc60036d075ec18',
      input: '0x',
      nonce: '0x2',
      to: '0x9b6FEaeA745fE564158DA9A5313eb4dd4Dc3A940',
      value: '0xde0b6b3a7640000',
      type: '0x1',
      v: '0x1b',
      r: '0x7c18462b45a419337ff6bccf8beb7f75c9e6bdf5306c92289f55f8162673044e',
      s: '0x682380bcf81f37c39f22a5ff44bc6098014259350d107c8da3a115764742590d',
      gasPrice: '0xa54f4c3c00',
    },
    {
      blockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      blockNumber: null,
      transactionIndex: null,
      from: '0xf1dc6c33b1d6720Cd24eCb296F4D96150Eb170dc',
      gas: '0x186a0',
      hash: '0x6bb033c0cd822f66502a5e4a78e6eb46fd54105a92e02347cbc60036d075ec18',
      input: '0x',
      nonce: '0x1',
      to: '0x9b6FEaeA745fE564158DA9A5313eb4dd4Dc3A940',
      value: '0xde0b6b3a7640000',
      type: '0x1',
      v: '0x1b',
      r: '0x7c18462b45a419337ff6bccf8beb7f75c9e6bdf5306c92289f55f8162673044e',
      s: '0x682380bcf81f37c39f22a5ff44bc6098014259350d107c8da3a115764742590d',
      gasPrice: '0xa54f4c3c00',
    },
  ];

  const groupByNonceTxs: TxPoolTransaction[] = [
    {
      blockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      blockNumber: null,
      transactionIndex: null,
      from: '0x2eD4dF6Ec66f55a5765DeF0A24BFA3bAC29e795e',
      gas: '0x186a0',
      hash: '0x2209a2b1b8e7258a4195411e1c8665683b6fc4c7ac1b11a62a8f331b8e68973f',
      input: '0x',
      nonce: '0x1',
      to: '0x9b6FEaeA745fE564158DA9A5313eb4dd4Dc3A940',
      value: '0xde0b6b3a7640000',
      type: '0x1',
      v: '0x1b',
      r: '0xffe76e17da28e22e1cc16a1321bc32f7c5c6f952f56cbc3b6a1fdd5469670ce4',
      s: '0x7ebe17ef06b8c8b49f5ec0416696f142ac9af2bee5ba66d9f4faddaa9a997f7b',
      gasPrice: '0xa54f4c3c00',
    },
    {
      blockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      blockNumber: null,
      transactionIndex: null,
      from: '0x2eD4dF6Ec66f55a5765DeF0A24BFA3bAC29e795e',
      gas: '0x186a0',
      hash: '0x6bb033c0cd822f66502a5e4a78e6eb46fd54105a92e02347cbc60036d075ec18',
      input: '0x',
      nonce: '0x2',
      to: '0x9b6FEaeA745fE564158DA9A5313eb4dd4Dc3A940',
      value: '0xde0b6b3a7640000',
      type: '0x1',
      v: '0x1b',
      r: '0x7c18462b45a419337ff6bccf8beb7f75c9e6bdf5306c92289f55f8162673044e',
      s: '0x682380bcf81f37c39f22a5ff44bc6098014259350d107c8da3a115764742590d',
      gasPrice: '0xa54f4c3c00',
    },
  ];

  before(() => {
    sinon.stub(Relay.prototype, 'ensureOperatorHasBalance').resolves();
  });

  after(() => {
    sinon.restore();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(ConfigService, 'get').returns(true);

    const registry = new Registry();
    const txPoolService = new TransactionPoolService({} as any, logger, registry);
    txPool = new TxPoolImpl(txPoolService);
    txPoolServiceMock = sandbox.createStubInstance(TransactionPoolService);
    (txPool as any).txPoolService = txPoolServiceMock;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('private methods', async () => {
    it('convertRlpEncodedTxToTransactionPoolTx', async () => {
      const result = (txPool as any).convertRlpEncodedTxToTransactionPoolTx(rlpTxs);
      expect(result).to.have.lengthOf(1);

      const tx = result[0];
      expect(tx.blockHash).to.equal(constants.ZERO_HEX_32_BYTE);
      expect(tx.blockNumber).to.be.null;
      expect(tx.transactionIndex).to.be.null;
      expect(tx.hash).to.equal(parsedTx.hash);
      expect(tx.from).to.equal(parsedTx.from);
      expect(tx.to).to.equal(parsedTx.to);
      expect(tx.input).to.equal(parsedTx.data);
      expect(tx.gas).to.equal(numberTo0x(parsedTx.gasLimit));
      expect(tx.value).to.equal(numberTo0x(parsedTx.value));
      expect(tx.nonce).to.equal(numberTo0x(parsedTx.nonce));
      expect(tx.type).to.equal(numberTo0x(parsedTx.type));
      expect(tx.gasPrice).to.equal(numberTo0x(parsedTx.gasPrice));
      expect(tx.v).to.equal(numberTo0x(parsedTx.signature.v));
      expect(tx.r).to.equal(parsedTx.signature.r);
      expect(tx.s).to.equal(parsedTx.signature.s);
    });

    it('groupByAddressAndNonce', async () => {
      const grouped = (txPool as any).groupByAddressAndNonce(groupByAddressAndNonceTxs);
      expect(grouped).to.have.keys([
        '0x2eD4dF6Ec66f55a5765DeF0A24BFA3bAC29e795e',
        '0xf1dc6c33b1d6720Cd24eCb296F4D96150Eb170dc',
      ]);
      expect(grouped['0x2eD4dF6Ec66f55a5765DeF0A24BFA3bAC29e795e']).to.have.keys(['1', '2']);
      expect(grouped['0xf1dc6c33b1d6720Cd24eCb296F4D96150Eb170dc']).to.have.key('1');
      expect(grouped['0x2eD4dF6Ec66f55a5765DeF0A24BFA3bAC29e795e'][1].hash).to.equal(
        '0x2209a2b1b8e7258a4195411e1c8665683b6fc4c7ac1b11a62a8f331b8e68973f',
      );
    });

    it('groupByNonce', async () => {
      const grouped = (txPool as any).groupByNonce(groupByNonceTxs);
      expect(grouped).to.have.keys(['1', '2']);
      expect(grouped[1].hash).to.equal('0x2209a2b1b8e7258a4195411e1c8665683b6fc4c7ac1b11a62a8f331b8e68973f');
      expect(grouped[2].hash).to.equal('0x6bb033c0cd822f66502a5e4a78e6eb46fd54105a92e02347cbc60036d075ec18');
    });
  });

  describe('content', async () => {
    it('should return grouped pending transactions', async () => {
      txPoolServiceMock.getAllTransactions.resolves(rlpTxs);

      const res = await txPool.content();
      expect(res).to.have.keys(['pending', 'queued']);
      expect(res.pending).to.have.property(parsedTx.from);
      expect(res.queued).to.deep.equal({});
    });
  });

  describe('contentFrom', async () => {
    it('should return grouped transactions by nonce for a specific address', async () => {
      txPoolServiceMock.getTransactions.resolves(rlpTxs);

      const res = await txPool.contentFrom(parsedTx.from);
      expect(res).to.have.keys(['pending', 'queued']);
      expect(res.pending[parsedTx.nonce]).to.have.property('hash', parsedTx.hash);
    });
  });

  describe('status', async () => {
    it('should return correct pending count and zero queued', async () => {
      txPoolServiceMock.getAllTransactions.resolves(rlpTxs);

      const res = await txPool.status();
      expect(res).to.deep.equal({
        pending: numberTo0x(rlpTxs.size),
        queued: constants.ZERO_HEX,
      });
    });
  });
});
