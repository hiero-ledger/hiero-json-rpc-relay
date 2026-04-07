// SPDX-License-Identifier: Apache-2.0

import { Address,BigInt } from "@graphprotocol/graph-ts";
import {
  afterAll,
  assert,
  beforeAll,
  clearStore,
  describe,
  test,
} from "matchstick-as/assembly/index";

import { NewGravatar as NewGravatarEvent } from "../generated/GravatarRegistry/GravatarRegistry";
import { NewGravatar } from "../generated/schema";
import { handleNewGravatar } from "../src/gravatar-registry";
import { createNewGravatarEvent } from "./gravatar-registry-utils";

// Tests structure (matchstick-as >=0.5.0)
// https://thegraph.com/docs/en/developer/matchstick/#tests-structure-0-5-0

describe("Describe entity assertions", () => {
  beforeAll(() => {
    const id = BigInt.fromI32(234);
    const owner = Address.fromString(
      "0x0000000000000000000000000000000000000001",
    );
    const displayName = "Example string value";
    const imageUrl = "Example string value";
    const newNewGravatarEvent = createNewGravatarEvent(
      id,
      owner,
      displayName,
      imageUrl,
    );
    handleNewGravatar(newNewGravatarEvent);
  });

  afterAll(() => {
    clearStore();
  });

  // For more test scenarios, see:
  // https://thegraph.com/docs/en/developer/matchstick/#write-a-unit-test

  test("NewGravatar created and stored", () => {
    assert.entityCount("NewGravatar", 1);

    // 0xa16081f360e3847006db660bae1c6d1b2e17ec2a is the default address used in newMockEvent() function
    assert.fieldEquals(
      "NewGravatar",
      "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-1",
      "owner",
      "0x0000000000000000000000000000000000000001",
    );
    assert.fieldEquals(
      "NewGravatar",
      "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-1",
      "displayName",
      "Example string value",
    );
    assert.fieldEquals(
      "NewGravatar",
      "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-1",
      "imageUrl",
      "Example string value",
    );

    // More assert options:
    // https://thegraph.com/docs/en/developer/matchstick/#asserts
  });
});
