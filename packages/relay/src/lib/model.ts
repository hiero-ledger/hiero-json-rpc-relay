// SPDX-License-Identifier: Apache-2.0

// Used for fake implementation of block history
import { Status, TransactionRecord } from '@hashgraph/sdk';

export class Block {
  public readonly timestamp: string = '0x' + new Date().valueOf().toString(16);
  public number!: string;
  public hash!: string;

  public readonly difficulty: string = '0x1';
  public readonly extraData: string = '';
  public readonly gasLimit: string = '0xe4e1c0';
  public readonly baseFeePerGas: string = '0xa54f4c3c00';
  public readonly gasUsed: string = '0x0';
  public readonly logsBloom: string = '0x0';
  public readonly miner: string = '';
  public readonly mixHash: string = '0x0000000000000000000000000000000000000000000000000000000000000000';
  public readonly nonce: string = '0x0000000000000000';
  public parentHash!: string;
  public readonly receiptsRoot: string = '0x0';
  public readonly sha3Uncles: string = '0x0';
  public readonly size: string = '0x0';
  public readonly stateRoot: string = '0x0';
  public readonly totalDifficulty: string = '0x1';
  public readonly transactions: string[] | Transaction[] = [];
  public readonly transactionsRoot: string = '0x0';
  public readonly uncles: string[] = [];
  public readonly withdrawals: string[] = [];
  public readonly withdrawalsRoot: string = '0x0000000000000000000000000000000000000000000000000000000000000000';

  constructor(args?: any) {
    if (args) {
      this.timestamp = args.timestamp;
      this.number = args.number;
      this.hash = args.hash;
      this.difficulty = args.difficulty;
      this.extraData = args.extraData;
      this.gasLimit = args.gasLimit;
      this.baseFeePerGas = args.baseFeePerGas;
      this.gasUsed = args.gasUsed;
      this.logsBloom = args.logsBloom;
      this.miner = args.miner;
      this.mixHash = args.mixHash;
      this.nonce = args.nonce;
      this.parentHash = args.parentHash;
      this.receiptsRoot = args.receiptsRoot;
      this.sha3Uncles = args.sha3Uncles;
      this.size = args.size;
      this.stateRoot = args.stateRoot;
      this.totalDifficulty = args.totalDifficulty;
      this.transactions = args.transactions;
      this.transactionsRoot = args.transactionsRoot;
      this.uncles = [];
      this.withdrawals = [];
      this.withdrawalsRoot = '0x0000000000000000000000000000000000000000000000000000000000000000';
    }
  }

  /**
   * Converts the "number" field into an actual number type
   */
  public getNum(): number {
    return Number(this.number.substring(2));
  }
}

export class Receipt {
  public readonly transactionHash: string;
  public readonly transactionIndex: string;
  public readonly blockHash: string;
  public readonly blockNumber: string;
  public readonly from: string;
  public readonly to: undefined | string;
  public readonly cumulativeGasUsed: string;
  public readonly gasUsed: string;
  public readonly contractAddress: undefined | string;
  public readonly logs: Log[];
  public readonly logsBloom: string;
  public readonly root: undefined | string;
  public readonly status: undefined | string;
  public readonly effectiveGasPrice: undefined | string;

  constructor(txHash: string, record: TransactionRecord, block: Block) {
    const gasUsed = record.contractFunctionResult == null ? 0 : record.contractFunctionResult.gasUsed;
    const contractAddress =
      record.contractFunctionResult == undefined
        ? undefined
        : '0x' + record.contractFunctionResult.contractId?.toSolidityAddress();

    this.transactionHash = txHash;
    this.transactionIndex = '0x0';
    this.blockNumber = block.number;
    this.blockHash = block.hash;
    this.from = '0x';
    // TODO this.to = record.contractFunctionResult?.contractId;
    this.cumulativeGasUsed = Number(gasUsed).toString(16);
    this.gasUsed = Number(gasUsed).toString(16);
    this.contractAddress = contractAddress;
    this.logs = [];
    this.logsBloom = '';
    this.status = record.receipt.status == Status.Success ? '0x1' : '0x0';
  }
}

export class Transaction {
  public readonly blockHash!: string | null;
  public readonly blockNumber!: string | null;
  public readonly chainId!: string;
  public readonly from!: string;
  public readonly gas!: string;
  public readonly gasPrice!: string;
  public readonly hash!: string;
  public readonly input!: string;
  public readonly nonce!: string;
  public readonly r!: string;
  public readonly s!: string;
  public readonly to!: string | null;
  public readonly transactionIndex!: string | null;
  public readonly type!: string;
  public readonly v: string | null;
  public readonly value!: string;

  constructor(args: any) {
    this.blockHash = args.blockHash;
    this.blockNumber = args.blockNumber;
    this.chainId = args.chainId;
    this.from = args.from;
    this.gas = args.gas;
    this.gasPrice = args.gasPrice;
    this.hash = args.hash;
    this.input = args.input;
    this.nonce = args.nonce;
    this.r = args.r;
    this.s = args.s;
    this.to = args.to;
    this.transactionIndex = args.transactionIndex;
    this.type = args.type;
    this.v = args.v;
    this.value = args.value;
  }
}

export class Transaction2930 extends Transaction {
  public readonly accessList!: AccessListEntry[] | null | [];
  public readonly yParity!: string | null;

  constructor(args: any) {
    super(args);
    this.yParity = args.v;
    this.accessList = args.accessList;
  }
}

export class Transaction1559 extends Transaction2930 {
  public readonly maxPriorityFeePerGas!: string;
  public readonly maxFeePerGas!: string;

  constructor(args: any) {
    super(args);
    this.maxPriorityFeePerGas = args.maxPriorityFeePerGas;
    this.maxFeePerGas = args.maxFeePerGas;
  }
}

export declare class AccessListEntry {
  readonly address: string;
  readonly storageKeys: string[];
}

export class Log {
  public readonly address: string;
  public readonly blockHash: string;
  public readonly blockNumber: string;
  public readonly blockTimestamp: string;
  public readonly data: string;
  public readonly logIndex: string;
  public readonly removed: boolean;
  public readonly topics: string[];
  public readonly transactionHash: string;
  public readonly transactionIndex: string;

  constructor(args: any) {
    this.address = args.address;
    this.blockHash = args.blockHash;
    this.blockNumber = args.blockNumber;
    this.blockTimestamp = args.blockTimestamp;
    this.data = args.data;
    this.logIndex = args.logIndex;
    this.removed = args.removed;
    this.topics = args.topics;
    this.transactionHash = args.transactionHash;
    this.transactionIndex = args.transactionIndex;
  }
}
