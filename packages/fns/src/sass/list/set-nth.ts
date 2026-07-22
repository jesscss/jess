import { defineFunction, listValueAt } from '@jesscss/core/value';
import { createSassListResult, getSassListInfo, resolveSassListIndex } from './util.js';

const setNth = defineFunction('set-nth', {
  params: [
    { name: 'list', kinds: 'any' },
    { name: 'index', kinds: ['Dimension'] },
    { name: 'value', kinds: 'any' }
  ] as const,
  body: (list, index, value) => {
    const info = getSassListInfo(list);
    const normalized = Math.floor(index.number);
    if (!Number.isFinite(normalized)) {
      throw new RangeError(`List index ${normalized} is out of bounds`);
    }
    const zeroBased = resolveSassListIndex(index.number, info.values.length);
    // Core owns zero-based access/bounds; Sass owns the one-based floor policy.
    listValueAt(list, zeroBased);
    const values = [...info.values];
    values[zeroBased] = value;
    return createSassListResult(values, info.sep, info.bracketed);
  }
});

export default setNth;
