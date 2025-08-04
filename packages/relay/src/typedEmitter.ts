// SPDX-License-Identifier: Apache-2.0

import EventEmitter from 'events';

import { TypedEvents } from './lib/types';

/**
 * A strongly-typed event emitter based on the native node Event Emitter
 *
 * @extends EventEmitter
 * @template TypedEvents - Defines event names and payload structures.
 */
export class TypedEmitter extends EventEmitter<TypedEvents> {
  constructor() {
    super();
  }
}
