// SPDX-License-Identifier: Apache-2.0

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { AbiCoder, keccak256 } from 'ethers';
import { EventEmitter } from 'events';
import { createStubInstance, SinonStub, SinonStubbedInstance, stub } from 'sinon';
import { v4 as uuid } from 'uuid';

import { Eth, JsonRpcError } from '../../../src';
import { numberTo0x } from '../../../src/formatters';
import { SDKClient } from '../../../src/lib/clients';
import constants from '../../../src/lib/constants';
import { predefined } from '../../../src/lib/errors/JsonRpcError';
import { EthImpl } from '../../../src/lib/eth';
import { Precheck } from '../../../src/lib/precheck';
import { IContractCallRequest, IContractCallResponse, RequestDetails } from '../../../src/lib/types';
import { overrideEnvsInMochaDescribe, withOverriddenEnvsInMochaTest } from '../../helpers';
import {
  ACCOUNT_ADDRESS_1,
  DEFAULT_NETWORK_FEES,
  NO_TRANSACTIONS,
  ONE_TINYBAR_IN_WEI_HEX,
  RECEIVER_ADDRESS,
} from './eth-config';
import { generateEthTestEnv } from './eth-helpers';

use(chaiAsPromised);

let sdkClientStub: SinonStubbedInstance<SDKClient>;
let getSdkClientStub: SinonStub<[], SDKClient>;
let ethImplOverridden: Eth;
let eventEmitter: EventEmitter;
const gasTxBaseCost = numberTo0x(constants.TX_BASE_COST);
describe('@ethEstimateGas Estimate Gas spec', async function () {
  this.timeout(10000);
  const { restMock, web3Mock, hapiServiceInstance, ethImpl, cacheService, mirrorNodeInstance, logger } =
    generateEthTestEnv();

  const contractService = ethImpl['contractService'];
  const requestDetails = new RequestDetails({ requestId: 'eth_estimateGasTest', ipAddress: '0.0.0.0' });
  eventEmitter = new EventEmitter();
  async function mockContractCall(
    callData: IContractCallRequest,
    estimate: boolean,
    statusCode: number,
    result: IContractCallResponse,
    requestDetails: RequestDetails,
  ) {
    const formattedData = { ...callData, estimate };
    await contractService['contractCallFormat'](formattedData, requestDetails);
    return web3Mock.onPost('contracts/call', formattedData).reply(statusCode, JSON.stringify(result));
  }

  function mockGetAccount(idOrAliasOrEvmAddress: string, statusCode: number, result: any) {
    return restMock
      .onGet(`accounts/${idOrAliasOrEvmAddress}?transactions=false`)
      .reply(statusCode, JSON.stringify(result));
  }

  const transaction = {
    from: '0x05fba803be258049a27b820088bab1cad2058871',
    data: '0x60806040523480156200001157600080fd5b50604051620019f4380380620019f48339818101604052810190620000379190620001fa565b818181600390816200004a9190620004ca565b5080600490816200005c9190620004ca565b5050505050620005b1565b6000604051905090565b600080fd5b600080fd5b600080fd5b600080fd5b6000601f19601f8301169050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b620000d08262000085565b810181811067ffffffffffffffff82111715620000f257620000f162000096565b5b80604052505',
  };
  const id = uuid();
  const defaultGasOverride = constants.TX_DEFAULT_GAS_DEFAULT + 1;

  overrideEnvsInMochaDescribe({
    ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE: 1,
    TX_DEFAULT_GAS: defaultGasOverride.toString(),
  });

  this.beforeEach(async () => {
    // reset cache and restMock
    await cacheService.clear(requestDetails);
    restMock.reset();
    sdkClientStub = createStubInstance(SDKClient);
    getSdkClientStub = stub(hapiServiceInstance, 'getSDKClient').returns(sdkClientStub);
    ethImplOverridden = new EthImpl(
      hapiServiceInstance,
      mirrorNodeInstance,
      logger,
      '0x12a',
      cacheService,
      eventEmitter,
    );
    restMock.onGet('network/fees').reply(200, JSON.stringify(DEFAULT_NETWORK_FEES));
    restMock.onGet(`accounts/undefined${NO_TRANSACTIONS}`).reply(404);
    mockGetAccount(hapiServiceInstance.getMainClientInstance().operatorAccountId!.toString(), 200, {
      evm_address: ACCOUNT_ADDRESS_1,
    });
  });

  this.afterEach(() => {
    getSdkClientStub.restore();
    restMock.resetHandlers();
  });

  describe('eth_estimateGas with contract call', async function () {});

  it('should eth_estimateGas with transaction.data null does not fail', async function () {
    const callData: IContractCallRequest = {
      from: '0x05fba803be258049a27b820088bab1cad2058871',
      value: '0x0',
      gasPrice: '0x0',
      data: null,
    };
    await mockContractCall(callData, true, 501, { errorMessage: '', statusCode: 501 }, requestDetails);

    const gas = await ethImpl.estimateGas(callData, null, requestDetails);
    expect(gas).to.equal(numberTo0x(constants.TX_DEFAULT_GAS_DEFAULT));
  });

  it('should eth_estimateGas to mirror node for contract call returns 501', async function () {
    const callData: IContractCallRequest = {
      data: '0x608060405234801561001057600080fd5b506040516107893803806107898339818101604052810190610032919061015a565b806000908051906020019061004892919061004f565b50506102f6565b82805461005b90610224565b90600052602060002090601f01602090048101928261007d57600085556100c4565b82601f1061009657805160ff19168380011785556100c4565b828001600101855582156100c4579182015b828111156100c35782518255916020019190600101906100a8565b5b5090506100d191906100d5565b5090565b5b808211156100ee5760008160009055506001016100d6565b5090565b6000610105610100846101c0565b61019b565b90508281526020810184848401111561011d57600080fd5b6101288482856101f1565b509392505050565b600082601f83011261014157600080fd5b81516101518482602086016100f2565b91505092915050565b60006020828403121561016c57600080fd5b600082015167ffffffffffffffff81111561018657600080fd5b61019284828501610130565b91505092915050565b60006101a56101b6565b90506101b18282610256565b919050565b6000604051905090565b600067ffffffffffffffff8211156101db576101da6102b6565b5b6101e4826102e5565b9050602081019050919050565b60005b8381101561020f5780820151818401526020810190506101f4565b8381111561021e576000848401525b50505050565b6000600282049050600182168061023c57607f821691505b602082108114156102505761024f610287565b5b50919050565b61025f826102e5565b810181811067ffffffffffffffff8211171561027e5761027d6102b6565b5b80604052505050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052602260045260246000fd5b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b6000601f19601f8301169050919050565b610484806103056000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c8063a41368621461003b578063cfae321714610057575b600080fd5b6100556004803603810190610050919061022c565b610075565b005b61005f61008f565b60405161006c91906102a6565b60405180910390f35b806000908051906020019061008b929190610121565b5050565b60606000805461009e9061037c565b80601f01602080910402602001604051908101604052809291908181526020018280546100ca9061037c565b80156101175780601f106100ec57610100808354040283529160200191610117565b820191906000526020600020905b8154815290600101906020018083116100fa57829003601f168201915b5050505050905090565b82805461012d9061037c565b90600052602060002090601f01602090048101928261014f5760008555610196565b82601f1061016857805160ff1916838001178555610196565b82800160010185558215610196579182015b8281111561019557825182559160200191906001019061017a565b5b5090506101a391906101a7565b5090565b5b808211156101c05760008160009055506001016101a8565b5090565b60006101d76101d2846102ed565b6102c8565b9050828152602081018484840111156101ef57600080fd5b6101fa84828561033a565b509392505050565b600082601f83011261021357600080fd5b81356102238482602086016101c4565b91505092915050565b60006020828403121561023e57600080fd5b600082013567ffffffffffffffff81111561025857600080fd5b61026484828501610202565b91505092915050565b60006102788261031e565b6102828185610329565b9350610292818560208601610349565b61029b8161043d565b840191505092915050565b600060208201905081810360008301526102c0818461026d565b905092915050565b60006102d26102e3565b90506102de82826103ae565b919050565b6000604051905090565b600067ffffffffffffffff8211156103085761030761040e565b5b6103118261043d565b9050602081019050919050565b600081519050919050565b600082825260208201905092915050565b82818337600083830152505050565b60005b8381101561036757808201518184015260208101905061034c565b83811115610376576000848401525b50505050565b6000600282049050600182168061039457607f821691505b602082108114156103a8576103a76103df565b5b50919050565b6103b78261043d565b810181811067ffffffffffffffff821117156103d6576103d561040e565b5b80604052505050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052602260045260246000fd5b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b6000601f19601f830116905091905056fea264697066735822122070d157c4efbb3fba4a1bde43cbba5b92b69f2fc455a650c0dfb61e9ed3d4bd6364736f6c634300080400330000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000b696e697469616c5f6d7367000000000000000000000000000000000000000000',
      from: '0x81cb089c285e5ee3a7353704fb114955037443af',
      to: RECEIVER_ADDRESS,
    };
    await mockContractCall(callData, true, 501, { errorMessage: '', statusCode: 501 }, requestDetails);

    const gas = await ethImpl.estimateGas(callData, null, requestDetails);
    expect(gas).to.equal(numberTo0x(constants.TX_CONTRACT_CALL_AVERAGE_GAS));
  });

  it('should eth_estimateGas contract call returns workaround response from mirror-node', async function () {
    const callData: IContractCallRequest = {
      data: '0x608060405234801561001057600080fd5b506040516107893803806107898339818101604052810190610032919061015a565b806000908051906020019061004892919061004f565b50506102f6565b82805461005b90610224565b90600052602060002090601f01602090048101928261007d57600085556100c4565b82601f1061009657805160ff19168380011785556100c4565b828001600101855582156100c4579182015b828111156100c35782518255916020019190600101906100a8565b5b5090506100d191906100d5565b5090565b5b808211156100ee5760008160009055506001016100d6565b5090565b6000610105610100846101c0565b61019b565b90508281526020810184848401111561011d57600080fd5b6101288482856101f1565b509392505050565b600082601f83011261014157600080fd5b81516101518482602086016100f2565b91505092915050565b60006020828403121561016c57600080fd5b600082015167ffffffffffffffff81111561018657600080fd5b61019284828501610130565b91505092915050565b60006101a56101b6565b90506101b18282610256565b919050565b6000604051905090565b600067ffffffffffffffff8211156101db576101da6102b6565b5b6101e4826102e5565b9050602081019050919050565b60005b8381101561020f5780820151818401526020810190506101f4565b8381111561021e576000848401525b50505050565b6000600282049050600182168061023c57607f821691505b602082108114156102505761024f610287565b5b50919050565b61025f826102e5565b810181811067ffffffffffffffff8211171561027e5761027d6102b6565b5b80604052505050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052602260045260246000fd5b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b6000601f19601f8301169050919050565b610484806103056000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c8063a41368621461003b578063cfae321714610057575b600080fd5b6100556004803603810190610050919061022c565b610075565b005b61005f61008f565b60405161006c91906102a6565b60405180910390f35b806000908051906020019061008b929190610121565b5050565b60606000805461009e9061037c565b80601f01602080910402602001604051908101604052809291908181526020018280546100ca9061037c565b80156101175780601f106100ec57610100808354040283529160200191610117565b820191906000526020600020905b8154815290600101906020018083116100fa57829003601f168201915b5050505050905090565b82805461012d9061037c565b90600052602060002090601f01602090048101928261014f5760008555610196565b82601f1061016857805160ff1916838001178555610196565b82800160010185558215610196579182015b8281111561019557825182559160200191906001019061017a565b5b5090506101a391906101a7565b5090565b5b808211156101c05760008160009055506001016101a8565b5090565b60006101d76101d2846102ed565b6102c8565b9050828152602081018484840111156101ef57600080fd5b6101fa84828561033a565b509392505050565b600082601f83011261021357600080fd5b81356102238482602086016101c4565b91505092915050565b60006020828403121561023e57600080fd5b600082013567ffffffffffffffff81111561025857600080fd5b61026484828501610202565b91505092915050565b60006102788261031e565b6102828185610329565b9350610292818560208601610349565b61029b8161043d565b840191505092915050565b600060208201905081810360008301526102c0818461026d565b905092915050565b60006102d26102e3565b90506102de82826103ae565b919050565b6000604051905090565b600067ffffffffffffffff8211156103085761030761040e565b5b6103118261043d565b9050602081019050919050565b600081519050919050565b600082825260208201905092915050565b82818337600083830152505050565b60005b8381101561036757808201518184015260208101905061034c565b83811115610376576000848401525b50505050565b6000600282049050600182168061039457607f821691505b602082108114156103a8576103a76103df565b5b50919050565b6103b78261043d565b810181811067ffffffffffffffff821117156103d6576103d561040e565b5b80604052505050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052602260045260246000fd5b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b6000601f19601f830116905091905056fea264697066735822122070d157c4efbb3fba4a1bde43cbba5b92b69f2fc455a650c0dfb61e9ed3d4bd6364736f6c634300080400330000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000b696e697469616c5f6d7367000000000000000000000000000000000000000000',
      from: '0x81cb089c285e5ee3a7353704fb114955037443af',
    };
    await mockContractCall(callData, true, 200, { result: `0x61A80` }, requestDetails);

    const gas = await ethImpl.estimateGas(callData, null, requestDetails);
    expect((gas as string).toLowerCase()).to.equal(numberTo0x(constants.TX_DEFAULT_GAS_DEFAULT).toLowerCase());
  });

  it('should eth_estimateGas contract call with value is converted to tinybars before it is sent to mirror node', async function () {
    const callData: IContractCallRequest = {
      data: '0x608060405234801561001057600080fd5b506040516107893803806107898339818101604052810190610032919061015a565b806000908051906020019061004892919061004f565b50506102f6565b82805461005b90610224565b90600052602060002090601f01602090048101928261007d57600085556100c4565b82601f1061009657805160ff19168380011785556100c4565b828001600101855582156100c4579182015b828111156100c35782518255916020019190600101906100a8565b5b5090506100d191906100d5565b5090565b5b808211156100ee5760008160009055506001016100d6565b5090565b6000610105610100846101c0565b61019b565b90508281526020810184848401111561011d57600080fd5b6101288482856101f1565b509392505050565b600082601f83011261014157600080fd5b81516101518482602086016100f2565b91505092915050565b60006020828403121561016c57600080fd5b600082015167ffffffffffffffff81111561018657600080fd5b61019284828501610130565b91505092915050565b60006101a56101b6565b90506101b18282610256565b919050565b6000604051905090565b600067ffffffffffffffff8211156101db576101da6102b6565b5b6101e4826102e5565b9050602081019050919050565b60005b8381101561020f5780820151818401526020810190506101f4565b8381111561021e576000848401525b50505050565b6000600282049050600182168061023c57607f821691505b602082108114156102505761024f610287565b5b50919050565b61025f826102e5565b810181811067ffffffffffffffff8211171561027e5761027d6102b6565b5b80604052505050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052602260045260246000fd5b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b6000601f19601f8301169050919050565b610484806103056000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c8063a41368621461003b578063cfae321714610057575b600080fd5b6100556004803603810190610050919061022c565b610075565b005b61005f61008f565b60405161006c91906102a6565b60405180910390f35b806000908051906020019061008b929190610121565b5050565b60606000805461009e9061037c565b80601f01602080910402602001604051908101604052809291908181526020018280546100ca9061037c565b80156101175780601f106100ec57610100808354040283529160200191610117565b820191906000526020600020905b8154815290600101906020018083116100fa57829003601f168201915b5050505050905090565b82805461012d9061037c565b90600052602060002090601f01602090048101928261014f5760008555610196565b82601f1061016857805160ff1916838001178555610196565b82800160010185558215610196579182015b8281111561019557825182559160200191906001019061017a565b5b5090506101a391906101a7565b5090565b5b808211156101c05760008160009055506001016101a8565b5090565b60006101d76101d2846102ed565b6102c8565b9050828152602081018484840111156101ef57600080fd5b6101fa84828561033a565b509392505050565b600082601f83011261021357600080fd5b81356102238482602086016101c4565b91505092915050565b60006020828403121561023e57600080fd5b600082013567ffffffffffffffff81111561025857600080fd5b61026484828501610202565b91505092915050565b60006102788261031e565b6102828185610329565b9350610292818560208601610349565b61029b8161043d565b840191505092915050565b600060208201905081810360008301526102c0818461026d565b905092915050565b60006102d26102e3565b90506102de82826103ae565b919050565b6000604051905090565b600067ffffffffffffffff8211156103085761030761040e565b5b6103118261043d565b9050602081019050919050565b600081519050919050565b600082825260208201905092915050565b82818337600083830152505050565b60005b8381101561036757808201518184015260208101905061034c565b83811115610376576000848401525b50505050565b6000600282049050600182168061039457607f821691505b602082108114156103a8576103a76103df565b5b50919050565b6103b78261043d565b810181811067ffffffffffffffff821117156103d6576103d561040e565b5b80604052505050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052602260045260246000fd5b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b6000601f19601f830116905091905056fea264697066735822122070d157c4efbb3fba4a1bde43cbba5b92b69f2fc455a650c0dfb61e9ed3d4bd6364736f6c634300080400330000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000b696e697469616c5f6d7367000000000000000000000000000000000000000000',
      from: '0x81cb089c285e5ee3a7353704fb114955037443af',
      value: 1,
    };
    await mockContractCall(callData, true, 200, { result: `0x61A80` }, requestDetails);

    const gas = await ethImpl.estimateGas({ ...callData, value: ONE_TINYBAR_IN_WEI_HEX }, null, requestDetails);
    expect((gas as string).toLowerCase()).to.equal(numberTo0x(constants.TX_DEFAULT_GAS_DEFAULT).toLowerCase());
  });

  it('should eth_estimateGas for contract deploy returns default', async function () {
    const callData: IContractCallRequest = {
      data: '0x01',
    };
    await mockContractCall(callData, true, 501, { errorMessage: '', statusCode: 501 }, requestDetails);

    const gas = await ethImpl.estimateGas({ data: '0x01' }, null, requestDetails);
    expect(gas).to.equal(numberTo0x(Precheck.transactionIntrinsicGasCost(callData.data!)));
  });

  it('should eth_estimateGas to mirror node for transfer returns 501', async function () {
    const callData: IContractCallRequest = {
      data: '0x',
      from: '0x81cb089c285e5ee3a7353704fb114955037443af',
      to: RECEIVER_ADDRESS,
      value: '0x2540BE400',
    };
    await mockContractCall(callData, true, 501, { errorMessage: '', statusCode: 501 }, requestDetails);
    restMock
      .onGet(`accounts/${RECEIVER_ADDRESS}${NO_TRANSACTIONS}`)
      .reply(200, JSON.stringify({ address: RECEIVER_ADDRESS }));

    const gas = await ethImpl.estimateGas(callData, null, requestDetails);
    expect(gas).to.equal(numberTo0x(constants.TX_BASE_COST));
  });

  it('should eth_estimateGas to mirror node for transfer without value returns 501', async function () {
    const callData: IContractCallRequest = {
      data: '0x',
      from: '0x81cb089c285e5ee3a7353704fb114955037443af',
      to: RECEIVER_ADDRESS,
    };
    await mockContractCall(callData, true, 501, { errorMessage: '', statusCode: 501 }, requestDetails);
    restMock.onGet(`accounts/${RECEIVER_ADDRESS}${NO_TRANSACTIONS}`).reply(200, { address: RECEIVER_ADDRESS });

    const result = await ethImpl.estimateGas(callData, null, requestDetails);
    expect(result).to.not.be.null;
    expect((result as JsonRpcError).code).to.eq(-32602);
  });

  it('should eth_estimateGas transfer to existing account', async function () {
    const callData: IContractCallRequest = {
      to: RECEIVER_ADDRESS,
      value: 10, //in tinybars
    };
    await mockContractCall(callData, true, 501, { errorMessage: '', statusCode: 501 }, requestDetails);
    restMock
      .onGet(`accounts/${RECEIVER_ADDRESS}${NO_TRANSACTIONS}`)
      .reply(200, JSON.stringify({ address: RECEIVER_ADDRESS }));

    const gas = await ethImpl.estimateGas(
      {
        to: RECEIVER_ADDRESS,
        value: 100_000_000_000,
      },
      null,
      requestDetails,
    );
    expect(gas).to.equal(gasTxBaseCost);
  });

  it('should eth_estimateGas transfer to existing cached account', async function () {
    const callData: IContractCallRequest = {
      to: RECEIVER_ADDRESS,
      value: 10, //in tinybars
    };
    await mockContractCall(callData, true, 501, { errorMessage: '', statusCode: 501 }, requestDetails);
    restMock
      .onGet(`accounts/${RECEIVER_ADDRESS}${NO_TRANSACTIONS}`)
      .reply(200, JSON.stringify({ address: RECEIVER_ADDRESS }));

    const gasBeforeCache = await ethImpl.estimateGas(
      {
        to: RECEIVER_ADDRESS,
        value: 100_000_000_000,
      },
      null,
      requestDetails,
    );

    restMock.onGet(`accounts/${RECEIVER_ADDRESS}${NO_TRANSACTIONS}`).reply(404);
    const gasAfterCache = await ethImpl.estimateGas(
      {
        to: RECEIVER_ADDRESS,
        value: 100_000_000_000,
      },
      null,
      requestDetails,
    );

    expect(gasBeforeCache).to.equal(gasTxBaseCost);
    expect(gasAfterCache).to.equal(gasTxBaseCost);
  });

  it('should eth_estimateGas transfer to non existing account', async function () {
    const callData: IContractCallRequest = {
      to: RECEIVER_ADDRESS,
      value: 10, //in tinybars
    };
    await mockContractCall(callData, true, 501, { errorMessage: '', statusCode: 501 }, requestDetails);
    restMock.onGet(`accounts/${RECEIVER_ADDRESS}${NO_TRANSACTIONS}`).reply(404);

    const hollowAccountGasCreation = await ethImpl.estimateGas(
      {
        to: RECEIVER_ADDRESS,
        value: 100_000_000_000,
      },
      null,
      requestDetails,
    );
    const minGasTxHollowAccountCreation = numberTo0x(constants.MIN_TX_HOLLOW_ACCOUNT_CREATION_GAS);
    expect(Number(hollowAccountGasCreation)).to.be.greaterThanOrEqual(Number(minGasTxHollowAccountCreation));
  });

  it('should eth_estimateGas transfer with 0 value', async function () {
    const callData: IContractCallRequest = {
      to: RECEIVER_ADDRESS,
      value: 0, //in tinybars
    };
    await mockContractCall(callData, true, 501, { errorMessage: '', statusCode: 501 }, requestDetails);
    restMock
      .onGet(`accounts/${RECEIVER_ADDRESS}${NO_TRANSACTIONS}`)
      .reply(200, JSON.stringify({ address: RECEIVER_ADDRESS }));
    const gas = await ethImpl.estimateGas(
      {
        to: RECEIVER_ADDRESS,
        value: 0,
      },
      null,
      requestDetails,
    );

    expect(gas).to.equal(gasTxBaseCost);
  });

  it('should eth_estimateGas for contract create with input field and absent data field', async () => {
    const gasEstimation = 1357410;

    const callData: IContractCallRequest = {
      from: '0x81cb089c285e5ee3a7353704fb114955037443af',
      to: null,
      value: '0x0',
      input:
        '0x81cb089c285e5ee3a7353704fb114955037443af85e5ee3a7353704fb114955037443af85e5ee3a7353704fb114955037443af85e5ee3a7353704fb114955037443af',
    };
    await mockContractCall(callData, true, 200, { result: `0x14b662` }, requestDetails);

    const gas = await ethImpl.estimateGas(callData, null, requestDetails);

    expect((gas as string).toLowerCase()).to.equal(numberTo0x(gasEstimation).toLowerCase());
  });

  it('should eth_estimateGas transfer with invalid value', async function () {
    const callData: IContractCallRequest = {
      to: RECEIVER_ADDRESS,
      value: -100_000_000_000, //in tinybars
    };
    await mockContractCall(callData, true, 501, { errorMessage: '', statusCode: 501 }, requestDetails);
    restMock
      .onGet(`accounts/${RECEIVER_ADDRESS}${NO_TRANSACTIONS}`)
      .reply(200, JSON.stringify({ address: RECEIVER_ADDRESS }));
    const result = await ethImpl.estimateGas(
      {
        to: RECEIVER_ADDRESS,
        value: -100_000_000_000,
      },
      null,
      requestDetails,
    );

    expect(result).to.exist;
    expect((result as JsonRpcError).code).to.equal(-32602);
    expect((result as JsonRpcError).message).to.equal(
      `Invalid parameter 0: Invalid 'value' field in transaction param. Value must be greater than or equal to 0`,
    );
  });

  it('should eth_estimateGas empty call returns transfer cost', async function () {
    const callData: IContractCallRequest = {};
    await mockContractCall(callData, true, 501, { errorMessage: '', statusCode: 501 }, requestDetails);

    const gas = await ethImpl.estimateGas({}, null, requestDetails);
    expect(gas).to.equal(numberTo0x(constants.TX_DEFAULT_GAS_DEFAULT));
  });

  it('should eth_estimateGas empty call returns transfer cost with overridden default gas', async function () {
    const callData: IContractCallRequest = {};
    await mockContractCall(callData, true, 200, { result: numberTo0x(defaultGasOverride) }, requestDetails);

    const gas = await ethImplOverridden.estimateGas({}, null, requestDetails);
    expect(gas).to.equal(numberTo0x(defaultGasOverride));
  });

  it('should eth_estimateGas empty input transfer cost', async function () {
    const callData: IContractCallRequest = {
      data: '',
      estimate: true,
    };
    const contractsCallResponse: IContractCallResponse = { errorMessage: '', statusCode: 501 };

    await mockContractCall(callData, true, 501, contractsCallResponse, requestDetails);

    const gas = await ethImpl.estimateGas({ data: '' }, null, requestDetails);
    expect(gas).to.equal(numberTo0x(constants.TX_DEFAULT_GAS_DEFAULT));
  });

  it('should eth_estimateGas empty input transfer cost with overridden default gas', async function () {
    const callData: IContractCallRequest = {
      data: '',
    };
    await mockContractCall(callData, true, 501, { errorMessage: '', statusCode: 501 }, requestDetails);

    const gas = await ethImplOverridden.estimateGas({ data: '' }, null, requestDetails);
    expect(gas).to.equal(numberTo0x(defaultGasOverride));
  });

  it('should eth_estimateGas zero input returns transfer cost', async function () {
    const callData: IContractCallRequest = {
      data: '0x',
      to: RECEIVER_ADDRESS,
      value: '0x1',
    };
    await mockContractCall(callData, true, 501, { errorMessage: '', statusCode: 501 }, requestDetails);
    mockGetAccount(RECEIVER_ADDRESS, 200, { account: '0.0.1234', evm_address: RECEIVER_ADDRESS });

    const gas = await ethImpl.estimateGas(callData, null, requestDetails);
    expect(gas).to.equal(numberTo0x(constants.TX_BASE_COST));
  });

  it('should eth_estimateGas zero input returns transfer cost with overridden default gas', async function () {
    const callData: IContractCallRequest = {
      data: '0x0',
    };
    await mockContractCall(callData, true, 501, { errorMessage: '', statusCode: 501 }, requestDetails);

    const gas = await ethImplOverridden.estimateGas({ data: '0x' }, null, requestDetails);
    expect(gas).to.equal(numberTo0x(defaultGasOverride));
  });

  it('should eth_estimateGas with contract revert and message does not equal executionReverted', async function () {
    const contractCallResult: IContractCallResponse = {
      _status: {
        messages: [
          {
            message: 'data field invalid hexadecimal string',
            detail: '',
            data: '',
          },
        ],
      },
    };
    await mockContractCall(transaction, true, 400, contractCallResult, requestDetails);

    const estimatedGas = await ethImpl.estimateGas(transaction, id, requestDetails);

    expect(estimatedGas).to.equal(numberTo0x(Precheck.transactionIntrinsicGasCost(transaction.data!)));
  });

  withOverriddenEnvsInMochaTest({ ESTIMATE_GAS_THROWS: 'false' }, () => {
    it('should eth_estimateGas with contract revert and message does not equal executionReverted and ESTIMATE_GAS_THROWS is set to false', async function () {
      const originalEstimateGas = contractService.estimateGas;
      contractService.estimateGas = async () => {
        return numberTo0x(Precheck.transactionIntrinsicGasCost(transaction.data!));
      };

      const result = await ethImpl.estimateGas(transaction, id, requestDetails);

      expect(result).to.equal(numberTo0x(Precheck.transactionIntrinsicGasCost(transaction.data!)));

      contractService.estimateGas = originalEstimateGas;
    });
  });

  it('should eth_estimateGas with contract revert and message equals "execution reverted: Invalid number of recipients"', async function () {
    await mockContractCall(
      transaction,
      true,
      400,
      {
        _status: {
          messages: [
            {
              data: '0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000001c496e76616c6964206e756d626572206f6620726563697069656e747300000000',
              detail: 'Invalid number of recipients',
              message: 'CONTRACT_REVERT_EXECUTED',
            },
          ],
        },
      },
      requestDetails,
    );

    const result: any = await ethImpl.estimateGas(transaction, id, requestDetails);

    expect(result.data).to.equal(
      '0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000001c496e76616c6964206e756d626572206f6620726563697069656e747300000000',
    );
    expect(result.message).to.equal('execution reverted: Invalid number of recipients');
  });

  it('should eth_estimateGas with contract revert for contract call and custom contract error', async function () {
    const decodedMessage = 'Some error message';
    const customErrorSignature = keccak256(Buffer.from('CustomError(string)')).slice(0, 10); // 0x8d6ea8be
    const encodedMessage = new AbiCoder().encode(['string'], [decodedMessage]).replace('0x', '');
    const encodedCustomError = customErrorSignature + encodedMessage;

    await mockContractCall(
      transaction,
      true,
      400,
      {
        _status: {
          messages: [
            {
              message: 'CONTRACT_REVERT_EXECUTED',
              detail: decodedMessage,
              data: encodedCustomError,
            },
          ],
        },
      },
      requestDetails,
    );

    const result: any = await ethImpl.estimateGas(transaction, id, requestDetails);

    expect(result.data).to.equal(encodedCustomError);
    expect(result.message).to.equal(`execution reverted: ${decodedMessage}`);
  });

  it('should eth_estimateGas with contract revert for contract call and generic revert error', async function () {
    const decodedMessage = 'Some error message';
    const defaultErrorSignature = keccak256(Buffer.from('Error(string)')).slice(0, 10); // 0x08c379a0
    const encodedMessage = new AbiCoder().encode(['string'], [decodedMessage]).replace('0x', '');
    const encodedGenericError = defaultErrorSignature + encodedMessage;

    await mockContractCall(
      transaction,
      true,
      400,
      {
        _status: {
          messages: [
            {
              message: 'CONTRACT_REVERT_EXECUTED',
              detail: decodedMessage,
              data: encodedGenericError,
            },
          ],
        },
      },
      requestDetails,
    );

    const result: any = await ethImpl.estimateGas(transaction, id, requestDetails);

    expect(result.data).to.equal(encodedGenericError);
    expect(result.message).to.equal(`execution reverted: ${decodedMessage}`);
  });

  it('should eth_estimateGas handles a 501 unimplemented response from the mirror node correctly by returning default gas', async function () {
    await mockContractCall(
      transaction,
      true,
      501,
      {
        _status: {
          messages: [
            {
              message: 'Auto account creation is not supported.',
              detail: '',
              data: '',
            },
          ],
        },
      },
      requestDetails,
    );

    const result: any = await ethImpl.estimateGas({ ...transaction, data: '0x', value: '0x1' }, id, requestDetails);
    expect(result).to.equal(numberTo0x(constants.TX_DEFAULT_GAS_DEFAULT));
  });

  it('should should perform estimateGas precheck', async function () {
    const transaction = {
      from: '0x05fba803be258049a27b820088bab1cad2058871',
      data: '0x',
      value: '0xA186B8E9800',
      gasPrice: '0xF4240',
      gas: '0xd97010',
    };

    await contractService['contractCallFormat'](transaction, requestDetails);
    expect(transaction.value).to.eq(1110);
    expect(transaction.gasPrice).to.eq(1000000);
    expect(transaction.gas).to.eq(14250000);
  });

  it('should handle estimateGas error and return INTERNAL_ERROR', async function () {
    const originalEstimateGas = contractService.estimateGas;
    contractService.estimateGas = async () => {
      return predefined.INTERNAL_ERROR('Test error for estimateGas');
    };

    const result = await ethImpl.estimateGas(transaction, null, requestDetails);

    expect(result).to.be.an('object');
    expect((result as JsonRpcError).code).to.equal(-32603);
    expect((result as JsonRpcError).message).to.contain('Test error for estimateGas');

    contractService.estimateGas = originalEstimateGas;
  });

  it('should handle mirror node response with no gas estimate', async function () {
    const originalEstimateGas = contractService.estimateGas;
    contractService.estimateGas = async () => {
      return predefined.INTERNAL_ERROR('Test error for estimateGas');
    };

    const result = await ethImpl.estimateGas(transaction, null, requestDetails);

    expect(result).to.be.an('object');
    expect((result as JsonRpcError).code).to.equal(-32603);
    expect((result as JsonRpcError).message).to.contain('Test error for estimateGas');

    contractService.estimateGas = originalEstimateGas;
  });

  it('should accepts both input and data fields but copy value of input field to data field', async () => {
    const inputValue = 'input value';
    const dataValue = 'data value';
    const transaction = {
      from: '0x05fba803be258049a27b820088bab1cad2058871',
      input: inputValue,
      data: dataValue,
      value: '0xA186B8E9800',
      gasPrice: '0xF4240',
      gas: '0xd97010',
    };

    await contractService['contractCallFormat'](transaction, requestDetails);
    expect(transaction.data).to.eq(inputValue);
    expect(transaction.data).to.not.eq(dataValue);
    expect(transaction.input).to.be.undefined;
    expect(transaction.value).to.eq(1110);
    expect(transaction.gasPrice).to.eq(1000000);
    expect(transaction.gas).to.eq(14250000);
  });
});
