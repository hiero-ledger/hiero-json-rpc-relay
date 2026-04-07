// SPDX-License-Identifier: Apache-2.0

import { Address, BigInt } from "@graphprotocol/graph-ts";
import {
  afterAll,
  assert,
  beforeAll,
  clearStore,
  describe,
  test,
} from "matchstick-as/assembly/index";

import { handleExampleHTSNFTApproval } from "../src/example-htsnft";
import { createExampleHTSNFTApprovalEvent } from "./example-htsnft-utils";

// Tests structure (matchstick-as >=0.5.0)
// https://thegraph.com/docs/en/developer/matchstick/#tests-structure-0-5-0

describe("Describe entity assertions", () => {
  beforeAll(() => {
    const owner = Address.fromString(
      "0x0000000000000000000000000000000000000001",
    );
    const approved = Address.fromString(
      "0x0000000000000000000000000000000000000001",
    );
    const tokenId = BigInt.fromI32(234);
    const newExampleHTSNFTApprovalEvent = createExampleHTSNFTApprovalEvent(
      owner,
      approved,
      tokenId,
    );
    handleExampleHTSNFTApproval(newExampleHTSNFTApprovalEvent);
  });

  afterAll(() => {
    clearStore();
  });

  // For more test scenarios, see:
  // https://thegraph.com/docs/en/developer/matchstick/#write-a-unit-test

  test("ExampleHTSNFTApproval created and stored", () => {
    assert.entityCount("ExampleHTSNFTApproval", 1);

    // 0xa16081f360e3847006db660bae1c6d1b2e17ec2a is the default address used in newMockEvent() function
    assert.fieldEquals(
      "ExampleHTSNFTApproval",
      "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-1",
      "owner",
      "0x0000000000000000000000000000000000000001",
    );
    assert.fieldEquals(
      "ExampleHTSNFTApproval",
      "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-1",
      "approved",
      "0x0000000000000000000000000000000000000001",
    );
    assert.fieldEquals(
      "ExampleHTSNFTApproval",
      "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-1",
      "tokenId",
      "234",
    );

    // More assert options:
    // https://thegraph.com/docs/en/developer/matchstick/#asserts
  });
});
