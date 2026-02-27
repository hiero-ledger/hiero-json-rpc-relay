// SPDX-License-Identifier: Apache-2.0

// Used for fake implementation of block history
import { Status, TransactionRecord } from '@hashgraph/sdk';

/**
 * Represents an Ethereum-compatible block model.
 *
 * This is primarily used for mock / fake block history implementations.
 * Most numeric values are encoded as hex-prefixed strings.
 */
export class Block {
  /** Block timestamp as hex-encoded milliseconds since epoch */
  public readonly timestamp: string = '0x' + new Date().valueOf().toString(16);

  /** Block number (hex string) */
  public number!: string;

  /** Block hash */
  public hash!: string;

  /** Block difficulty (hex string) */
  public readonly difficulty: string = '0x1';

  /** Extra data field */
  public readonly extraData: string = '';

  /** Gas limit for the block (hex string) */
  public readonly gasLimit: string = '0xe4e1c0';

  /** Base fee per gas (EIP-1559) */
  public readonly baseFeePerGas: string = '0xa54f4c3c00';

  /** Total gas used in block (hex string) */
  public readonly gasUsed: string = '0x0';

  /** Logs bloom filter */
  public readonly logsBloom: string = '0x0';

  /** Miner / coinbase address */
  public readonly miner: string = '';

  /** Mix hash */
  public readonly mixHash: string = '0x0000000000000000000000000000000000000000000000000000000000000000';

  /** Block nonce */
  public readonly nonce: string = '0x0000000000000000';

  /** Parent block hash */
  public parentHash!: string;

  /** Receipts trie root */
  public readonly receiptsRoot: string = '0x0';

  /** Uncle hash */
  public readonly sha3Uncles: string = '0x0';

  /** Block size (hex string) */
  public readonly size: string = '0x0';

  /** State trie root */
  public readonly stateRoot: string = '0x0';

  /** Total accumulated difficulty */
  public readonly totalDifficulty: string = '0x1';

  /** Block transactions (either tx hashes or full Transaction objects) */
  public readonly transactions: string[] | Transaction[] = [];

  /** Transactions trie root */
  public readonly transactionsRoot: string = '0x0';

  /** Uncle block hashes */
  public readonly uncles: string[] = [];

  /** Withdrawals list */
  public readonly withdrawals: string[] = [];

  /** Withdrawals trie root */
  public readonly withdrawalsRoot: string = '0x0000000000000000000000000000000000000000000000000000000000000000';

  /**
   * Creates a new Block instance.
   *
   * @param args Optional block-like object to hydrate this model from.
   */
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

/**
 * Represents an Ethereum-compatible transaction receipt.
 *
 * Constructed from a Hedera TransactionRecord and mapped
 * into Ethereum-like receipt structure.
 */
export class Receipt {
  /** Transaction hash */
  public readonly transactionHash: string;

  /** Transaction index within the block (hex string) */
  public readonly transactionIndex: string;

  /** Block hash */
  public readonly blockHash: string;

  /** Block number (hex string) */
  public readonly blockNumber: string;

  /** Sender address */
  public readonly from: string;

  /** Recipient address (if applicable) */
  public readonly to: undefined | string;

  /** Cumulative gas used in the block up to this transaction */
  public readonly cumulativeGasUsed: string;

  /** Gas used by this transaction */
  public readonly gasUsed: string;

  /** Contract address (if contract creation) */
  public readonly contractAddress: undefined | string;

  /** Transaction logs */
  public readonly logs: Log[];

  /** Logs bloom filter */
  public readonly logsBloom: string;

  /** Post-state root (pre-Byzantium) */
  public readonly root: undefined | string;

  /** Execution status (0x1 success, 0x0 failure) */
  public readonly status: undefined | string;

  /** Effective gas price (EIP-1559) */
  public readonly effectiveGasPrice: undefined | string;

  /**
   * Creates a Receipt from Hedera transaction record.
   *
   * @param txHash Transaction hash
   * @param record Hedera TransactionRecord
   * @param block Block containing this transaction
   */
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

/**
 * Base Ethereum transaction model.
 */
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

  /**
   * @param args Transaction-like object used to populate fields
   */
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

/**
 * EIP-2930 transaction (access list transaction).
 */
export class Transaction2930 extends Transaction {
  /** Access list entries */
  public readonly accessList!: AccessListEntry[] | null;

  /** Y parity of signature */
  public readonly yParity!: string | null;

  constructor(args: any) {
    super(args);
    this.yParity = args.v;
    this.accessList = args.accessList;
  }
}

/**
 * EIP-1559 dynamic fee transaction.
 */
export class Transaction1559 extends Transaction2930 {
  /** Max priority fee per gas */
  public readonly maxPriorityFeePerGas!: string;

  /** Max fee per gas */
  public readonly maxFeePerGas!: string;

  constructor(args: any) {
    super(args);
    this.maxPriorityFeePerGas = args.maxPriorityFeePerGas;
    this.maxFeePerGas = args.maxFeePerGas;
  }
}

export class Transaction7702 extends Transaction {
  /** Access list entries (retained for compatibility) */
  public readonly accessList!: AccessListEntry[] | null;

  /** Y parity of signature */
  public readonly yParity!: string | null;

  /** Max priority fee per gas (EIP-1559 field) */
  public readonly maxPriorityFeePerGas!: string;

  /** Max fee per gas (EIP-1559 field) */
  public readonly maxFeePerGas!: string;

  /** Authorization list entries (EIP-7702 specific field) */
  public readonly authorizationList!: AuthorizationListEntry[] | null;

  constructor(args: any) {
    super(args);

    this.yParity = args.v;
    this.accessList = args.accessList;
    this.maxPriorityFeePerGas = args.maxPriorityFeePerGas;
    this.maxFeePerGas = args.maxFeePerGas;
    this.authorizationList = args.authorizationList;
  }
}

/**
 * Access list entry (EIP-2930).
 */
export declare class AccessListEntry {
  /** Contract address */
  readonly address: string;

  /** Storage keys accessed */
  readonly storageKeys: string[];
}

/**
 * Authorization list entry (EIP-7702).
 */
export declare class AuthorizationListEntry {
  /**
   * Chain ID for which the authorization is valid.
   * Hex-encoded string (0x-prefixed).
   */
  readonly chainId: string;

  /**
   * Nonce associated with the authorizing account.
   * Hex-encoded string (0x-prefixed).
   */
  readonly nonce: string;

  /**
   * Authorized account address.
   * 20-byte Ethereum address (0x-prefixed, 40 hex characters).
   */
  readonly address: string;

  /**
   * Signature recovery identifier (y-parity).
   * Hex-encoded string.
   */
  readonly yParity: string;

  /**
   * ECDSA signature parameter `r`.
   * 32-byte hex-encoded value (0x-prefixed).
   */
  readonly r: string;

  /**
   * ECDSA signature parameter `s`.
   * 32-byte hex-encoded value (0x-prefixed).
   */
  readonly s: string;
}

/**
 * Ethereum log entry emitted by a transaction.
 */
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

  /**
   * @param args Log-like object used to populate fields
   */
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
