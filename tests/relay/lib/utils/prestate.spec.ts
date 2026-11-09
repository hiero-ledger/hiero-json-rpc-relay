// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import type {
  IPrestateAccountTrace,
  IPrestateResponse,
} from '../../../../src/relay/lib/clients/models/IPrestateResponse';
import type { EntityTraceState, EntityTraceStateMap, PrestateDiffResult } from '../../../../src/relay/lib/types';
import {
  applyPrestateDiffConfig,
  applyPrestateTracerConfig,
  mapPrestateDiffResponse,
  mapPrestateResponse,
} from '../../../../src/relay/lib/utils/prestate';

describe('mapPrestateResponse', function () {
  const contractAddress = '0x305a8e76ac38fc088132fb780b2171950ff023f7';
  const accountAddress = '0x00000000000000000000000000000000000003f6';
  const slot = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const value = '0x0000000000000000000000000000000000000000000000000000000000000024';

  const contractTrace: IPrestateAccountTrace = {
    address: contractAddress,
    balance: '0xe8d4a51000',
    code: '0x6080604052',
    nonce: 1,
    storage: { [slot]: value },
  };

  const accountTrace: IPrestateAccountTrace = {
    address: accountAddress,
    balance: '0x15d3ef79800',
    code: null,
    nonce: 7,
    storage: {},
  };

  it('keys the account traces by address', function () {
    const result = mapPrestateResponse({ pre: [contractTrace, accountTrace] });

    expect(Object.keys(result)).to.have.members([contractAddress, accountAddress]);
    expect(result[contractAddress]).to.deep.equal({
      balance: '0xe8d4a51000',
      nonce: 1,
      code: '0x6080604052',
      storage: { [slot]: value },
    });
  });

  it('passes the balance through unchanged', function () {
    const result = mapPrestateResponse({ pre: [contractTrace] });

    expect(result[contractAddress].balance).to.equal(contractTrace.balance);
  });

  // The mirror node leaves `code` unset for accounts rather than sending an empty bytecode.
  it('restores an absent code to 0x', function () {
    const result = mapPrestateResponse({ pre: [accountTrace] });

    expect(result[accountAddress].code).to.equal('0x');
  });

  it('defaults an absent nonce to 0', function () {
    const result = mapPrestateResponse({ pre: [{ ...accountTrace, nonce: null }] });

    expect(result[accountAddress].nonce).to.equal(0);
  });

  it('defaults absent storage to an empty object', function () {
    const { storage: _storage, ...withoutStorage } = accountTrace;

    const result = mapPrestateResponse({ pre: [withoutStorage as IPrestateAccountTrace] });

    expect(result[accountAddress].storage).to.deep.equal({});
  });

  // A checksummed key would silently break every consumer looking an address up.
  it('lowercases the address key', function () {
    const checksummed = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

    const result = mapPrestateResponse({ pre: [{ ...accountTrace, address: checksummed }] });

    expect(Object.keys(result)).to.deep.equal([checksummed.toLowerCase()]);
  });

  it('returns an empty map for an empty or missing pre array', function () {
    expect(mapPrestateResponse({ pre: [] })).to.deep.equal({});
    expect(mapPrestateResponse({} as IPrestateResponse)).to.deep.equal({});
  });

  it('skips entries without an address', function () {
    const result = mapPrestateResponse({ pre: [{ ...accountTrace, address: '' }, contractTrace] });

    expect(Object.keys(result)).to.deep.equal([contractAddress]);
  });

  it('keeps the last entry when an address repeats', function () {
    const duplicate = { ...contractTrace, nonce: 9 };

    const result = mapPrestateResponse({ pre: [contractTrace, duplicate] });

    expect(Object.keys(result)).to.have.lengthOf(1);
    expect(result[contractAddress].nonce).to.equal(9);
  });
});

