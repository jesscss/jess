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
    if (!Number.isInteger(index.number)) {
      throw new TypeError('list.set-nth() index must be an integer');
    }
    const zeroBased = resolveSassListIndex(index.number, info.values.length);
    // Core owns zero-based access/bounds; Sass owns one-based index policy.
    listValueAt(list, zeroBased);
    const values = [...info.values];
    values[zeroBased] = value;
    return createSassListResult(values, info.sep, info.bracketed);
  }
});

export default setNth;
