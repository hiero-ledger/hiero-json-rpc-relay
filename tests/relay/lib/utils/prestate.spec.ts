// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import type {
  IPrestateAccountTrace,
  IPrestateResponse,
} from '../../../../src/relay/lib/clients/models/IPrestateResponse';
import { mapPrestateResponse } from '../../../../src/relay/lib/utils/prestate';

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
