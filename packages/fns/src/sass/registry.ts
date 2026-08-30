/**
 * The Sass built-in registry, DERIVED from `sass/index.ts` and nothing else.
 *
 * Deliberately in the dialect folder: a Sass-only consumer must not pull the
 * Less index into its bundle just to build the Sass dispatch table.
 */
import type { Fn, FnRegistry } from '@jesscss/core';
import { fnsOf, registryOf } from '../registry.js';
import * as sassIndex from './index.js';

/** Every Sass built-in. Derived from the index — not a maintained list. */
export const sassFns: readonly Fn[] = fnsOf(sassIndex);

/** Build the Sass built-in dispatch table. */
export function makeSassRegistry(): FnRegistry {
  return registryOf(sassIndex);
}
