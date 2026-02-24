// SPDX-License-Identifier: Apache-2.0

import { RLP } from '@ethereumjs/rlp';
import { expect } from 'chai';

import { numberTo0x } from '../../../src/formatters';
import constants from '../../../src/lib/constants';
import { BlockFactory } from '../../../src/lib/factories/blockFactory';
import { Block, Transaction } from '../../../src/lib/model';

const blockInfo = {
  timestamp: '0x698afa66',
  difficulty: '0x0',
  extraData: '0x',
  gasLimit: '0x1c9c380',
  baseFeePerGas: '0xd63445f000',
  gasUsed: '0xa32c1',
  logsBloom:
    '0x0000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000',
  miner: '0x0000000000000000000000000000000000000000',
  mixHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
  nonce: '0x0000000000000000',
  receiptsRoot: '0x26c9ecffe4aa9e2e19f814a570bd1e9093ff55e9e6c18f39f4192de6e36153db',
  sha3Uncles: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
  size: '0x1b81',
  stateRoot: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
  totalDifficulty: '0x0',
  transactions: [
    {
      blockHash: '0xcf55eb0655b5d21c38413afe1919099a83140514cb6c531aebd77e3d2c5506ce',
      blockNumber: '0x1de1f54',
      chainId: '0x128',
      from: '0xbe04a4900b02fe715c75ff307f0b531894184c91',
      gas: '0xc2860',
      gasPrice: '0x0',
      hash: '0x4454bdc6328e6cafb477c76af5e6a72dcb9f97e5aa79d76900f8ca65712a8151',
      input:
        '0xef7615ce00000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000012000000000000000000000000085614ea608c5dd326ba83aeaaacc7eb9d090e0d40000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000019800000000000000000000000000000000000000000000000000000000000002e0000000000000000000000000000000000000000000000000000000000000002436623739366561382d303635622d343133322d383266642d38653766613334626338623900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000672616e616a69000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001586b615258536e5a6f62384c6c5a6c3270327351367134426337385977553175564473746b42756b66724652306556304f6e3750504c4a324a7262655157717443474c5170797579367559686a725138685a6c4f646242485831484741616277544147397a61483068504d4765336c7136682f665a5a5266316b6161626b356c34476d352f4b6a516e4746654a52776a55753565546775305242507338314b416238444735304e6c77524544616f5547635762376c514c504b656e6b354d4f5064662f31504c58546f383461793333307a77446e61786a46584f30783239373761786e4548365879696c5941784b636c7954397963793766477a6b4d724a6a757a376850486767436d4652315a68664a5252334778684c647a366f4336424b497554506154524b52566e63345742585432454577494c2f514d4542422f764d4a695a326733665a576e563572595962446c6e42326338773d3d000000000000000000000000000000000000000000000000000000000000000000000000000000415f0770f2c509e8cb0c3dacceca295e43657f1232c62c9f2d542d8754a6a94720500abc4b95446945a686675fc1e1768506390f5aa2be98ef2e58727d8893b99f1c00000000000000000000000000000000000000000000000000000000000000',
      nonce: '0x168a',
      r: '0xabbfb012c0b774997edcf782a256e55590325962f7a96ffb64467a323c84733f',
      s: '0x60627cc8fc5be8d28dbec3de0835769f1140604eae6bb732dbc60b7aba4274aa',
      to: '0xdd902a9d02d570d92e5d94b095bf6b7a4106773a',
      transactionIndex: '0xf',
      type: '0x2',
      v: '0x0',
      value: '0x0',
      yParity: '0x0',
      accessList: [],
      maxPriorityFeePerGas: '0x62',
      maxFeePerGas: '0x62',
    },
  ],
  transactionsRoot: '0xcf55eb0655b5d21c38413afe1919099a83140514cb6c531aebd77e3d2c5506ce',
  uncles: [],
  withdrawals: [],
  withdrawalsRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
  number: '0x1de1f54',
  hash: '0xcf55eb0655b5d21c38413afe1919099a83140514cb6c531aebd77e3d2c5506ce',
  parentHash: '0xd7dbe6b1379e3e1d71729a92e167af28d6b79aa9e40b0f6d845fe7b85c500bfa',
};

