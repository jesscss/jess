import { defineFunction, makeDimension } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `pi()` — the constant π as a unitless dimension. */
export const pi: Fn = defineFunction('pi', { params: [], body: () => makeDimension(Math.PI) });
