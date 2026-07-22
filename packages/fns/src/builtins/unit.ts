import type { Fn } from '@jesscss/core/value';
import { makeDimension, textOf, defineFunction } from '@jesscss/core/value';
import { requireDimension } from './math-helper.js';

/**
 * `unit(dimension, unit?)` — replace (or, with no/empty second arg, STRIP) the
 * dimension's unit. Byte-faithful to legacy `unit`: a falsy resolved unit drops it.
 */
export const unit: Fn = defineFunction('unit', {
  params: [{ kinds: ['Dimension'] }, { kinds: ['Keyword', 'Quoted'], optional: true }],
  body: (d, u) => {
    const resolved = u !== undefined
      ? (u.type === 'Keyword' || u.type === 'Quoted' ? textOf(u) : '')
      : '';
    return makeDimension(requireDimension(d).number, resolved || '');
  }
});