const blockResponse: any = {
  hash: blockInfo.hash,
  timestamp: { from: '1770715750.000000000' },
  gas_used: parseInt(blockInfo.gasUsed, 16),
  logs_bloom: blockInfo.logsBloom,
  number: parseInt(blockInfo.number, 16),
  previous_hash: blockInfo.parentHash,
  size: parseInt(blockInfo.size, 16),
};

const hexToData = (buf) => `0x${Buffer.from(buf).toString('hex')}`;

const hexToQuantity = (buf) => {
  if (buf.length === 0) return '0x0';
  return `0x${Buffer.from(buf).toString('hex').replace(/^0+/, '') || '0'}`;
};

describe('BlockFactory', () => {
  describe('createBlock', () => {
    it('should map MirrorNodeBlock fields correctly', async () => {
      const block = await BlockFactory.createBlock({
        blockResponse,
        txArray: blockInfo.transactions,
        gasPrice: blockInfo.baseFeePerGas,
        receiptsRoot: blockInfo.receiptsRoot,
      });

      expect(block.hash).to.equal(blockInfo.hash);
      expect(block.parentHash).to.equal(blockInfo.parentHash);
      expect(block.number).to.equal(numberTo0x(parseInt(blockInfo.number, 16)));
      expect(block.gasUsed).to.equal(numberTo0x(parseInt(blockInfo.gasUsed, 16)));
      expect(block.baseFeePerGas).to.equal(blockInfo.baseFeePerGas);
      expect(block.transactions).to.deep.equal(blockInfo.transactions);
      expect(block.timestamp).to.equal(blockInfo.timestamp);
      expect(block.logsBloom).to.equal(blockInfo.logsBloom);
      expect(block.receiptsRoot).to.equal(blockInfo.receiptsRoot);
    });

    it('should set transactionsRoot to default when txArray is empty', async () => {
      const block = await BlockFactory.createBlock({
        blockResponse,
        txArray: [],
        gasPrice: blockInfo.baseFeePerGas,
        receiptsRoot: blockInfo.receiptsRoot,
      });

      expect(block.transactions).to.have.length(0);
      expect(block.transactionsRoot).to.equal(constants.DEFAULT_ROOT_HASH);
    });
  });

  describe('rlpEncodeTx', () => {
    it('should produce deterministic serialization for EIP-1559 tx', () => {
      const tx = blockInfo.transactions[0] as Transaction;
      const encoded1 = BlockFactory.rlpEncodeTx(tx);
      const encoded2 = BlockFactory.rlpEncodeTx(tx);

      expect(encoded1).to.equal(encoded2);
      expect(encoded1.startsWith('0x02')).to.be.true;
    });

    it('should pad empty signature r and s to canonical zero encoding', () => {
      const tx: any = {
        ...blockInfo.transactions[0],
        r: '0x',
        s: '0x0',
      };

      const encoded = BlockFactory.rlpEncodeTx(tx);

      const hex = encoded.slice(2);
      const typeByte = hex.slice(0, 2);
      expect(typeByte).to.equal('02');

      const rlpPayload = Buffer.from(hex.slice(2), 'hex');
      const decoded: any[] = RLP.decode(rlpPayload) as any[];

      const rField: Uint8Array = decoded[decoded.length - 3];
      const sField: Uint8Array = decoded[decoded.length - 2];

      expect(rField.length).to.equal(0);
      expect(sField.length).to.equal(0);
    });

    it('should encode legacy transaction with gasPrice', () => {
      const tx: any = {
        ...blockInfo.transactions[0],
        type: '0x0',
        gasPrice: '0x1',
      };

      const encoded = BlockFactory.rlpEncodeTx(tx);

      expect(encoded.startsWith('0x')).to.be.true;
      expect(encoded.startsWith('0x02')).to.be.false;
    });

    it('should encode EIP-2930 with accessList', () => {
      const tx: any = {
        ...blockInfo.transactions[0],
        type: '0x1',
        gasPrice: '0x1',
        accessList: [],
      };

      const encoded = BlockFactory.rlpEncodeTx(tx);
      expect(encoded.startsWith('0x01')).to.be.true;
    });

    it('should encode EIP-7702 with authorization list entries', () => {
      const tx: any = {
        ...blockInfo.transactions[0],
        type: '0x4',
        authorizationList: [
          {
            chainId: 1,
            nonce: 1,
            address: '0x000000000000000000000000000000000000dead',
            r: blockInfo.transactions[0].r,
            s: blockInfo.transactions[0].s,
            yParity: '0x0',
          },
        ],
      };

      const encoded = BlockFactory.rlpEncodeTx(tx);
      expect(encoded.startsWith('0x04')).to.be.true;
      expect(encoded.length).to.be.greaterThan(10);
    });
  });

  describe('rlpEncodeBlockHeader and rlpEncodeBlock', () => {
    let block: Block;

    beforeEach(async () => {
      block = await BlockFactory.createBlock({
        blockResponse,
        txArray: blockInfo.transactions,
        gasPrice: blockInfo.baseFeePerGas,
        receiptsRoot: blockInfo.receiptsRoot,
      });
    });

    it('should RLP encode header with exactly 17 fields', () => {
      const encoded = BlockFactory.rlpEncodeBlockHeader(block);
      const decoded = RLP.decode(encoded) as Uint8Array[];

      expect(decoded).to.have.length(17);

      expect(hexToData(decoded[0])).to.equal(blockInfo.parentHash);
      expect(hexToData(decoded[1])).to.equal(constants.EMPTY_ARRAY_HEX);
      expect(hexToData(decoded[2])).to.equal(constants.HEDERA_NODE_REWARD_ACCOUNT_ADDRESS);
      expect(hexToData(decoded[3])).to.equal(blockInfo.stateRoot);
      expect(hexToData(decoded[4])).to.equal(blockInfo.transactionsRoot);
      expect(hexToData(decoded[5])).to.equal(blockInfo.receiptsRoot);
      expect(hexToData(decoded[6])).to.equal(blockInfo.logsBloom);
      expect(hexToQuantity(decoded[7])).to.equal(blockInfo.difficulty);
      expect(hexToQuantity(decoded[8])).to.equal(blockInfo.number);
      expect(hexToQuantity(decoded[9])).to.equal(blockInfo.gasLimit);
      expect(hexToQuantity(decoded[10])).to.equal(blockInfo.gasUsed);
      expect(hexToData(decoded[11])).to.equal(blockInfo.timestamp);
      expect(hexToData(decoded[12])).to.equal(blockInfo.extraData);
      expect(hexToData(decoded[13])).to.equal(blockInfo.mixHash);
      expect(hexToData(decoded[14])).to.equal(blockInfo.nonce);
      expect(hexToData(decoded[15])).to.equal(blockInfo.baseFeePerGas);
      expect(hexToData(decoded[16])).to.equal(blockInfo.withdrawalsRoot);
    });

    it('should RLP encode full block including transactions array', () => {
      const encoded = BlockFactory.rlpEncodeBlock(block);
      const decoded = RLP.decode(encoded) as any[];

      // header (17) + txs + ommers + withdrawals
      expect(decoded.length).to.equal(20);

      const txArray = decoded[17];
      expect(txArray).to.be.an('array');
      expect(txArray).to.have.length(1);
    });

    it('should RLP encode full block including empty transactions array', () => {
      const encoded = BlockFactory.rlpEncodeBlock({
        ...block,
        transactions: [],
      });
      const decoded = RLP.decode(encoded) as any[];

      // header (17) + txs + ommers + withdrawals
      expect(decoded.length).to.equal(20);

      const txArray = decoded[17];
      expect(txArray).to.be.an('array');
      expect(txArray).to.have.length(0);
    });

    it('should throw when transactions are only hashes', () => {
      const invalidBlock: any = {
        ...block,
        transactions: ['0xabc'],
      };

      expect(() => BlockFactory.rlpEncodeBlock(invalidBlock)).to.throw(
        'Block transactions must include full transaction objects for RLP encoding',
      );
    });
  });
});
