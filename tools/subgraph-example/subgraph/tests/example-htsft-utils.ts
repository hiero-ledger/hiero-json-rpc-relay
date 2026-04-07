// SPDX-License-Identifier: Apache-2.0

import { newMockEvent } from "matchstick-as";
import { ethereum, Address, BigInt } from "@graphprotocol/graph-ts";
import {
  Approval,
  ExampleHTSFTTransfer,
} from "../generated/ExampleHTSFT/ExampleHTSFT";

export function createApprovalEvent(
  owner: Address,
  spender: Address,
  value: BigInt,
): Approval {
  let approvalEvent = changetype<Approval>(newMockEvent());

  approvalEvent.parameters = new Array();

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
  let exampleHtsFTTransferEvent = changetype<ExampleHTSFTTransfer>(
    newMockEvent(),
  );

  exampleHtsFTTransferEvent.parameters = new Array();

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
