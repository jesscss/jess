import { defineFunction, emitValue, groupItems, makeDimension, NIL } from '@jesscss/core/value';

const index = defineFunction('index', {
  params: [
    { name: 'list', kinds: 'any' },
    { name: 'value', kinds: 'any' }
  ] as const,
  body: (list, value) => {
    const items = groupItems(list);
    const found = items.findIndex(item => emitValue(item) === emitValue(value));
    return found < 0 ? NIL : makeDimension(found + 1);
  }
});

export default index;