describe('applyPrestateTracerConfig', function () {
  const contractAddress = '0x305a8e76ac38fc088132fb780b2171950ff023f7';
  const accountAddress = '0x00000000000000000000000000000000000003f6';
  const emptyAddress = '0x00000000000000000000000000000000000004d2';
  const slot = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const value = '0x0000000000000000000000000000000000000000000000000000000000000024';

  const contract: EntityTraceState = {
    balance: '0xe8d4a51000',
    nonce: 1,
    code: '0x6080604052',
    storage: { [slot]: value },
  };
  const account: EntityTraceState = { balance: '0x15d3ef79800', nonce: 7, code: '0x', storage: {} };
  const empty: EntityTraceState = { balance: '0x0', nonce: 0, code: '0x', storage: {} };

  const prestate: EntityTraceStateMap = {
    [contractAddress]: contract,
    [accountAddress]: account,
    [emptyAddress]: empty,
  };

  it('keeps every account unchanged by default', function () {
    const result = applyPrestateTracerConfig(prestate);

    expect(result).to.deep.equal(prestate);
  });

  it('drops empty accounts with includeEmpty false', function () {
    const result = applyPrestateTracerConfig(prestate, { includeEmpty: false });

    expect(result).to.deep.equal({ [contractAddress]: contract, [accountAddress]: account });
  });

  it('keeps empty accounts with includeEmpty true', function () {
    const result = applyPrestateTracerConfig(prestate, { includeEmpty: true });

    expect(result).to.deep.equal(prestate);
  });

  it('omits the code of every account with disableCode', function () {
    const result = applyPrestateTracerConfig(prestate, { disableCode: true });

    expect(result).to.deep.equal({
      [contractAddress]: { balance: '0xe8d4a51000', nonce: 1, storage: { [slot]: value } },
      [accountAddress]: { balance: '0x15d3ef79800', nonce: 7, storage: {} },
      [emptyAddress]: { balance: '0x0', nonce: 0, storage: {} },
    });
  });

  it('omits the storage of every account with disableStorage', function () {
    const result = applyPrestateTracerConfig(prestate, { disableStorage: true });

    expect(result).to.deep.equal({
      [contractAddress]: { balance: '0xe8d4a51000', nonce: 1, code: '0x6080604052' },
      [accountAddress]: { balance: '0x15d3ef79800', nonce: 7, code: '0x' },
      [emptyAddress]: { balance: '0x0', nonce: 0, code: '0x' },
    });
  });

  it('applies all options together', function () {
    const result = applyPrestateTracerConfig(prestate, { disableCode: true, disableStorage: true, includeEmpty: true });

    expect(result).to.deep.equal({
      [contractAddress]: { balance: '0xe8d4a51000', nonce: 1 },
      [accountAddress]: { balance: '0x15d3ef79800', nonce: 7 },
      [emptyAddress]: { balance: '0x0', nonce: 0 },
    });
  });

  it('checks emptiness before disableCode strips the code', function () {
    const legacyContract = { balance: '0x0', nonce: 0, code: '0x6080604052', storage: {} };

    const tracerConfig = { disableCode: true, includeEmpty: false };

    const result = applyPrestateTracerConfig({ [contractAddress]: legacyContract }, tracerConfig);

    expect(result).to.deep.equal({ [contractAddress]: { balance: '0x0', nonce: 0, storage: {} } });
  });

  it('does not modify its input', function () {
    const input = structuredClone(prestate);

    applyPrestateTracerConfig(input, { disableCode: true, disableStorage: true });

    expect(input).to.deep.equal(prestate);
  });
});

