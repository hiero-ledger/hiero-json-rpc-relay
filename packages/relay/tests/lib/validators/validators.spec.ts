import { expect } from 'chai';

import * as Constants from '../../../src/lib/validators/constants';
import { OBJECTS_VALIDATIONS, TracerType, TransactionObject, Validator } from '../../../src/lib/validators';

describe('Validator', async () => {
  function expectInvalidParam(index: number | string, message: string, paramValue?: string) {
    return `Invalid parameter ${index}: ${message}${paramValue ? `, value: ${paramValue}` : ''}`;
  }

  function expectUnknownParam(index: number | string, object: string, message: string) {
    return `Invalid parameter '${index}' for ${object}: ${message}`;
  }

  function expectInvalidObject(index: number | string, message: string, object: string, paramValue: string) {
    return `Invalid parameter '${index}' for ${object}: ${message}, value: ${paramValue}`;
  }

  describe('validates Address type correctly', async () => {
    const validation = { 0: { type: 'address' } };

    it('throws an error if address hash is smaller than 20bytes', async () => {
      expect(() => Validator.validateParams(['0x4422E9088662'], validation)).to.throw(
        expectInvalidParam(0, Validator.ADDRESS_ERROR, '0x4422E9088662'),
      );
    });

    it('throws an error if address is larger than 20bytes', async () => {
      expect(() => Validator.validateParams(['0x4422E9088662c44604189B2aA3ae8eE282fceBB7b7b7'], validation)).to.throw(
        expectInvalidParam(0, Validator.ADDRESS_ERROR, '0x4422E9088662c44604189B2aA3ae8eE282fceBB7b7b7'),
      );
    });

    it('throws an error if address is NOT 0x prefixed', async () => {
      expect(() => Validator.validateParams(['4422E9088662c44604189B2aA3ae8eE282fceBB7'], validation)).to.throw(
        expectInvalidParam(0, Validator.ADDRESS_ERROR, '4422E9088662c44604189B2aA3ae8eE282fceBB7'),
      );
    });

    it('throws an error if address is other type', async () => {
      expect(() => Validator.validateParams(['random string'], validation)).to.throw(
        expectInvalidParam(0, Validator.ADDRESS_ERROR, 'random string'),
      );
      expect(() => Validator.validateParams(['123'], validation)).to.throw(
        expectInvalidParam(0, Validator.ADDRESS_ERROR, '123'),
      );
      expect(() => Validator.validateParams([[]], validation)).to.throw(
        expectInvalidParam(0, Validator.ADDRESS_ERROR, ''),
      );
      expect(() => Validator.validateParams([{}], validation)).to.throw(
        expectInvalidParam(0, Validator.ADDRESS_ERROR, '{}'),
      );
    });

    it('does not throw an error if address is valid', async () => {
      const result = Validator.validateParams(['0x4422E9088662c44604189B2aA3ae8eE282fceBB7'], validation);

      expect(result).to.eq(undefined);
    });

    it('does not throw an error if address is long-zero address', async () => {
      const result = Validator.validateParams(['0x0000000000000000000000000000000000000408'], validation);

      expect(result).to.eq(undefined);
    });
  });

  describe('validates Array type correctly', async () => {
    const validation = { 0: { type: 'array' } };
    const error = Validator.TYPES['array'].error;

    it('throws an error if the param is not an array', async () => {
      expect(() => Validator.validateParams(['random string'], validation)).to.throw(
        expectInvalidParam(0, error, 'random string'),
      );
      expect(() => Validator.validateParams([123], validation)).to.throw(expectInvalidParam(0, error, '123'));
      expect(() => Validator.validateParams([true], validation)).to.throw(expectInvalidParam(0, error, 'true'));
      expect(() => Validator.validateParams([{}], validation)).to.throw(expectInvalidParam(0, error, '{}'));
    });

    it('does not throw an error if param is array', async () => {
      expect(Validator.validateParams([['0x1']], validation)).to.eq(undefined);
    });
  });

  describe('validates blockHash type correctly', async () => {
    const validation = { 0: { type: 'blockHash' } };

    it('throws an error if block hash is smaller than 32bytes', async () => {
      expect(() => Validator.validateParams(['0xdec54931fcfe'], validation)).to.throw(
        expectInvalidParam(0, Validator.BLOCK_HASH_ERROR, '0xdec54931fcfe'),
      );
    });

    it('throws an error if block hash is larger than 32bytes', async () => {
      expect(() =>
        Validator.validateParams(
          ['0xdec54931fcfe053f3ffec90c1f7fd20158420b415054f15a4d16b63c528f70a8a8a8'],
          validation,
        ),
      ).to.throw(
        expectInvalidParam(
          0,
          Validator.BLOCK_HASH_ERROR,
          '0xdec54931fcfe053f3ffec90c1f7fd20158420b415054f15a4d16b63c528f70a8a8a8',
        ),
      );
    });

    it('throws an error if block hash is NOT 0x prefixed', async () => {
      expect(() =>
        Validator.validateParams(['dec54931fcfe053f3ffec90c1f7fd20158420b415054f15a4d16b63c528f70a8a8a8'], validation),
      ).to.throw(
        expectInvalidParam(
          0,
          Validator.BLOCK_HASH_ERROR,
          'dec54931fcfe053f3ffec90c1f7fd20158420b415054f15a4d16b63c528f70a8a8a8',
        ),
      );
    });

    it('throws an error if block hash is other type', async () => {
      expect(() => Validator.validateParams(['string'], validation)).to.throw(
        expectInvalidParam(0, Validator.BLOCK_HASH_ERROR, 'string'),
      );
      expect(() => Validator.validateParams([123], validation)).to.throw(
        expectInvalidParam(0, Validator.BLOCK_HASH_ERROR, '123'),
      );
      expect(() => Validator.validateParams([[]], validation)).to.throw(
        expectInvalidParam(0, Validator.BLOCK_HASH_ERROR, ''),
      );
      expect(() => Validator.validateParams([{}], validation)).to.throw(
        expectInvalidParam(0, Validator.BLOCK_HASH_ERROR, '{}'),
      );
    });

    it('does not throw an error if block hash is valid', async () => {
      const result = Validator.validateParams(
        ['0xdec54931fcfe053f3ffec90c1f7fd20158420b415054f15a4d16b63c528f70a8'],
        validation,
      );

      expect(result).to.eq(undefined);
    });
  });

  describe('validates blockNumber type correctly', async () => {
    const validation = { 0: { type: 'blockNumber' } };

    it('throws error if block number is decimal', async () => {
      expect(() => Validator.validateParams([123], validation)).to.throw(
        expectInvalidParam(0, Validator.BLOCK_NUMBER_ERROR, '123'),
      );
    });

    it('throws error if block number is NOT 0x prefixed hex', async () => {
      expect(() => Validator.validateParams(['000f'], validation)).to.throw(
        expectInvalidParam(0, Validator.BLOCK_NUMBER_ERROR, '000f'),
      );
    });

    it('throws error if block number is hex with leading zeros digits', async () => {
      expect(() => Validator.validateParams(['0x00000000000000a'], validation)).to.throw(
        expectInvalidParam(0, Validator.BLOCK_NUMBER_ERROR, '0x00000000000000a'),
      );
    });

    it('throws error if block number is greater than (2^53 – 1)', async () => {
      expect(() => Validator.validateParams(['0x20000000000007'], validation)).to.throw(
        expectInvalidParam(0, Validator.BLOCK_NUMBER_ERROR, '0x20000000000007'),
      );
    });

    it('throws error if block number contains invalid hex characters', async () => {
      expect(() => Validator.validateParams(['0xg'], validation)).to.throw(
        expectInvalidParam(0, Validator.BLOCK_NUMBER_ERROR, '0xg'),
      );
    });

    it('throws error if block number is not correct tag', async () => {
      expect(() => Validator.validateParams(['newest'], validation)).to.throw(
        expectInvalidParam(0, Validator.BLOCK_NUMBER_ERROR, 'newest'),
      );
    });

    it('throws error if block number is random type', async () => {
      expect(() => Validator.validateParams(['string'], validation)).to.throw(
        expectInvalidParam(0, Validator.BLOCK_NUMBER_ERROR, 'string'),
      );
      expect(() => Validator.validateParams([[]], validation)).to.throw(
        expectInvalidParam(0, Validator.BLOCK_NUMBER_ERROR, ''),
      );
      expect(() => Validator.validateParams([{}], validation)).to.throw(
        expectInvalidParam(0, Validator.BLOCK_NUMBER_ERROR, '{}'),
      );
    });

    it('does not throw error when block number is valid hex', async () => {
      const result = Validator.validateParams(['0xf'], validation);

      expect(result).to.eq(undefined);
    });

    it('does not throw error when block number is valid tag', async () => {
      const validation = { 0: { type: 'blockNumber' } };

      expect(Validator.validateParams(['earliest'], validation)).to.eq(undefined);
      expect(Validator.validateParams(['pending'], validation)).to.eq(undefined);
      expect(Validator.validateParams(['latest'], validation)).to.eq(undefined);
    });
  });

  describe('validates boolean type correctly', async () => {
    const validation = { 0: { type: 'boolean', required: true } };
    const error = Validator.TYPES['boolean'].error;

    it('throws an error if param is string', async () => {
      expect(() => Validator.validateParams(['true'], validation)).to.throw(expectInvalidParam(0, error, 'true'));
      expect(() => Validator.validateParams(['false'], validation)).to.throw(expectInvalidParam(0, error, 'false'));
    });

    it('throws an error if param is other type of truthy or falsy value', async () => {
      expect(() => Validator.validateParams([1], validation)).to.throw(expectInvalidParam(0, error, '1'));
      expect(() => Validator.validateParams([2], validation)).to.throw(expectInvalidParam(0, error, '2'));
    });

    it('throws an error if param is another type', async () => {
      expect(() => Validator.validateParams([123], validation)).to.throw(expectInvalidParam(0, error, '123'));
      expect(() => Validator.validateParams(['0x1'], validation)).to.throw(expectInvalidParam(0, error, '0x1'));
      expect(() => Validator.validateParams([[]], validation)).to.throw(expectInvalidParam(0, error, ''));
      expect(() => Validator.validateParams([{}], validation)).to.throw(expectInvalidParam(0, error, '{}'));
    });
  });

  describe('validates Filter Object type correctly', async () => {
    const validation = { 0: { type: 'filter', required: true } };
    const error = Validator.TYPES['filter'].error;
    const object = Validator.FilterObject.name;

    it('throws an error if the param is not an Object', async () => {
      expect(() => Validator.validateParams(['0x1'], validation)).to.throw(expectInvalidParam(0, error, '0x1'));
      expect(() => Validator.validateParams([123], validation)).to.throw(expectInvalidParam(0, error, '123'));
      expect(() => Validator.validateParams([[]], validation)).to.throw(expectInvalidParam(0, error, ''));
      expect(() => Validator.validateParams([true], validation)).to.throw(expectInvalidParam(0, error, 'true'));
    });

    it('throws an error if both blockHash and fromBlock/toBlock are used', async () => {
      expect(() =>
        Validator.validateParams(
          [{ blockHash: '0xdec54931fcfe053f3ffec90c1f7fd20158420b415054f15a4d16b63c528f70a8', fromBlock: 'latest' }],
          validation,
        ),
      ).to.throw(expectInvalidParam(0, "Can't use both blockHash and toBlock/fromBlock"));
    });

    it('throws an error if the Filter Object properties are the wrong type', async () => {
      expect(() => Validator.validateParams([{ blockHash: 123 }], validation)).to.throw(
        expectInvalidObject('blockHash', Validator.BLOCK_HASH_ERROR, object, '123'),
      );
      expect(() => Validator.validateParams([{ toBlock: 123 }], validation)).to.throw(
        expectInvalidObject('toBlock', Validator.BLOCK_NUMBER_ERROR, object, '123'),
      );
      expect(() => Validator.validateParams([{ fromBlock: 123 }], validation)).to.throw(
        expectInvalidObject('fromBlock', Validator.BLOCK_NUMBER_ERROR, object, '123'),
      );
      expect(() => Validator.validateParams([{ address: '0x1' }], validation)).to.throw(
        expectInvalidObject('address', Validator.TYPES.addressFilter.error, object, '0x1'),
      );
      expect(() => Validator.validateParams([{ topics: {} }], validation)).to.throw(
        expectInvalidObject('topics', Validator.TYPES.topics.error, object, '{}'),
      );
      expect(() => Validator.validateParams([{ topics: [123] }], validation)).to.throw(
        expectInvalidObject('topics', Validator.TYPES.topics.error, object, '[123]'),
      );
    });

    it('does not throw an error for correct values', async () => {
      expect(
        Validator.validateParams(
          [{ blockHash: '0xdec54931fcfe053f3ffec90c1f7fd20158420b415054f15a4d16b63c528f70a8' }],
          validation,
        ),
      ).to.eq(undefined);
      expect(Validator.validateParams([{ toBlock: '0x2' }], validation)).to.eq(undefined);
      expect(Validator.validateParams([{ toBlock: 'latest' }], validation)).to.eq(undefined);
      expect(Validator.validateParams([{ fromBlock: '0x1' }], validation)).to.eq(undefined);
      expect(Validator.validateParams([{ fromBlock: 'earliest' }], validation)).to.eq(undefined);
      expect(Validator.validateParams([{ address: '0x4422E9088662c44604189B2aA3ae8eE282fceBB7' }], validation)).to.eq(
        undefined,
      );
      expect(
        Validator.validateParams(
          [{ address: ['0x4422E9088662c44604189B2aA3ae8eE282fceBB7', '0x4422E9088662c44604189B2aA3ae8eE282fceBB8'] }],
          validation,
        ),
      ).to.eq(undefined);
      expect(
        Validator.validateParams(
          [{ topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'] }],
          validation,
        ),
      ).to.eq(undefined);
      expect(
        Validator.validateParams(
          [
            {
              topics: [
                [
                  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                  '0xea443924a9fba8d643a00daf0a7956ebc37fa4e9da82f07f80c34f0f5217edf9',
                ],
              ],
            },
          ],
          validation,
        ),
      ).to.eq(undefined);
    });
  });

  describe('validates topics type correctly', async () => {
    const validation = { 0: { type: 'topics' } };
    const topicsError = Validator.TYPES['topics'].error;
    it('throws an error if topics contains hash smaller than 32bytes', async () => {
      expect(() =>
        Validator.validateParams(
          [['0xddf252ad1be2c89', '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']],
          validation,
        ),
      ).to.throw(
        expectInvalidParam(
          0,
          topicsError,
          '["0xddf252ad1be2c89","0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]',
        ),
      );
    });

    it('throws an error if topics contains hash larger than 32bytes', async () => {
      expect(() =>
        Validator.validateParams(
          [
            [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3effffffffffff',
            ],
          ],
          validation,
        ),
      ).to.throw(
        expectInvalidParam(
          0,
          topicsError,
          '["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef","0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3effffffffffff"]',
        ),
      );
    });

    it('throws an error if topics contains hashes NOT 0x prefixed', async () => {
      expect(() =>
        Validator.validateParams(
          [
            [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
            ],
          ],
          validation,
        ),
      ).to.throw(
        expectInvalidParam(
          0,
          topicsError,
          '["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef","ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]',
        ),
      );
    });

    it('throws an error if topics is not array', async () => {
      expect(() => Validator.validateParams([123], validation)).to.throw(expectInvalidParam(0, topicsError, '123'));
      expect(() => Validator.validateParams(['0x1'], validation)).to.throw(expectInvalidParam(0, topicsError, '0x1'));
      expect(() => Validator.validateParams([{}], validation)).to.throw(expectInvalidParam(0, topicsError, '{}'));
    });

    it('does not throw an error if topics param is valid', async () => {
      const result = Validator.validateParams(
        [['0x790673a87ac19773537b2553e1dc7c451f659e0f75d1b69a706ad42d25cbdb55']],
        validation,
      );

      expect(result).to.eq(undefined);
    });

    it('does not throw an error if topics param is null', async () => {
      const result = Validator.validateParams(
        [[null, '0x790673a87ac19773537b2553e1dc7c451f659e0f75d1b69a706ad42d25cbdb55']],
        validation,
      );

      expect(result).to.eq(undefined);
    });

    it('should handle nested topic arrays', async () => {
      const result = Validator.validateParams(
        [
          [
            ['0x790673a87ac19773537b2553e1dc7c451f659e0f75d1b69a706ad42d25cbdb55'],
            ['0x790673a87ac19773537b2553e1dc7c451f659e0f75d1b69a706ad42d25cbdb56'],
          ],
        ],
        validation,
      );

      expect(result).to.eq(undefined);
    });

    it('should allow topic to be null in nested topic arrays', async () => {
      const result = Validator.validateParams(
        [
          [
            [null, '0x790673a87ac19773537b2553e1dc7c451f659e0f75d1b69a706ad42d25cbdb55'],
            ['0x790673a87ac19773537b2553e1dc7c451f659e0f75d1b69a706ad42d25cbdb56'],
          ],
        ],
        validation,
      );

      expect(result).to.eq(undefined);
    });

    it('should correctly validate nested topic arrays', async () => {
      expect(() =>
        Validator.validateParams(
          [
            [
              ['0x790673a87ac19773537b2553e1dc7c451f659e0f75d1b69a706ad42d25cbdb55'],
              ['0x790673a87ac19773537b2553e1dc7'],
            ],
          ],
          validation,
        ),
      ).to.throw(
        expectInvalidParam(
          0,
          topicsError,
          '[["0x790673a87ac19773537b2553e1dc7c451f659e0f75d1b69a706ad42d25cbdb55"],["0x790673a87ac19773537b2553e1dc7"]]',
        ),
      );
    });
  });

  describe('validates topicHash type correctly', async () => {
    const validation = { 0: { type: 'topicHash' } };

    it('throws an error if topic hash is smaller than 32bytes', async () => {
      expect(() => Validator.validateParams(['0xddf252ad1be2c89'], validation)).to.throw(
        expectInvalidParam(0, Validator.TOPIC_HASH_ERROR, '0xddf252ad1be2c89'),
      );
    });

    it('throws an error if topic hash is larger than 32bytes', async () => {
      expect(() =>
        Validator.validateParams(
          ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3effffff'],
          validation,
        ),
      ).to.throw(
        expectInvalidParam(
          0,
          Validator.TOPIC_HASH_ERROR,
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3effffff',
        ),
      );
    });

    it('throws an error if topic hash is NOT 0x prefixed', async () => {
      expect(() =>
        Validator.validateParams(['ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'], validation),
      ).to.throw(
        expectInvalidParam(
          0,
          Validator.TOPIC_HASH_ERROR,
          'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
        ),
      );
    });

    it('throws an error if topic hash is other type', async () => {
      expect(() => Validator.validateParams(['string'], validation)).to.throw(
        expectInvalidParam(0, Validator.TOPIC_HASH_ERROR, 'string'),
      );
      expect(() => Validator.validateParams([123], validation)).to.throw(
        expectInvalidParam(0, Validator.TOPIC_HASH_ERROR, '123'),
      );
      expect(() => Validator.validateParams([[]], validation)).to.throw(
        expectInvalidParam(0, Validator.TOPIC_HASH_ERROR, ''),
      );
      expect(() => Validator.validateParams([{}], validation)).to.throw(
        expectInvalidParam(0, Validator.TOPIC_HASH_ERROR, '{}'),
      );
    });

    it('does not throw an error if topic hash is valid', async () => {
      const result = Validator.validateParams(
        ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],
        validation,
      );

      expect(result).to.eq(undefined);
    });
  });

  describe('validates Transaction Object type correctly', async () => {
    const validation = { 0: { type: 'transaction', required: true } };
    const error = Validator.TYPES['transaction'].error;
    const object = Validator.TransactionObject.name;

    it('throws an error if the param is not an Object', async () => {
      expect(() => Validator.validateParams(['string'], validation)).to.throw(expectInvalidParam(0, error, 'string'));
      expect(() => Validator.validateParams([123], validation)).to.throw(expectInvalidParam(0, error, '123'));
      expect(() => Validator.validateParams([[]], validation)).to.throw(expectInvalidParam(0, error, ''));
      expect(() => Validator.validateParams([true], validation)).to.throw(expectInvalidParam(0, error, 'true'));
    });

    it('throws an error if the Transaction Object properties are the wrong type', async () => {
      expect(() => Validator.validateParams([{ from: '0x1234' }], validation)).to.throw(
        expectInvalidObject('from', Validator.ADDRESS_ERROR, object, '0x1234'),
      );
      expect(() => Validator.validateParams([{ to: '0x1234' }], validation)).to.throw(
        expectInvalidObject('to', Validator.ADDRESS_ERROR, object, '0x1234'),
      );
      expect(() => Validator.validateParams([{ gas: 123 }], validation)).to.throw(
        expectInvalidObject('gas', Validator.DEFAULT_HEX_ERROR, object, '123'),
      );
      expect(() => Validator.validateParams([{ gasPrice: 123 }], validation)).to.throw(
        expectInvalidObject('gasPrice', Validator.DEFAULT_HEX_ERROR, object, '123'),
      );
      expect(() => Validator.validateParams([{ maxPriorityFeePerGas: 123 }], validation)).to.throw(
        expectInvalidObject('maxPriorityFeePerGas', Validator.DEFAULT_HEX_ERROR, object, '123'),
      );
      expect(() => Validator.validateParams([{ maxFeePerGas: 123 }], validation)).to.throw(
        expectInvalidObject('maxFeePerGas', Validator.DEFAULT_HEX_ERROR, object, '123'),
      );
      expect(() => Validator.validateParams([{ value: '123456' }], validation)).to.throw(
        expectInvalidObject('value', Validator.DEFAULT_HEX_ERROR, object, '123456'),
      );
      expect(() => Validator.validateParams([{ data: '123456' }], validation)).to.throw(
        expectInvalidObject('data', Validator.EVEN_HEX_ERROR, object, '123456'),
      );
      expect(() => Validator.validateParams([{ data: '0x1234567' }], validation)).to.throw(
        expectInvalidObject('data', Validator.EVEN_HEX_ERROR, object, '0x1234567'),
      );
    });
  });

  describe('validates transactionHash type correctly', async () => {
    const validation = { 0: { type: 'transactionHash' } };

    it('throws an error if transactionHash is smaller than 32bytes', async () => {
      expect(() => Validator.validateParams(['0xdec54931fcfe'], validation)).to.throw(
        expectInvalidParam(0, Validator.TRANSACTION_HASH_ERROR, '0xdec54931fcfe'),
      );
    });

    it('throws an error if transactionHash is larger than 32bytes', async () => {
      expect(() =>
        Validator.validateParams(
          ['0x790673a87ac19773537b2553e1dc7c451f659e0f75d1b69a706ad42d25cbdb555555'],
          validation,
        ),
      ).to.throw(
        expectInvalidParam(
          0,
          Validator.TRANSACTION_HASH_ERROR,
          '0x790673a87ac19773537b2553e1dc7c451f659e0f75d1b69a706ad42d25cbdb555555',
        ),
      );
    });

    it('throws an error if transactionHash is NOT 0x prefixed', async () => {
      expect(() =>
        Validator.validateParams(['790673a87ac19773537b2553e1dc7c451f659e0f75d1b69a706ad42d25cbdb55'], validation),
      ).to.throw(
        expectInvalidParam(
          0,
          Validator.TRANSACTION_HASH_ERROR,
          '790673a87ac19773537b2553e1dc7c451f659e0f75d1b69a706ad42d25cbdb55',
        ),
      );
    });

    it('throws an error if transactionHash is other type', async () => {
      expect(() => Validator.validateParams(['string'], validation)).to.throw(
        expectInvalidParam(0, Validator.TRANSACTION_HASH_ERROR, 'string'),
      );
      expect(() => Validator.validateParams([123], validation)).to.throw(
        expectInvalidParam(0, Validator.TRANSACTION_HASH_ERROR, '123'),
      );
      expect(() => Validator.validateParams([[]], validation)).to.throw(
        expectInvalidParam(0, Validator.TRANSACTION_HASH_ERROR, ''),
      );
      expect(() => Validator.validateParams([{}], validation)).to.throw(
        expectInvalidParam(0, Validator.TRANSACTION_HASH_ERROR, '{}'),
      );
    });

    it('does not throw an error if transactionHash is valid', async () => {
      const result = Validator.validateParams(
        ['0x790673a87ac19773537b2553e1dc7c451f659e0f75d1b69a706ad42d25cbdb55'],
        validation,
      );

      expect(result).to.eq(undefined);
    });
  });

  describeTests('tracerType', {
    validCases: [TracerType.CallTracer, TracerType.OpcodeLogger],
    invalidCases: [
      {
        input: undefined,
        error: 'Missing value for required parameter 0',
      },
      {
        input: 'invalidType',
        error: expectInvalidParam(0, Validator.TYPES.tracerType.error, 'invalidType'),
      },
    ],
  });

  describeTests('callTracerConfig', {
    validCases: [{ onlyTopCall: true, unknownParam: true }, { onlyTopCall: true }, {}],
    invalidCases: [
      {
        input: { onlyTopCall: 'invalid' },
        error: expectInvalidParam("'onlyTopCall' for CallTracerConfig", Validator.TYPES.boolean.error, 'invalid'),
      },
    ],
  });

  describeTests('opcodeLoggerConfig', {
    validCases: [
      { enableMemory: true, disableStack: false, disableStorage: true, unknownParam: true },
      { enableMemory: true, disableStack: false, disableStorage: true },
      { enableMemory: true },
      { disableStack: false },
      { disableStorage: true },
      {},
    ],
    invalidCases: [
      {
        input: { enableMemory: 'invalid' },
        error: expectInvalidParam("'enableMemory' for OpcodeLoggerConfig", Validator.TYPES.boolean.error, 'invalid'),
      },
      {
        input: { disableStack: 'invalid' },
        error: expectInvalidParam("'disableStack' for OpcodeLoggerConfig", Validator.TYPES.boolean.error, 'invalid'),
      },
      {
        input: { disableStorage: 'invalid' },
        error: expectInvalidParam("'disableStorage' for OpcodeLoggerConfig", Validator.TYPES.boolean.error, 'invalid'),
      },
    ],
  });

  describeTests('tracerConfig', {
    validCases: [
      // OpcodeLoggerConfig
      { enableMemory: true, disableStack: false, disableStorage: true, unknownParam: true },
      { enableMemory: true, disableStack: false, disableStorage: true },
      { enableMemory: true },
      { disableStack: false },
      { disableStorage: true },
      // CallTracerConfig
      { onlyTopCall: true, unknownParam: true },
      { onlyTopCall: true },
      // Empty object
      {},
    ],
    invalidCases: [
      {
        input: { enableMemory: 'invalid' },
        error: expectInvalidParam("'enableMemory' for OpcodeLoggerConfig", Validator.TYPES.boolean.error, 'invalid'),
      },
      {
        input: { disableStack: 'invalid' },
        error: expectInvalidParam("'disableStack' for OpcodeLoggerConfig", Validator.TYPES.boolean.error, 'invalid'),
      },
      {
        input: { disableStorage: 'invalid' },
        error: expectInvalidParam("'disableStorage' for OpcodeLoggerConfig", Validator.TYPES.boolean.error, 'invalid'),
      },
      {
        input: { onlyTopCall: 'invalid' },
        error: expectInvalidParam("'onlyTopCall' for CallTracerConfig", Validator.TYPES.boolean.error, 'invalid'),
      },
    ],
  });

  describeTests('tracerConfigWrapper', {
    validCases: [
      // CallTracerConfig
      { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: true }, unknownParam: true },
      { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: true } },
      { tracer: TracerType.CallTracer, tracerConfig: {} },
      { tracer: TracerType.CallTracer },
      { tracerConfig: { onlyTopCall: true } },
      // OpcodeLoggerConfig
      {
        tracer: TracerType.OpcodeLogger,
        tracerConfig: { enableMemory: true, disableStack: false, disableStorage: true, unknownParam: true },
      },
      {
        tracer: TracerType.OpcodeLogger,
        tracerConfig: { enableMemory: true, disableStack: false, disableStorage: true },
      },
      { tracer: TracerType.OpcodeLogger, tracerConfig: { enableMemory: true } },
      { tracer: TracerType.OpcodeLogger, tracerConfig: { disableStack: false } },
      { tracer: TracerType.OpcodeLogger, tracerConfig: { disableStorage: true } },
      { tracer: TracerType.OpcodeLogger, tracerConfig: {} },
      { tracer: TracerType.OpcodeLogger },
      { tracerConfig: { enableMemory: true, disableStack: false, disableStorage: true } },
      // Empty object
      {},
    ],
    invalidCases: [
      {
        input: { tracer: 'invalid', tracerConfig: {} },
        error: expectInvalidParam("'tracer' for TracerConfigWrapper", Validator.TYPES.tracerType.error, 'invalid'),
      },
      {
        input: { tracer: TracerType.CallTracer, tracerConfig: { onlyTopCall: 'invalid' } },
        error: expectInvalidParam(
          "'tracerConfig' for TracerConfigWrapper",
          Validator.TYPES.tracerConfig.error,
          JSON.stringify({ onlyTopCall: 'invalid' }),
        ),
      },
      {
        input: { tracer: TracerType.OpcodeLogger, tracerConfig: { enableMemory: 'invalid' } },
        error: expectInvalidParam(
          "'tracerConfig' for TracerConfigWrapper",
          Validator.TYPES.tracerConfig.error,
          JSON.stringify({ enableMemory: 'invalid' }),
        ),
      },
      {
        input: { tracer: TracerType.OpcodeLogger, tracerConfig: { disableStack: 'invalid' } },
        error: expectInvalidParam(
          "'tracerConfig' for TracerConfigWrapper",
          Validator.TYPES.tracerConfig.error,
          JSON.stringify({ disableStack: 'invalid' }),
        ),
      },
      {
        input: { tracer: TracerType.OpcodeLogger, tracerConfig: { disableStorage: 'invalid' } },
        error: expectInvalidParam(
          "'tracerConfig' for TracerConfigWrapper",
          Validator.TYPES.tracerConfig.error,
          JSON.stringify({ disableStorage: 'invalid' }),
        ),
      },
    ],
  });

  describe('Other error cases', async () => {
    it('throws an error if validation type is wrong', async () => {
      const validation = { 0: { type: 'wrongType' } };

      expect(() => Validator.validateParams(['0x4422E9088662'], validation)).to.throw(
        "Error invoking RPC: Missing or unsupported param type 'wrongType'",
      );
    });

    it('throws an error if validation type is missing', async () => {
      const validation = { 0: { type: undefined as unknown as string } };

      expect(() => Validator.validateParams(['0x4422E9088662'], validation)).to.throw(
        "Error invoking RPC: Missing or unsupported param type 'undefined'",
      );
    });

    it('throws an error if validation type is unknown', async () => {
      const validation = { 0: { type: 'unknownType' } };

      expect(() => Validator.validateParams(['0x4422E9088662'], validation)).to.throw(
        "Error invoking RPC: Missing or unsupported param type 'unknownType'",
      );
    });

    it('throws an error if Filter Object param contains unexpected param', async () => {
      const validation = { 0: { type: 'filter' } };

      expect(() => Validator.validateParams([{ formBlock: '0x1' }], validation)).to.throw(
        expectUnknownParam('formBlock', 'FilterObject', 'Unknown parameter'),
      );
    });

    it('does NOT throw an error if Transaction Object param contains unexpected param', async () => {
      const validation = { 0: { type: 'transaction' } };

      expect(() => Validator.validateParams([{ form: '0x1' }], validation)).to.not.throw;
    });

    it('deletes unknown properties of Transaction Object param', async () => {
      const transactionParam = { form: '0x1' };
      const validation = { 0: { type: 'transaction' } };

      Validator.validateParams([transactionParam], validation);
      expect(transactionParam).not.to.haveOwnProperty('form');
    });
  });

  describe('validates validateObject with transaction object', async () => {
    const transactionFilterObject = new TransactionObject({
      from: '0xdd94180d1c8e069fc7e6760d5bf7dee477fe617b',
      gasPrice: '0x0',
      value: '0x0',
      data: null,
    });

    it('returns true when transaction data is null and is nullable is true', async () => {
      const result = Validator.validateObject(transactionFilterObject.object, {
        ...OBJECTS_VALIDATIONS.transaction,
        properties: {
          ...OBJECTS_VALIDATIONS.transaction.properties,
          data: {
            type: 'hex',
            nullable: true,
          },
        },
      });

      expect(result).to.be.true;
    });

    it('throws an error if Transaction Object data param is null and isNullable is false', async () => {
      expect(() =>
        Validator.validateObject(transactionFilterObject.object, {
          ...OBJECTS_VALIDATIONS.transaction,
          properties: {
            ...OBJECTS_VALIDATIONS.transaction.properties,
            data: {
              type: 'hex',
              nullable: false,
            },
          },
        }),
      ).to.throw(expectInvalidObject('data', 'Expected 0x prefixed hexadecimal value', 'TransactionObject', 'null'));
    });
  });

  describe('validates isValidAndNonNullableParam', async () => {
    it('returns false if transaction data is undefined and isnullable is true', async () => {
      expect(Validator.isValidAndNonNullableParam(undefined, true)).to.be.false;
    });

    it('returns false if transaction data is undefined and isnullable is false', async () => {
      expect(Validator.isValidAndNonNullableParam(undefined, false)).to.be.false;
    });

    it('returns false if transaction data is null and isnullable is true', async () => {
      expect(Validator.isValidAndNonNullableParam(null, true)).to.be.false;
    });

    it('returns false if transaction data is null and isnullable is false', async () => {
      expect(Validator.isValidAndNonNullableParam(null, false)).to.be.true;
    });

    it('returns false if transaction data is a valid 0x value and isnullable is false', async () => {
      expect(Validator.isValidAndNonNullableParam('0x', false)).to.be.true;
    });

    it('returns false if transaction data is a valid 0x value and isnullable is true', async () => {
      expect(Validator.isValidAndNonNullableParam('0x', true)).to.be.true;
    });
  });

  describe('validates ethSubscribeLogsParams Object type correctly', async () => {
    it("throws an error if 'address' is null", async () => {
      expect(() => {
        const validatorObject = new Validator.EthSubscribeLogsParamsObject({ address: null });
        validatorObject.validate();
      }).to.throw(
        `Invalid parameter 'address' for EthSubscribeLogsParamsObject: Expected 0x prefixed string representing the address (20 bytes) or an array of addresses, value: null`,
      );
    });

    it("throws an error if 'topics' values are not 0x prefixed", async () => {
      expect(() => {
        const validatorObject = new Validator.EthSubscribeLogsParamsObject({
          address: '0xea4168c4cbb733ec22dea4a4bfc5f74b6fe27816',
          topics: ['NotHEX'],
        });
        validatorObject.validate();
      }).to.throw(
        `Invalid parameter 'topics' for EthSubscribeLogsParamsObject: Expected an array or array of arrays containing ${Constants.HASH_ERROR} of a topic, value: ["NotHEX"]`,
      );
    });

    it("throws an error if 'topics' values are null", async () => {
      expect(() => {
        const validatorObject = new Validator.EthSubscribeLogsParamsObject({
          address: '0xea4168c4cbb733ec22dea4a4bfc5f74b6fe27816',
          topics: null,
        });
        validatorObject.validate();
      }).to.throw(
        `Invalid parameter 'topics' for EthSubscribeLogsParamsObject: Expected an array or array of arrays containing ${Constants.HASH_ERROR} of a topic, value: null`,
      );
    });

    it("does not throw an error if 'topics' values are 0x prefixed and 32 bytes", async () => {
      let errorOccurred = false;
      try {
        const validatorObject = new Validator.EthSubscribeLogsParamsObject({
          address: '0xea4168c4cbb733ec22dea4a4bfc5f74b6fe27816',
          topics: [
            '0xd78a0cb8bb633d06981248b816e7bd33c2a35a6089241d099fa519e361cab902',
            '0xd78a0cb8bb633d06981248b816e7bd33c2a35a6089241d099fa519e361cab902',
          ],
        });
        validatorObject.validate();
      } catch (error) {
        errorOccurred = true;
      }

      expect(errorOccurred).to.be.eq(false);
    });

    it("does not throw an error if 'topics' value is empty array", async () => {
      let errorOccurred = false;
      try {
        const validatorObject = new Validator.EthSubscribeLogsParamsObject({
          address: '0xea4168c4cbb733ec22dea4a4bfc5f74b6fe27816',
          topics: [],
        });
        validatorObject.validate();
      } catch (error) {
        errorOccurred = true;
      }

      expect(errorOccurred).to.be.eq(false);
    });

    it("does not throw an error if 'address' is valid and topics is undefined", async () => {
      let errorOccurred = false;
      try {
        const validatorObject = new Validator.EthSubscribeLogsParamsObject({
          address: '0xea4168c4cbb733ec22dea4a4bfc5f74b6fe27816',
          topics: undefined,
        });
        validatorObject.validate();
      } catch (error) {
        errorOccurred = true;
      }

      expect(errorOccurred).to.be.eq(false);
    });

    it("does not throw an error if 'address' is valid and topics is missing", async () => {
      let errorOccurred = false;
      try {
        const validatorObject = new Validator.EthSubscribeLogsParamsObject({
          address: '0xea4168c4cbb733ec22dea4a4bfc5f74b6fe27816',
        });
        validatorObject.validate();
      } catch (error) {
        errorOccurred = true;
      }

      expect(errorOccurred).to.be.eq(false);
    });

    it("does not throw an error if 'address' is valid array and topics is missing", async () => {
      let errorOccurred = false;
      try {
        const validatorObject = new Validator.EthSubscribeLogsParamsObject({
          address: ['0xea4168c4cbb733ec22dea4a4bfc5f74b6fe27816', '0xea4168c4cbb733ec22dea4a4bfc5f74b6fe27816'],
        });
        validatorObject.validate();
      } catch (error) {
        errorOccurred = true;
      }

      expect(errorOccurred).to.be.eq(false);
    });

    it("does not throw an error if 'address' is valid array and topics is valid array", async () => {
      let errorOccurred = false;
      try {
        const validatorObject = new Validator.EthSubscribeLogsParamsObject({
          address: ['0xea4168c4cbb733ec22dea4a4bfc5f74b6fe27816', '0xea4168c4cbb733ec22dea4a4bfc5f74b6fe27816'],
          topics: [
            '0xd78a0cb8bb633d06981248b816e7bd33c2a35a6089241d099fa519e361cab902',
            '0xd78a0cb8bb633d06981248b816e7bd33c2a35a6089241d099fa519e361cab902',
            '0xd78a0cb8bb633d06981248b816e7bd33c2a35a6089241d099fa519e361cab902',
          ],
        });
        validatorObject.validate();
      } catch (error) {
        errorOccurred = true;
      }

      expect(errorOccurred).to.be.eq(false);
    });
  });

  describe('validates tracerConfig type correctly', () => {
    it('returns true for an empty object', () => {
      expect(Validator.TYPES.tracerConfig.test({})).to.be.true;
    });

    it('returns true for a valid call tracer config', () => {
      expect(Validator.TYPES.tracerConfig.test({ onlyTopCall: true })).to.be.true;
      expect(Validator.TYPES.tracerConfig.test({ onlyTopCall: false })).to.be.true;
    });

    it('returns true for a valid opcode logger config', () => {
      expect(Validator.TYPES.tracerConfig.test({ disableMemory: true })).to.be.true;
      expect(Validator.TYPES.tracerConfig.test({ disableStack: true })).to.be.true;
      expect(Validator.TYPES.tracerConfig.test({ disableStorage: true })).to.be.true;
    });

    it('returns false for an invalid config', () => {
      expect(Validator.TYPES.tracerConfig.test({ invalidKey: true })).to.be.false;
      expect(() => Validator.TYPES.tracerConfig.test({ onlyTopCall: 'true' })).to.throw(
        expectInvalidParam("'onlyTopCall' for CallTracerConfig", Validator.TYPES.boolean.error, 'true'),
      );
      expect(() => Validator.TYPES.tracerConfig.test({ disableMemory: 'true' })).to.throw(
        expectInvalidParam("'disableMemory' for OpcodeLoggerConfig", Validator.TYPES.boolean.error, 'true'),
      );
    });

    it('returns false for non-object values', () => {
      expect(Validator.TYPES.tracerConfig.test(null)).to.be.false;
      expect(Validator.TYPES.tracerConfig.test(undefined)).to.be.false;
      expect(Validator.TYPES.tracerConfig.test(123)).to.be.false;
      expect(Validator.TYPES.tracerConfig.test('string')).to.be.false;
    });
  });

  function describeTests(type: string, tests: { validCases: any[]; invalidCases: { input: any; error: any }[] }) {
    describe(`validates ${type} correctly`, async () => {
      const validation = { 0: { type, required: true } };

      tests.invalidCases.forEach(({ input, error }) => {
        it(`throws an error for input: ${JSON.stringify(input)}`, async () => {
          expect(() => Validator.validateParams([input], validation)).to.throw(error);
        });
      });

      tests.validCases.forEach((input) => {
        it(`does not throw an error for input: ${JSON.stringify(input)}`, async () => {
          expect(() => Validator.validateParams([input], validation)).to.not.throw;
        });
      });
    });
  }
});
