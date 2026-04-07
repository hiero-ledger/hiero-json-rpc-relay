// SPDX-License-Identifier: Apache-2.0

import { newMockEvent } from "matchstick-as";
import { ethereum, Address, BigInt } from "@graphprotocol/graph-ts";
import {
  ExampleHTSNFTApproval,
  ApprovalForAll,
  ExampleHTSNFTTransfer,
} from "../generated/ExampleHTSNFT/ExampleHTSNFT";

export function createExampleHTSNFTApprovalEvent(
  owner: Address,
  approved: Address,
  tokenId: BigInt,
): ExampleHTSNFTApproval {
  let exampleHtsnftApprovalEvent = changetype<ExampleHTSNFTApproval>(
    newMockEvent(),
  );

  exampleHtsnftApprovalEvent.parameters = new Array();

  exampleHtsnftApprovalEvent.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner)),
  );
  exampleHtsnftApprovalEvent.parameters.push(
    new ethereum.EventParam("approved", ethereum.Value.fromAddress(approved)),
  );
  exampleHtsnftApprovalEvent.parameters.push(
    new ethereum.EventParam(
      "tokenId",
      ethereum.Value.fromUnsignedBigInt(tokenId),
    ),
  );

  return exampleHtsnftApprovalEvent;
}

export function createApprovalForAllEvent(
  owner: Address,
  operator: Address,
  approved: boolean,
): ApprovalForAll {
  let approvalForAllEvent = changetype<ApprovalForAll>(newMockEvent());

  approvalForAllEvent.parameters = new Array();

  approvalForAllEvent.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner)),
  );
  approvalForAllEvent.parameters.push(
    new ethereum.EventParam("operator", ethereum.Value.fromAddress(operator)),
  );
  approvalForAllEvent.parameters.push(
    new ethereum.EventParam("approved", ethereum.Value.fromBoolean(approved)),
  );

  return approvalForAllEvent;
}

export function createExampleHTSNFTTransferEvent(
  from: Address,
  to: Address,
  tokenId: BigInt,
): ExampleHTSNFTTransfer {
  let exampleHtsnftTransferEvent = changetype<ExampleHTSNFTTransfer>(
    newMockEvent(),
  );

  exampleHtsnftTransferEvent.parameters = new Array();

  exampleHtsnftTransferEvent.parameters.push(
    new ethereum.EventParam("from", ethereum.Value.fromAddress(from)),
  );
  exampleHtsnftTransferEvent.parameters.push(
    new ethereum.EventParam("to", ethereum.Value.fromAddress(to)),
  );
  exampleHtsnftTransferEvent.parameters.push(
    new ethereum.EventParam(
      "tokenId",
      ethereum.Value.fromUnsignedBigInt(tokenId),
    ),
  );

  return exampleHtsnftTransferEvent;
}
