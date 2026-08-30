import { defineFunction, groupItems, listValueAt } from '@jesscss/core';
import { resolveSassListIndex } from './util.js';

const nth = defineFunction('nth', {
  params: [
    { name: 'list', type: 'any' },
    { name: 'index', type: 'Dimension' }
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
