// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { Hbar, HbarUnit } from '@hashgraph/sdk';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { expect } from 'chai';
import { ethers, Transaction } from 'ethers';
import pino from 'pino';
import { Registry } from 'prom-client';

import { JsonRpcError, predefined } from '../../src';
import { MirrorNodeClient } from '../../src/lib/clients';
import constants from '../../src/lib/constants';
import { Precheck } from '../../src/lib/precheck';
import { CacheService } from '../../src/lib/services/cacheService/cacheService';
import {
  blobVersionedHash,
  contractAddress1,
  expectedError,
  mockData,
  overrideEnvsInMochaDescribe,
  signTransaction,
} from '../helpers';
import { ONE_TINYBAR_IN_WEI_HEX } from './eth/eth-config';

const registry = new Registry();
import { RequestDetails } from '../../src/lib/types';

const logger = pino({ level: 'silent' });
const limitOrderPostFix = '?order=desc&limit=1';
const transactionsPostFix = '?transactions=false';

describe('Precheck', async function () {
  const requestDetails = new RequestDetails({ requestId: 'precheckTest', ipAddress: '0.0.0.0' });
  const txWithMatchingChainId =
    '0x02f87482012a0485a7a358200085a7a3582000832dc6c09400000000000000000000000000000000000003f78502540be40080c001a006f4cd8e6f84b76a05a5c1542a08682c928108ef7163d9c1bf1f3b636b1cd1fba032097cbf2dda17a2dcc40f62c97964d9d930cdce2e8a9df9a8ba023cda28e4ad';
  const parsedTxWithMatchingChainId = ethers.Transaction.from(txWithMatchingChainId);
  const parsedTxGasPrice = 1440000000000;
  const txWithChainId0x0 =
    '0xf86a0385a7a3582000832dc6c09400000000000000000000000000000000000003f78502540be400801ca06750e92db52fa708e27f94f27e0cfb7f5800f9b657180bb2e94c1520cfb1fb6da01bec6045068b6db38b55017bb8b50166699384bc1791fd8331febab0cf629a2a';
  const parsedtxWithChainId0x0 = ethers.Transaction.from(txWithChainId0x0);
  const txWithNonMatchingChainId =
    '0xf86c8085a54f4c3c00832dc6c094000000000000000000000000000000000000042f8502540be40080820306a0fe71ab0077a58d112eecc7f95b9a7563ffdc14a45440cc1b2c698dbb1a687abea063ba3725ae54118f45999f5b53b38ba67b61f2365965784a81b9b47f37b78c10';
  const parsedTxWithNonMatchingChainId = ethers.Transaction.from(txWithNonMatchingChainId);
  const txWithValueMoreThanOneTinyBar =
    '0xf8628080809449858d4445908c12fcf70251d3f4682e8c9c381085174876e800801ba015ec73d3e329c7f5c0228be39bf30758f974d69468847dd507082c89ec453fe2a04124cc1dd6ac07417e7cdbe04cb99d698bddc6ce4d04054dd8978dec3493f3d2';
  const parsedTxWithValueMoreThanOneTinyBar = ethers.Transaction.from(txWithValueMoreThanOneTinyBar);
  const txWithValueLessThanOneTinybar =
    '0xf8618080809449858d4445908c12fcf70251d3f4682e8c9c38108405f5e100801ba08249a7664c9290e6896711059d2ab75b10675b8b2ef7da41f4dd94c99f16f587a00110bc057ae0837da17a6f31f5123977f820921e333cb75fbe342583d278327d';
  const parsedTxWithValueLessThanOneTinybar = ethers.Transaction.from(txWithValueLessThanOneTinybar);
  const txWithValueLessThanOneTinybarAndNotEmptyData =
    '0xf8638080809449858d4445908c12fcf70251d3f4682e8c9c3810830186a0831231231ba0d8d47f572b49be8da9866e1979ea8fb8060f885119aff9d457a77be088f03545a00c9c1266548930924f5f8c11854bcc369bda1449d203c86a15840759b61cdffe';
  const parsedTxWithValueLessThanOneTinybarAndNotEmptyData = ethers.Transaction.from(
    txWithValueLessThanOneTinybarAndNotEmptyData,
  );
  const txWithZeroValue =
    '0xf86380843b9aca00825208940000000000000000000000000000000000000000808025a04e557f2008ff383df9a21919860939f60f4c27b9c845b89021ae2a79be4f6790a002f86d6dcefd2ffec72bf4d427091e7375acb6707e49d99893173cbc03515fd6';
  const parsedTxWithZeroValue = ethers.Transaction.from(txWithZeroValue);

  const defaultGasPrice = 720_000_000_000;
  const defaultGasLimit = 1_000_000;
  const defaultChainId = Number('0x12a');
  const defaultTx = {
    gasLimit: defaultGasLimit,
    gasPrice: defaultGasPrice,
    chainId: defaultChainId,
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
  };

  let precheck: Precheck;
  let mock: MockAdapter;

  this.beforeAll(() => {
    // mock axios
    const instance = axios.create({
      baseURL: 'https://localhost:5551/api/v1',
      responseType: 'json' as const,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 10 * 1000,
    });

    // @ts-ignore
    mock = new MockAdapter(instance, { onNoMatch: 'throwException' });

    // @ts-ignore
    const mirrorNodeInstance = new MirrorNodeClient(
      ConfigService.get('MIRROR_NODE_URL')!,
      logger.child({ name: `mirror-node` }),
      registry,
      new CacheService(logger.child({ name: `cache` }), registry),
      instance,
    );
    precheck = new Precheck(mirrorNodeInstance, logger, '0x12a');
  });

  this.beforeEach(() => {
    // reset mock
    mock.reset();
  });

  describe('value', async function () {
    it('should throw an exception if value is less than 1 tinybar but above 0', async function () {
      let hasError = false;
      try {
        precheck.value(parsedTxWithValueLessThanOneTinybar);
      } catch (e: any) {
        expect(e).to.exist;
        expect(e.code).to.eq(-32602);
        expect(e.message).to.eq("Value can't be non-zero and less than 10_000_000_000 wei which is 1 tinybar");
        hasError = true;
      }

      expect(hasError).to.be.true;
    });

    it('should pass if value is 0', async function () {
      try {
        precheck.value(parsedTxWithZeroValue);
      } catch (e) {
        expect(e).to.not.exist;
      }
    });

    it('should pass if value is more than 1 tinybar', async function () {
      try {
        precheck.value(parsedTxWithValueMoreThanOneTinyBar);
      } catch (e) {
        expect(e).to.not.exist;
      }
    });

    it('should throw an exception if value is less than 1 tinybar, above 0, and data is not empty', async function () {
      let hasError = false;

      try {
        precheck.value(parsedTxWithValueLessThanOneTinybarAndNotEmptyData);
      } catch (e: any) {
        expect(e).to.exist;
        expect(e.code).to.eq(-32602);
        expect(e.message).to.eq("Value can't be non-zero and less than 10_000_000_000 wei which is 1 tinybar");
        hasError = true;
      }
      expect(hasError).to.be.true;
    });

    it('should throw an exception if value is negative', async function () {
      let hasError = false;
      const txWithNegativeValue = parsedTxWithValueLessThanOneTinybar.clone();
      txWithNegativeValue.value = -1;
      try {
        precheck.value(txWithNegativeValue);
      } catch (e: any) {
        expect(e).to.exist;
        expect(e.code).to.eq(-32602);
        expect(e.message).to.eq("Value can't be non-zero and less than 10_000_000_000 wei which is 1 tinybar");
        hasError = true;
      }

      expect(hasError).to.be.true;
    });

    it('should throw an exception if value is negative and more than one tinybar', async function () {
      let hasError = false;
      const txWithNegativeValue = parsedTxWithValueLessThanOneTinybar.clone();
      txWithNegativeValue.value = -100_000_000;
      try {
        precheck.value(txWithNegativeValue);
      } catch (e: any) {
        expect(e).to.exist;
        expect(e.code).to.eq(-32602);
        expect(e.message).to.eq("Value can't be non-zero and less than 10_000_000_000 wei which is 1 tinybar");
        hasError = true;
      }

      expect(hasError).to.be.true;
    });
  });

  describe('chainId', async function () {
    it('should pass for matching chainId', async function () {
      try {
        precheck.chainId(parsedTxWithMatchingChainId, requestDetails);
      } catch (e: any) {
        expect(e).to.not.exist;
      }
    });

    it('should pass when chainId=0x0', async function () {
      try {
        precheck.chainId(parsedtxWithChainId0x0, requestDetails);
      } catch (e: any) {
        expect(e).to.not.exist;
      }
    });

    it('should not pass for non-matching chainId', async function () {
      try {
        precheck.chainId(parsedTxWithNonMatchingChainId, requestDetails);
        expectedError();
      } catch (e: any) {
        expect(e).to.exist;
        expect(e.code).to.eq(-32000);
        expect(e.message).to.eq('ChainId (0x171) not supported. The correct chainId is 0x12a');
      }
    });

    it('Should check if a transaction is an unprotected pre-EIP155 transaction', function () {
      try {
        expect(precheck.isLegacyUnprotectedEtx(parsedtxWithChainId0x0)).to.be.true;
        expect(precheck.isLegacyUnprotectedEtx(parsedTxWithMatchingChainId)).to.be.false;
      } catch (e: any) {
        expect(e).to.not.exist;
      }
    });
  });

  describe('gasLimit', async function () {
    function testFailingGasLimitPrecheck(gasLimits, errorCode) {
      for (const gasLimit of gasLimits) {
        it(`should fail for gasLimit: ${gasLimit}`, async function () {
          const tx = {
            ...defaultTx,
            gasLimit: gasLimit,
          };
          const signed = await signTransaction(tx);
          const parsedTx = ethers.Transaction.from(signed);
          const message =
            gasLimit > constants.MAX_TRANSACTION_FEE_THRESHOLD
              ? `Transaction gas limit '${gasLimit}' exceeds max gas per sec limit '${constants.MAX_TRANSACTION_FEE_THRESHOLD}'`
              : `Transaction gas limit provided '${gasLimit}' is insufficient of intrinsic gas required `;
          try {
            await precheck.gasLimit(parsedTx, requestDetails);
            expectedError();
          } catch (e: any) {
            console.log(e);
            expect(e).to.exist;
            expect(e.code).to.eq(errorCode);
            expect(e.message).to.contain(message);
          }
        });
      }
    }

    function testPassingGasLimitPrecheck(gasLimits) {
      for (const gasLimit of gasLimits) {
        it(`should pass for gasLimit: ${gasLimit}`, async function () {
          const tx = {
            ...defaultTx,
            gasLimit: gasLimit,
          };
          const signed = await signTransaction(tx);
          const parsedTx = ethers.Transaction.from(signed);

          try {
            precheck.gasLimit(parsedTx, requestDetails);
          } catch (e: any) {
            expect(e).to.not.exist;
          }
        });
      }
    }

    const validGasLimits = [60000, 100000, 500000, 1000000, 5000000, 10000000];
    const lowGasLimits = [1, 10, 100, 1000, 10000];
    const highGasLimits = [20000000, 100000000, 999999999999];

    testPassingGasLimitPrecheck(validGasLimits);
    testFailingGasLimitPrecheck(lowGasLimits, -32003);
    testFailingGasLimitPrecheck(highGasLimits, -32005);
  });

  describe('gas price', async function () {
    overrideEnvsInMochaDescribe({ GAS_PRICE_TINY_BAR_BUFFER: 10000000000 }); // 1 tinybar

    it('should pass for gas price gt to required gas price', async function () {
      expect(() => precheck.gasPrice(parsedTxWithMatchingChainId, 10, requestDetails)).to.not.throw;
    });

    it('should pass for gas price equal to required gas price', async function () {
      expect(() => precheck.gasPrice(parsedTxWithMatchingChainId, defaultGasPrice, requestDetails)).to.not.throw;
    });

    it('should recognize if a signed raw transaction is the deterministic deployment transaction', async () => {
      const parsedDeterministicDeploymentTransaction = ethers.Transaction.from(
        constants.DETERMINISTIC_DEPLOYER_TRANSACTION,
      );

      expect(Precheck.isDeterministicDeploymentTransaction(parsedDeterministicDeploymentTransaction)).to.be.true;
    });

    it('Should recognize if a signed raw transaction is NOT the deterministic deployment transaction', async () => {
      expect(Precheck.isDeterministicDeploymentTransaction(parsedtxWithChainId0x0)).to.be.false;
      expect(Precheck.isDeterministicDeploymentTransaction(parsedTxWithMatchingChainId)).to.be.false;
      expect(Precheck.isDeterministicDeploymentTransaction(parsedTxWithNonMatchingChainId)).to.be.false;
    });

    it('should pass for gas price if the transaction is the deterministic deployment transaction', async function () {
      const parsedDeterministicDeploymentTransaction = ethers.Transaction.from(
        constants.DETERMINISTIC_DEPLOYER_TRANSACTION,
      );
      const result = precheck.gasPrice(
        parsedDeterministicDeploymentTransaction,
        100 * constants.TINYBAR_TO_WEIBAR_COEF,
        requestDetails,
      );
      expect(result).to.not.exist;
    });

    it('should not pass for gas price not enough', async function () {
      const minGasPrice = 1000 * constants.TINYBAR_TO_WEIBAR_COEF;
      try {
        precheck.gasPrice(parsedTxWithMatchingChainId, minGasPrice, requestDetails);
        expectedError();
      } catch (e: any) {
        expect(e).to.exist;
        expect(e.code).to.eq(-32009);
        expect(e.message).to.contains(`Gas price `);
        expect(e.message).to.contains(` is below configured minimum gas price '${minGasPrice}`);
      }
    });

    it('should pass for gas price not enough but within buffer', async function () {
      const adjustedGasPrice = parsedTxGasPrice + Number(constants.GAS_PRICE_TINY_BAR_BUFFER);
      precheck.gasPrice(parsedTxWithMatchingChainId, adjustedGasPrice, requestDetails);
    });

    it('should pass for gas price if the transaction has valid gasPrice but null maxFeePerGas and null maxPriorityFeePerGas', async function () {
      const parsedTx = {
        ...parsedTxWithMatchingChainId,
        gasPrice: BigInt(100),
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
      } as Transaction;

      expect(() => precheck.gasPrice(parsedTx, 50, requestDetails)).to.not.throw();
    });

    it('should pass for gas price if the transaction has null gasPrice but valid maxFeePerGas and valid maxPriorityFeePerGas', async function () {
      const parsedTx = {
        ...parsedTxWithMatchingChainId,
        gasPrice: null,
        maxFeePerGas: BigInt(100),
        maxPriorityFeePerGas: BigInt(100),
      } as Transaction;

      expect(() => precheck.gasPrice(parsedTx, 50, requestDetails)).to.not.throw();
    });

    it('should not pass for gas price if the transaction has null gasPrice and null maxFeePerGas and null maxPriorityFeePerGas', async function () {
      const tx = {
        ...parsedTxWithMatchingChainId,
        gasPrice: null,
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
      };
      const signed = await signTransaction(tx);
      const parsedTx = ethers.Transaction.from(signed);
      const minGasPrice = 1000 * constants.TINYBAR_TO_WEIBAR_COEF;

      expect(() => precheck.gasPrice(parsedTx, minGasPrice, requestDetails)).to.throw(
        `Gas price '0' is below configured minimum gas price '${minGasPrice}'`,
      );
    });
  });

  describe('balance', async function () {
    // sending 2 hbars
    const transaction =
      '0x02f876820128078459682f0086018a4c7747008252089443cb701defe8fc6ed04d7bddf949618e3c575fe1881bc16d674ec8000080c001a0b8c604e08c15a7acc8c898a1bbcc41befcd0d120b64041d1086381c7fc2a5339a062eabec286592a7283c90ce90d97f9f8cf9f6c0cef4998022660e7573c046a46';
    const parsedTransaction = ethers.Transaction.from(transaction);
    const accountId = '0.1.2';

    it('should not pass for 1 hbar', async function () {
      const account = {
        account: accountId,
        balance: {
          balance: Hbar.from(1, HbarUnit.Hbar).to(HbarUnit.Tinybar),
        },
      };

      try {
        precheck.balance(parsedTransaction, account, requestDetails);
        expectedError();
      } catch (e: any) {
        expect(e).to.exist;
        expect(e.code).to.eq(-32000);
        expect(e.message).to.eq('Insufficient funds for transfer');
      }
    });

    it('should not pass for no account found', async function () {
      const account = null;

      try {
        precheck.balance(parsedTransaction, account, requestDetails);
        expectedError();
      } catch (e: any) {
        expect(e).to.exist;
        expect(e.code).to.eq(-32001);
        expect(e.message).to.contain('Requested resource not found');
      }
    });

    it('should pass for 10 hbar', async function () {
      const account = {
        account: accountId,
        balance: {
          balance: Hbar.from(10, HbarUnit.Hbar).to(HbarUnit.Tinybar),
        },
      };

      const result = precheck.balance(parsedTransaction, account, requestDetails);
      expect(result).to.not.exist;
    });

    it('should pass for 100 hbar', async function () {
      const account = {
        account: accountId,
        balance: {
          balance: Hbar.from(100, HbarUnit.Hbar).to(HbarUnit.Tinybar),
        },
      };

      const result = precheck.balance(parsedTransaction, account, requestDetails);
      expect(result).to.not.exist;
    });

    it('should pass for 10000 hbar', async function () {
      const account = {
        account: accountId,
        balance: {
          balance: Hbar.from(10_000, HbarUnit.Hbar).to(HbarUnit.Tinybar),
        },
      };

      const result = precheck.balance(parsedTransaction, account, requestDetails);
      expect(result).to.not.exist;
    });

    it('should pass for 100000 hbar', async function () {
      const account = {
        account: accountId,
        balance: {
          balance: Hbar.from(100_000, HbarUnit.Hbar).to(HbarUnit.Tinybar),
        },
      };

      const result = precheck.balance(parsedTransaction, account, requestDetails);
      expect(result).to.not.exist;
    });

    it('should pass for 50_000_000_000 hbar', async function () {
      const account = {
        account: accountId,
        balance: {
          balance: Hbar.from(50_000_000_000, HbarUnit.Hbar).to(HbarUnit.Tinybar),
        },
      };

      const result = precheck.balance(parsedTransaction, account, requestDetails);
      expect(result).to.not.exist;
    });

    it('should calculate balance correctly when transaction has valid gasPrice but null maxFeePerGas and null maxPriorityFeePerGas', async function () {
      const tx = {
        ...parsedTxWithMatchingChainId,
        value: BigInt(1000),
        gasPrice: BigInt(100),
        gasLimit: BigInt(21000),
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
      } as Transaction;

      const account = {
        account: accountId,
        balance: {
          // Set balance higher than value + (gasPrice * gasLimit)
          balance: (BigInt(1000) + BigInt(100) * BigInt(21000) + BigInt(1000)).toString(),
        },
      };

      expect(() => precheck.balance(tx, account, requestDetails)).to.not.throw();
    });

    it('should calculate balance correctly when transaction has null gasPrice but valid maxFeePerGas and maxPriorityFeePerGas', async function () {
      const tx = {
        ...parsedTxWithMatchingChainId,
        value: BigInt(1000),
        gasPrice: null,
        gasLimit: BigInt(21000),
        maxFeePerGas: BigInt(100),
        maxPriorityFeePerGas: BigInt(100),
      } as Transaction;

      const account = {
        account: accountId,
        balance: {
          // Set balance higher than value + ((maxFeePerGas + maxPriorityFeePerGas) * gasLimit)
          balance: (BigInt(1000) + BigInt(200) * BigInt(21000) + BigInt(1000)).toString(),
        },
      };

      expect(() => precheck.balance(tx, account, requestDetails)).to.not.throw();
    });

    it('should still pass when transaction has null gasPrice, null maxFeePerGas, and null maxPriorityFeePerGas', async function () {
      const tx = {
        ...parsedTxWithMatchingChainId,
        value: BigInt(1000),
        gasPrice: null,
        gasLimit: BigInt(21000),
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
      } as Transaction;

      const account = {
        account: accountId,
        balance: {
          balance: BigInt(1000).toString(), // Any balance would fail as txTotalValue calculation would error
        },
      };

      expect(() => precheck.balance(tx, account, requestDetails)).to.not.throw();
    });
  });

  describe('nonce', async function () {
    const defaultNonce = 3;
    const mirrorAccount = {
      ethereum_nonce: defaultNonce,
    };

    it(`should fail for low nonce`, async function () {
      const tx = {
        ...defaultTx,
        nonce: 1,
      };
      const signed = await signTransaction(tx);
      const parsedTx = ethers.Transaction.from(signed);

      mock.onGet(`accounts/${parsedTx.from}${limitOrderPostFix}`).reply(200, JSON.stringify(mirrorAccount));

      try {
        precheck.nonce(parsedTx, mirrorAccount.ethereum_nonce, requestDetails);
        expectedError();
      } catch (e: any) {
        expect(e).to.eql(predefined.NONCE_TOO_LOW(parsedTx.nonce, mirrorAccount.ethereum_nonce));
      }
    });

    it(`should not fail for next nonce`, async function () {
      const tx = {
        ...defaultTx,
        nonce: 4,
      };
      const signed = await signTransaction(tx);
      const parsedTx = ethers.Transaction.from(signed);

      mock.onGet(`accounts/${parsedTx.from}${limitOrderPostFix}`).reply(200, JSON.stringify(mirrorAccount));

      precheck.nonce(parsedTx, mirrorAccount.ethereum_nonce, requestDetails);
    });
  });

  describe('account', async function () {
    let parsedTx: Transaction;
    let mirrorAccount: any;
    const defaultNonce: number = 3;

    before(async () => {
      const wallet = ethers.Wallet.createRandom();
      const signed = await wallet.signTransaction({ ...defaultTx, from: wallet.address, nonce: defaultNonce });
      parsedTx = ethers.Transaction.from(signed);
      mirrorAccount = {
        evm_address: parsedTx.from,
        ethereum_nonce: defaultNonce,
      };
    });

    it(`should fail for missing account`, async function () {
      mock.onGet(`accounts/${parsedTx.from}${transactionsPostFix}`).reply(404, JSON.stringify(mockData.notFound));
      try {
        await precheck.verifyAccount(parsedTx, requestDetails);
        expectedError();
      } catch (e: any) {
        expect(e).to.exist;
        expect(e.code).to.eq(-32001);
        expect(e.message).to.contain(parsedTx.from);
      }
    });

    it(`should not fail for matched account`, async function () {
      mock.onGet(`accounts/${parsedTx.from}${transactionsPostFix}`).reply(200, JSON.stringify(mirrorAccount));
      const account = await precheck.verifyAccount(parsedTx, requestDetails);

      expect(account.ethereum_nonce).to.eq(defaultNonce);
    });
  });

  describe('IntrinsicGasCost', function () {
    const smallestContractCreate =
      '6080604052348015600f57600080fd5b50603f80601d6000396000f3fe6080604052600080fdfea26469706673582212209c06253b6069b4e1f720945c020dc1c7b3d74b850eba35ac8b6fb407eff7ca7364736f6c63430008120033';
    const greeterContractCreate =
      '0x60806040523480156200001157600080fd5b5060405162000cd838038062000cd883398181016040528101906200003791906200021c565b8060009081620000489190620004b8565b507fad181ee258ff92d26bf7ed2e6b571ef1cba3afc45f028b863b0f02adaffc2f06816040516200007a9190620005f1565b60405180910390a15062000615565b6000604051905090565b600080fd5b600080fd5b600080fd5b600080fd5b6000601f19601f8301169050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b620000f282620000a7565b810181811067ffffffffffffffff82111715620001145762000113620000b8565b5b80604052505050565b60006200012962000089565b9050620001378282620000e7565b919050565b600067ffffffffffffffff8211156200015a5762000159620000b8565b5b6200016582620000a7565b9050602081019050919050565b60005b838110156200019257808201518184015260208101905062000175565b60008484015250505050565b6000620001b5620001af846200013c565b6200011d565b905082815260208101848484011115620001d457620001d3620000a2565b5b620001e184828562000172565b509392505050565b600082601f8301126200020157620002006200009d565b5b8151620002138482602086016200019e565b91505092915050565b60006020828403121562000235576200023462000093565b5b600082015167ffffffffffffffff81111562000256576200025562000098565b5b6200026484828501620001e9565b91505092915050565b600081519050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052602260045260246000fd5b60006002820490506001821680620002c057607f821691505b602082108103620002d657620002d562000278565b5b50919050565b60008190508160005260206000209050919050565b60006020601f8301049050919050565b600082821b905092915050565b600060088302620003407fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff8262000301565b6200034c868362000301565b95508019841693508086168417925050509392505050565b6000819050919050565b6000819050919050565b600062000399620003936200038d8462000364565b6200036e565b62000364565b9050919050565b6000819050919050565b620003b58362000378565b620003cd620003c482620003a0565b8484546200030e565b825550505050565b600090565b620003e4620003d5565b620003f1818484620003aa565b505050565b5b8181101562000419576200040d600082620003da565b600181019050620003f7565b5050565b601f82111562000468576200043281620002dc565b6200043d84620002f1565b810160208510156200044d578190505b620004656200045c85620002f1565b830182620003f6565b50505b505050565b600082821c905092915050565b60006200048d600019846008026200046d565b1980831691505092915050565b6000620004a883836200047a565b9150826002028217905092915050565b620004c3826200026d565b67ffffffffffffffff811115620004df57620004de620000b8565b5b620004eb8254620002a7565b620004f88282856200041d565b600060209050601f8311600181146200053057600084156200051b578287015190505b6200052785826200049a565b86555062000597565b601f1984166200054086620002dc565b60005b828110156200056a5784890151825560018201915060208501945060208101905062000543565b868310156200058a578489015162000586601f8916826200047a565b8355505b6001600288020188555050505b505050505050565b600082825260208201905092915050565b6000620005bd826200026d565b620005c981856200059f565b9350620005db81856020860162000172565b620005e681620000a7565b840191505092915050565b600060208201905081810360008301526200060d8184620005b0565b905092915050565b6106b380620006256000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c8063a41368621461003b578063cfae321714610057575b600080fd5b610055600480360381019061005091906102ab565b610075565b005b61005f6100bf565b60405161006c9190610373565b60405180910390f35b806000908161008491906105ab565b507fad181ee258ff92d26bf7ed2e6b571ef1cba3afc45f028b863b0f02adaffc2f06816040516100b49190610373565b60405180910390a150565b6060600080546100ce906103c4565b80601f01602080910402602001604051908101604052809291908181526020018280546100fa906103c4565b80156101475780601f1061011c57610100808354040283529160200191610147565b820191906000526020600020905b81548152906001019060200180831161012a57829003601f168201915b5050505050905090565b6000604051905090565b600080fd5b600080fd5b600080fd5b600080fd5b6000601f19601f8301169050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b6101b88261016f565b810181811067ffffffffffffffff821117156101d7576101d6610180565b5b80604052505050565b60006101ea610151565b90506101f682826101af565b919050565b600067ffffffffffffffff82111561021657610215610180565b5b61021f8261016f565b9050602081019050919050565b82818337600083830152505050565b600061024e610249846101fb565b6101e0565b90508281526020810184848401111561026a5761026961016a565b5b61027584828561022c565b509392505050565b600082601f83011261029257610291610165565b5b81356102a284826020860161023b565b91505092915050565b6000602082840312156102c1576102c061015b565b5b600082013567ffffffffffffffff8111156102df576102de610160565b5b6102eb8482850161027d565b91505092915050565b600081519050919050565b600082825260208201905092915050565b60005b8381101561032e578082015181840152602081019050610313565b60008484015250505050565b6000610345826102f4565b61034f81856102ff565b935061035f818560208601610310565b6103688161016f565b840191505092915050565b6000602082019050818103600083015261038d818461033a565b905092915050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052602260045260246000fd5b600060028204905060018216806103dc57607f821691505b6020821081036103ef576103ee610395565b5b50919050565b60008190508160005260206000209050919050565b60006020601f8301049050919050565b600082821b905092915050565b6000600883026104577fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff8261041a565b610461868361041a565b95508019841693508086168417925050509392505050565b6000819050919050565b6000819050919050565b60006104a86104a361049e84610479565b610483565b610479565b9050919050565b6000819050919050565b6104c28361048d565b6104d66104ce826104af565b848454610427565b825550505050565b600090565b6104eb6104de565b6104f68184846104b9565b505050565b5b8181101561051a5761050f6000826104e3565b6001810190506104fc565b5050565b601f82111561055f57610530816103f5565b6105398461040a565b81016020851015610548578190505b61055c6105548561040a565b8301826104fb565b50505b505050565b600082821c905092915050565b600061058260001984600802610564565b1980831691505092915050565b600061059b8383610571565b9150826002028217905092915050565b6105b4826102f4565b67ffffffffffffffff8111156105cd576105cc610180565b5b6105d782546103c4565b6105e282828561051e565b600060209050601f8311600181146106155760008415610603578287015190505b61060d858261058f565b865550610675565b601f198416610623866103f5565b60005b8281101561064b57848901518255600182019150602085019450602081019050610626565b868310156106685784890151610664601f891682610571565b8355505b6001600288020188555050505b50505050505056fea26469706673582212202e4941b4eb5848aeea7ed678fca96e1f51e4544a7915f9a57407226029d5fba664736f6c63430008120033000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000016100000000000000000000000000000000000000000000000000000000000000';
    const contractCall = '0xcfae3217';
    const transfer = '0x';
    const invalidTx = '0x60806040523480156200001157600080fd5b';
    it('should be able to calculate small contract create', function () {
      // This number represents the estimation for mirror node web3 module
      // Can be fetched by using: curl -X POST --data '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"from":"0x...","data":<greeterContractCreate>},"latest"]}'
      const mirrorNodeEstimation = 60364;
      // This number represents the difference between the actual gas returned from the mirror node and the minimal required for deployment of this contract based only on the data field.
      const gasDifferenceFromOtherFactors = 37964;
      // @ts-ignore
      const intrinsicGasCost = Precheck.transactionIntrinsicGasCost(smallestContractCreate);
      expect(intrinsicGasCost).to.be.equal(mirrorNodeEstimation - gasDifferenceFromOtherFactors);
      expect(intrinsicGasCost).to.be.greaterThan(constants.TX_BASE_COST);
    });

    it('should be able to calculate normal contract create', function () {
      // This number represents the estimation for mirror node web3 module
      // Can be fetched by using: curl -X POST --data '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"from":"0x...","data":<greeterContractCreate>},"latest"]}'
      const mirrorNodeEstimation = 86351;
      // This number represents the difference between the actual gas returned from the mirror node and the minimal required for deployment of this contract based only on the data field.
      const gasDifferenceFromOtherFactors = 16739;
      // @ts-ignore
      const intrinsicGasCost = Precheck.transactionIntrinsicGasCost(greeterContractCreate);
      expect(intrinsicGasCost).to.be.equal(mirrorNodeEstimation - gasDifferenceFromOtherFactors);
      expect(intrinsicGasCost).to.be.greaterThan(constants.TX_BASE_COST);
    });

    it('should be able to calculate contract call', function () {
      // @ts-ignore
      const intrinsicGasCost = Precheck.transactionIntrinsicGasCost(contractCall);
      expect(intrinsicGasCost).to.be.greaterThan(constants.TX_BASE_COST);
    });

    it('should be able to calucate tx without starting 0x', function () {
      const contractCallTrimmed = contractCall.replace('0x', '');
      // @ts-ignore
      const intrinsicGasCost = Precheck.transactionIntrinsicGasCost(contractCallTrimmed);
      expect(intrinsicGasCost).to.be.greaterThan(constants.TX_BASE_COST);
    });

    it('should be able to able to calculate transfer', function () {
      // @ts-ignore
      const intrinsicGasCost = Precheck.transactionIntrinsicGasCost(transfer);
      expect(intrinsicGasCost).to.be.equal(constants.TX_BASE_COST);
    });

    it('should be able to calculate for odd length tx', function () {
      // @ts-ignore
      const intrinsicGasCost = Precheck.transactionIntrinsicGasCost(invalidTx);
      expect(intrinsicGasCost).to.be.greaterThan(constants.TX_BASE_COST);
    });
  });

  describe('hexToBytes', async function () {
    it('should convert a hex string to bytes', () => {
      const hexString = 'aabbccddeeff';
      const result = precheck.hexToBytes(hexString);

      expect(Array.from(result)).to.deep.equal([170, 187, 204, 221, 238, 255]);
    });

    it('should fail if passed 0x', () => {
      const hexString = '0x';
      let error;
      try {
        precheck.hexToBytes(hexString);
      } catch (e) {
        error = e;
      }
      expect(error).to.be.an.instanceOf(JsonRpcError);
      expect(error.message).to.equal('Error invoking RPC: Hex cannot be 0x');
      expect(error.code).to.equal(-32603);
    });

    it('should fail if passed empty string', () => {
      let error;
      try {
        precheck.hexToBytes('');
      } catch (e) {
        error = e;
      }
      expect(error).to.be.an.instanceOf(JsonRpcError);
      expect(error.message).to.equal('Error invoking RPC: Passed hex an empty string');
      expect(error.code).to.equal(-32603);
    });
  });

  describe('transactionType', async function () {
    const defaultTx = {
      value: ONE_TINYBAR_IN_WEI_HEX,
      gasPrice: defaultGasPrice,
      gasLimit: defaultGasLimit,
      chainId: defaultChainId,
      nonce: 5,
      to: contractAddress1,
    };

    it('should accept legacy transactions', async () => {
      const signedLegacy = await signTransaction(defaultTx);
      expect(() => precheck.transactionType(ethers.Transaction.from(signedLegacy), requestDetails)).not.to.throw;
    });

    it('should accept London transactions', async () => {
      const signedLondon = await signTransaction({
        ...defaultTx,
        type: 2,
        maxPriorityFeePerGas: defaultGasPrice,
        maxFeePerGas: defaultGasPrice,
      });
      expect(() => precheck.transactionType(ethers.Transaction.from(signedLondon), requestDetails)).not.to.throw;
    });

    it('should reject Cancun transactions', async () => {
      let error;
      try {
        const signedCancun = await signTransaction({
          ...defaultTx,
          type: 3,
          maxFeePerBlobGas: defaultGasPrice,
          blobVersionedHashes: [blobVersionedHash],
        });
        precheck.transactionType(ethers.Transaction.from(signedCancun), requestDetails);
      } catch (e) {
        error = e;
      }
      expect(error).to.be.an.instanceOf(JsonRpcError);
      expect(error.message).to.equal(predefined.UNSUPPORTED_TRANSACTION_TYPE.message);
      expect(error.code).to.equal(predefined.UNSUPPORTED_TRANSACTION_TYPE.code);
    });
  });

  describe('receiverAccount', async function () {
    let parsedTx: Transaction;
    let mirrorAccountTo: any;
    const defaultNonce: number = 4;
    const toAddress = ethers.Wallet.createRandom().address;

    before(async () => {
      const wallet = ethers.Wallet.createRandom();
      const signed = await wallet.signTransaction({
        ...defaultTx,
        from: wallet.address,
        to: toAddress,
        nonce: defaultNonce,
      });

      parsedTx = ethers.Transaction.from(signed);
    });

    it('should fail with signature required error', async function () {
      mirrorAccountTo = {
        receiver_sig_required: true,
      };

      mock.onGet(`accounts/${parsedTx.to}${transactionsPostFix}`).reply(200, JSON.stringify(mirrorAccountTo));

      try {
        await precheck.receiverAccount(parsedTx, requestDetails);
        expectedError();
      } catch (e: any) {
        expect(e).to.exist;
        expect(e.code).to.eq(-32000);
        expect(e).to.eql(predefined.RECEIVER_SIGNATURE_ENABLED);
      }
    });

    it('should accept check if signature required is set to false', async function () {
      mirrorAccountTo = {
        receiver_sig_required: false,
      };

      mock.onGet(`accounts/${parsedTx.to}${transactionsPostFix}`).reply(200, JSON.stringify(mirrorAccountTo));

      expect(async () => await precheck.receiverAccount(parsedTx, requestDetails)).not.to.throw;
    });
  });
});
