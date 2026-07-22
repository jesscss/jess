import { coerceListItems, defineFunction, listValueAt } from '@jesscss/core/value';
import { resolveSassListIndex } from './util.js';

const nth = defineFunction('nth', {
  params: [
    { name: 'list', kinds: 'any' },
    { name: 'index', kinds: ['Dimension'] }
  ] as const,
  body: (list, index) => {
    if (!Number.isFinite(index.number)) {
      throw new TypeError('list.nth() index must be finite');
    }
    const zeroBased = resolveSassListIndex(index.number, coerceListItems(list).length);
    return listValueAt(list, zeroBased);
  }
});

export default nth;
