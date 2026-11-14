import { makeDimension, define } from '@jesscss/core/value';
import type { Fn } from '@jesscss/core/value';

/** `pi()` — the constant π as a unitless dimension. */
export const pi: Fn = /* @__PURE__ */ define('pi', { params: [], body: () => makeDimension(Math.PI) });
