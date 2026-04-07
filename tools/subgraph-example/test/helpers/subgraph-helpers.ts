// SPDX-License-Identifier: Apache-2.0

import { expect } from "chai";
import fetch from "node-fetch";

import {
  FungibleTokenStrategy,
  NonFungibleTokenStrategy,
  TokenAssertionStrategy,
} from "../assertions/TokenAssertionStrategy";
import { IGravatarEvent } from "../types/gravatar/IGravatarEvent";
import { IQueryResponse } from "../types/IQueryResponse";
import { ITokenEvent } from "../types/token/ITokenEvent";

const URL = "http://127.0.0.1:8000/subgraphs/name/subgraph-example";

export async function getData<T>(query: string): Promise<IQueryResponse<T>> {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: query,
    }),
  });

  return await res.json();
}

export function verifyGravatarEvents(
  actual: Array<IGravatarEvent>,
  expected: Array<IGravatarEvent>,
): void {
  if (actual.length !== expected.length) {
    expect.fail("Actual and expected lengths do not match!");
  }
  expect(actual).to.have.deep.members(expected);
}

export function verifyTokenEvents(
  actual: Array<ITokenEvent>,
  expected: Array<ITokenEvent>,
): void {
  if (actual.length !== expected.length) {
    expect.fail("Actual and expected lengths do not match!");
  }

  if (actual.length === 0) {
    return;
  }

  let strategy: TokenAssertionStrategy;

  if (TokenAssertionStrategy.isFungibleToken(actual[0])) {
    strategy = new FungibleTokenStrategy();
  } else if (TokenAssertionStrategy.isNonFungibleToken(actual[0])) {
    strategy = new NonFungibleTokenStrategy();
  } else {
    expect.fail("Unsupported token type!");
  }

  for (let i = 0; i < actual.length; i++) {
    strategy.assertEquals(actual[i], expected[i]);
  }
}
