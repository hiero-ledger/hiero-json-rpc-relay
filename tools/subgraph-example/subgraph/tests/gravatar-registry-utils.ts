// SPDX-License-Identifier: Apache-2.0

import { newMockEvent } from "matchstick-as";
import { ethereum, BigInt, Address } from "@graphprotocol/graph-ts";
import {
  NewGravatar,
  UpdatedGravatar,
} from "../generated/GravatarRegistry/GravatarRegistry";

export function createNewGravatarEvent(
  id: BigInt,
  owner: Address,
  displayName: string,
  imageUrl: string,
): NewGravatar {
  let newGravatarEvent = changetype<NewGravatar>(newMockEvent());

  newGravatarEvent.parameters = new Array();

  newGravatarEvent.parameters.push(
    new ethereum.EventParam("id", ethereum.Value.fromUnsignedBigInt(id)),
  );
  newGravatarEvent.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner)),
  );
  newGravatarEvent.parameters.push(
    new ethereum.EventParam(
      "displayName",
      ethereum.Value.fromString(displayName),
    ),
  );
  newGravatarEvent.parameters.push(
    new ethereum.EventParam("imageUrl", ethereum.Value.fromString(imageUrl)),
  );

  return newGravatarEvent;
}

export function createUpdatedGravatarEvent(
  id: BigInt,
  owner: Address,
  displayName: string,
  imageUrl: string,
): UpdatedGravatar {
  let updatedGravatarEvent = changetype<UpdatedGravatar>(newMockEvent());

  updatedGravatarEvent.parameters = new Array();

  updatedGravatarEvent.parameters.push(
    new ethereum.EventParam("id", ethereum.Value.fromUnsignedBigInt(id)),
  );
  updatedGravatarEvent.parameters.push(
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner)),
  );
  updatedGravatarEvent.parameters.push(
    new ethereum.EventParam(
      "displayName",
      ethereum.Value.fromString(displayName),
    ),
  );
  updatedGravatarEvent.parameters.push(
    new ethereum.EventParam("imageUrl", ethereum.Value.fromString(imageUrl)),
  );

  return updatedGravatarEvent;
}
