import { listValueAt, define, checkAny, checkDimension } from '@jesscss/core/value';
import { createSassListResult, getSassListInfo, resolveSassListIndex } from './util.js';

const setNth = define('set-nth', {
  params: [
    { name: 'list', type: 'any', check: checkAny },
    { name: 'index', type: 'Dimension', check: checkDimension },
    { name: 'value', type: 'any', check: checkAny }
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
