// SPDX-License-Identifier: Apache-2.0

import { Address, BigInt,ethereum } from "@graphprotocol/graph-ts";
import { newMockEvent } from "matchstick-as";

import {
  Approval,
  ExampleHTSFTTransfer,
} from "../generated/ExampleHTSFT/ExampleHTSFT";

export function createApprovalEvent(
  owner: Address,
  spender: Address,
  value: BigInt,
): Approval {
  const approvalEvent = changetype<Approval>(newMockEvent());

  approvalEvent.parameters = [];

  approvalEvent.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner)),
  );
  approvalEvent.parameters.push(
    new ethereum.EventParam("spender", ethereum.Value.fromAddress(spender)),
  );
  approvalEvent.parameters.push(
    new ethereum.EventParam("value", ethereum.Value.fromUnsignedBigInt(value)),
  );

  return approvalEvent;
}

export function createExampleHTSFTTransferEvent(
  from: Address,
  to: Address,
  value: BigInt,
): ExampleHTSFTTransfer {
  const exampleHtsFTTransferEvent = changetype<ExampleHTSFTTransfer>(
    newMockEvent(),
  );

  exampleHtsFTTransferEvent.parameters = [];

  exampleHtsFTTransferEvent.parameters.push(
    new ethereum.EventParam("from", ethereum.Value.fromAddress(from)),
  );
  exampleHtsFTTransferEvent.parameters.push(
    new ethereum.EventParam("to", ethereum.Value.fromAddress(to)),
  );
  exampleHtsFTTransferEvent.parameters.push(
    new ethereum.EventParam("value", ethereum.Value.fromUnsignedBigInt(value)),
  );

  return exampleHtsFTTransferEvent;
}
