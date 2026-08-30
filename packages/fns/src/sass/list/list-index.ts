import { defineFunction, emitValue, groupItems, makeDimension, NULL } from '@jesscss/core';

const index = defineFunction('index', {
  params: [
    { name: 'list', type: 'any' },
    { name: 'value', type: 'any' }
  ] as const,
  body: (list, value) => {
    const items = groupItems(list);
    const found = items.findIndex(item => emitValue(item) === emitValue(value));
    return found < 0 ? NULL : makeDimension(found + 1);
  }
});

export default index;
