// SPDX-License-Identifier: Apache-2.0

import { newMockEvent } from "matchstick-as";
import { ethereum, Address, BigInt } from "@graphprotocol/graph-ts";
import {
  Approval,
  ExampleERC20Transfer,
} from "../generated/ExampleERC20/ExampleERC20";

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

export function createExampleERC20TransferEvent(
  from: Address,
  to: Address,
  value: BigInt,
): ExampleERC20Transfer {
  let exampleErc20TransferEvent = changetype<ExampleERC20Transfer>(
    newMockEvent(),
  );

  exampleErc20TransferEvent.parameters = new Array();

  exampleErc20TransferEvent.parameters.push(
    new ethereum.EventParam("from", ethereum.Value.fromAddress(from)),
  );
  exampleErc20TransferEvent.parameters.push(
    new ethereum.EventParam("to", ethereum.Value.fromAddress(to)),
  );
  exampleErc20TransferEvent.parameters.push(
    new ethereum.EventParam("value", ethereum.Value.fromUnsignedBigInt(value)),
  );

  return exampleErc20TransferEvent;
}
