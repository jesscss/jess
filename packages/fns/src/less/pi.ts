import { defineFunction, makeDimension } from '@jesscss/core';
import type { Fn } from '@jesscss/core';

/** `pi()` — the constant π as a unitless dimension. */
export const pi: Fn = defineFunction('pi', { params: [], body: () => makeDimension(Math.PI) });
