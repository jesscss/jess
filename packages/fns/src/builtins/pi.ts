import { makeDimension } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `pi()` — the constant π as a unitless dimension. */
export const pi: Fn = { name: 'pi', params: [], body: () => makeDimension(Math.PI) };
