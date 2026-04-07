// SPDX-License-Identifier: Apache-2.0

import { Address, BigInt,ethereum } from "@graphprotocol/graph-ts";
import { newMockEvent } from "matchstick-as";

import {
  ApprovalForAll,
  ExampleHTSNFTApproval,
  ExampleHTSNFTTransfer,
} from "../generated/ExampleHTSNFT/ExampleHTSNFT";

export function createExampleHTSNFTApprovalEvent(
  owner: Address,
  approved: Address,
  tokenId: BigInt,
): ExampleHTSNFTApproval {
  const exampleHtsnftApprovalEvent = changetype<ExampleHTSNFTApproval>(
    newMockEvent(),
  );

  exampleHtsnftApprovalEvent.parameters = [];

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
  const approvalForAllEvent = changetype<ApprovalForAll>(newMockEvent());

  approvalForAllEvent.parameters = [];

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
  const exampleHtsnftTransferEvent = changetype<ExampleHTSNFTTransfer>(
    newMockEvent(),
  );

  exampleHtsnftTransferEvent.parameters = [];

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
