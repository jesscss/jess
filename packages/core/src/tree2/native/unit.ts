import type { Dimension, Keyword, Quoted } from '../value-eval.js';
import { makeDimension, textOf } from '../value-factory.js';
import type { NativeFn } from './types.js';

/**
 * `unit(dimension, unit?)` — replace (or, with no/empty second arg, STRIP) the
 * dimension's unit. Byte-faithful to legacy `unit`: a falsy resolved unit drops it.
 */
export const unit: NativeFn = {
  name: 'unit',
  params: [{ kinds: ['dimension'] }, { kinds: ['keyword', 'quoted'], optional: true }],
  body: (d, u) => {
    const resolved = u !== undefined ? textOf(u as Keyword | Quoted) : '';
    return makeDimension((d as Dimension).number, resolved || '');
  },
};
