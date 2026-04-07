// SPDX-License-Identifier: Apache-2.0

import { Gravatar } from "../generated/schema";
import {
  NewGravatar,
  UpdatedGravatar,
} from "../generated/GravatarRegistry/GravatarRegistry";

export function handleNewGravatar(event: NewGravatar): void {
  const gravatar = new Gravatar(event.params.id.toHexString());
  gravatar.owner = event.params.owner;
  gravatar.displayName = event.params.displayName;
  gravatar.imageUrl = event.params.imageUrl;
  gravatar.save();
}

export function handleUpdatedGravatar(event: UpdatedGravatar): void {
  const id = event.params.id.toHexString();
  let gravatar = Gravatar.load(id);
  if (gravatar == null) {
    gravatar = new Gravatar(id);
  }
  gravatar.owner = event.params.owner;
  gravatar.displayName = event.params.displayName;
  gravatar.imageUrl = event.params.imageUrl;
  gravatar.save();
}
