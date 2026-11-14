import { emitValue, groupItems, makeDimension, NULL, define, checkAny } from '@jesscss/core/value';

const index = define('index', {
  params: [
    { name: 'list', type: 'any', check: checkAny },
    { name: 'value', type: 'any', check: checkAny }
  ] as const,
  body: (list, value) => {
    const items = groupItems(list);
    const found = items.findIndex(item => emitValue(item) === emitValue(value));
    return found < 0 ? NULL : makeDimension(found + 1);
  }
});

export default index;
