// SPDX-License-Identifier: Apache-2.0

import { ITokenEvent } from "../types/token/ITokenEvent";
import { expect } from "chai";
import { IFungibleTokenEvent } from "../types/token/IFungibleTokenEvent";
import { INonFungibleTokenEvent } from "../types/token/INonFungibleTokenEvent";

const FUNGIBLE_TYPES = ["ERC20", "HTSFT"];
const NON_FUNGIBLE_TYPES = ["ERC721", "HTSNFT"];

export abstract class TokenAssertionStrategy {
  protected abstract verify(actual: ITokenEvent, expected: ITokenEvent): void;

  assertEquals(actual: ITokenEvent, expected: ITokenEvent): void {
    expect(actual.id).to.equal(expected.id);
    expect(actual.type).to.equal(expected.type);
    expect(actual.transfers).to.have.deep.members(expected.transfers);
    this.verify(actual, expected);
  }

  static isFungibleToken(event: ITokenEvent): event is IFungibleTokenEvent {
    return FUNGIBLE_TYPES.includes(event.type);
  }

  static isNonFungibleToken(
    event: ITokenEvent,
  ): event is INonFungibleTokenEvent {
    return NON_FUNGIBLE_TYPES.includes(event.type);
  }
}

export class FungibleTokenStrategy extends TokenAssertionStrategy {
  protected verify(
    actual: IFungibleTokenEvent,
    expected: IFungibleTokenEvent,
  ): void {
    expect(actual.supply).to.equal(expected.supply);
  }
}

export class NonFungibleTokenStrategy extends TokenAssertionStrategy {
  protected verify(
    actual: INonFungibleTokenEvent,
    expected: INonFungibleTokenEvent,
  ): void {
    expect(actual.owner).to.equal(expected.owner);
    expect(actual.tokenId).to.equal(expected.tokenId);
  }
}