describe('mapPrestateDiffResponse', function () {
  const contractAddress = '0x305a8e76ac38fc088132fb780b2171950ff023f7';
  const senderAddress = '0x00000000000000000000000000000000000003f6';
  const createdAddress = '0x00000000000000000000000000000000000004d2';
  const changedSlot = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const readSlot = '0x0000000000000000000000000000000000000000000000000000000000000002';
  const clearedSlot = '0x0000000000000000000000000000000000000000000000000000000000000003';
  const zero = '0x0000000000000000000000000000000000000000000000000000000000000000';
  const one = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const seven = '0x0000000000000000000000000000000000000000000000000000000000000007';

  const contractPre: IPrestateAccountTrace = {
    address: contractAddress,
    balance: '0x0',
    code: '0x6080604052',
    nonce: 1,
    storage: { [changedSlot]: one, [readSlot]: one, [clearedSlot]: one },
  };

  const senderPre: IPrestateAccountTrace = {
    address: senderAddress,
    balance: '0x64',
    code: null,
    nonce: 4,
    storage: {},
  };

  const unchanged = { balance: null, code: null, nonce: null, storage: null };

  it('keys both sides by lowercase address and leaves unchanged fields out of post', function () {
    const upperSender = senderAddress.toUpperCase().replace('0X', '0x');
    const response: IPrestateResponse = {
      pre: [{ ...senderPre, address: upperSender }],
      post: [{ ...unchanged, address: upperSender, balance: '0x32', nonce: 5 }],
    };

    const result = mapPrestateDiffResponse(response);

    expect(result.pre).to.deep.equal({ [senderAddress]: { balance: '0x64', nonce: 4, code: '0x', storage: {} } });
    expect(result.post).to.deep.equal({ [senderAddress]: { balance: '0x32', nonce: 5 } });
  });

  it('shows a changed slot with its old value in pre and its new value in post', function () {
    const response: IPrestateResponse = {
      pre: [contractPre],
      post: [{ ...unchanged, address: contractAddress, storage: { [changedSlot]: seven } }],
    };

    const result = mapPrestateDiffResponse(response);

    expect(result.pre[contractAddress].storage).to.deep.equal({ [changedSlot]: one });
    expect(result.post[contractAddress]).to.deep.equal({ storage: { [changedSlot]: seven } });
  });

  it('leaves a slot that did not change out of pre', function () {
    const response: IPrestateResponse = {
      pre: [contractPre],
      post: [{ ...unchanged, address: contractAddress, storage: { [changedSlot]: seven } }],
    };

    const result = mapPrestateDiffResponse(response);

    expect(result.pre[contractAddress].storage).to.not.have.property(readSlot);
  });

  it('shows a slot written to zero in pre only', function () {
    const response: IPrestateResponse = {
      pre: [contractPre],
      post: [{ ...unchanged, address: contractAddress, storage: { [clearedSlot]: zero } }],
    };

    const result = mapPrestateDiffResponse(response);

    expect(result.pre[contractAddress].storage).to.deep.equal({ [clearedSlot]: one });
    expect(result.post[contractAddress]).to.deep.equal({});
  });

  it('keeps an account created by the transaction in post only', function () {
    const created = {
      address: createdAddress,
      balance: '0x0',
      code: '0x6080',
      nonce: 1,
      storage: { [changedSlot]: one },
    };

    const result = mapPrestateDiffResponse({ pre: [], post: [created] });

    expect(result.pre).to.deep.equal({});
    expect(result.post).to.deep.equal({
      [createdAddress]: { balance: '0x0', code: '0x6080', nonce: 1, storage: { [changedSlot]: one } },
    });
  });

  it('keeps the full state of an account deleted by the transaction in pre', function () {
    const result = mapPrestateDiffResponse({ pre: [contractPre], post: [] });

    expect(result.pre[contractAddress].storage).to.deep.equal(contractPre.storage);
    expect(result.post).to.deep.equal({});
  });

  it('returns empty sides for an empty or missing response', function () {
    expect(mapPrestateDiffResponse({ pre: [] })).to.deep.equal({ pre: {}, post: {} });
    expect(mapPrestateDiffResponse(undefined as unknown as IPrestateResponse)).to.deep.equal({ pre: {}, post: {} });
  });

  it('skips post entries without an address', function () {
    const response = { pre: [], post: [{ ...unchanged, balance: '0x1' }] } as unknown as IPrestateResponse;

    expect(mapPrestateDiffResponse(response).post).to.deep.equal({});
  });
});

describe('applyPrestateDiffConfig', function () {
  const contractAddress = '0x305a8e76ac38fc088132fb780b2171950ff023f7';
  const emptyAddress = '0x00000000000000000000000000000000000004d2';
  const slot = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const one = '0x0000000000000000000000000000000000000000000000000000000000000001';
  const seven = '0x0000000000000000000000000000000000000000000000000000000000000007';

  const diff: PrestateDiffResult = {
    pre: {
      [contractAddress]: { balance: '0x0', nonce: 1, code: '0x6080', storage: { [slot]: one } },
      [emptyAddress]: { balance: '0x0', nonce: 0, code: '0x', storage: {} },
    },
    post: {
      [contractAddress]: { code: '0x6081', storage: { [slot]: seven } },
      [emptyAddress]: { balance: '0x1' },
    },
  };

  it('returns the diff unchanged by default', function () {
    expect(applyPrestateDiffConfig(diff)).to.deep.equal(diff);
  });

  it('omits the code from both sides with disableCode', function () {
    const result = applyPrestateDiffConfig(diff, { disableCode: true });

    expect(result.pre[contractAddress]).to.not.have.property('code');
    expect(result.post[contractAddress]).to.deep.equal({ storage: { [slot]: seven } });
  });

  it('omits the storage from both sides with disableStorage', function () {
    const result = applyPrestateDiffConfig(diff, { disableStorage: true });

    expect(result.pre[contractAddress]).to.not.have.property('storage');
    expect(result.post[contractAddress]).to.deep.equal({ code: '0x6081' });
  });

  it('drops empty accounts from pre only with includeEmpty false', function () {
    const result = applyPrestateDiffConfig(diff, { includeEmpty: false });

    expect(result.pre).to.not.have.property(emptyAddress);
    expect(result.post[emptyAddress]).to.deep.equal({ balance: '0x1' });
  });

  it('does not modify its input', function () {
    const input = structuredClone(diff);

    applyPrestateDiffConfig(input, { disableCode: true, disableStorage: true, includeEmpty: false });

    expect(input).to.deep.equal(diff);
  });
});
