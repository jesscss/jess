import type { Fn } from '@jesscss/core/value';
import { makeKeyword, defineFunction } from '@jesscss/core/value';
import { requireDimension } from './math-helper.js';

/**
 * `get-unit(dimension)` — the dimension's unit as a keyword (empty for a unitless
 * number). The value-domain inverse of `unit(d, u)`. Byte-faithful to legacy
 * `get-unit` (`new Anonymous(n.unit.toString())`).
 */
export const getUnit: Fn = defineFunction('get-unit', {
  params: [{ kinds: ['Dimension'] }],
  body: d => makeKeyword(requireDimension(d).unit ?? '')
});
