/**
 * The Less built-in registry, DERIVED from `less/index.ts` and nothing else.
 *
 * Deliberately in the dialect folder: a Less-only consumer must not pull the
 * Sass index into its bundle just to build the Less dispatch table.
 */
import type { Fn, FnRegistry } from '@jesscss/core';
import { fnsOf, registryOf } from '../registry.js';
import * as lessIndex from './index.js';

/** Every Less built-in. Derived from the index — not a maintained list. */
export const lessFns: readonly Fn[] = fnsOf(lessIndex);

/** Build the Less built-in dispatch table. */
export function makeLessRegistry(): FnRegistry {
  return registryOf(lessIndex);
}
