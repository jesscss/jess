import { groupItems, listValueAt, define, checkAny, checkDimension } from '@jesscss/core/value';
import { resolveSassListIndex } from './util.js';

const nth = define('nth', {
  params: [
    { name: 'list', type: 'any', check: checkAny },
    { name: 'index', type: 'Dimension', check: checkDimension }
  ] as const,
  body: (list, index) => {
    if (!Number.isInteger(index.number)) {
      throw new TypeError('list.nth() index must be an integer');
    }
    const zeroBased = resolveSassListIndex(index.number, groupItems(list).length);
    return listValueAt(list, zeroBased);
  }
});

export default nth;
