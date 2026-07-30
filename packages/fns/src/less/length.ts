import { defineFunction, groupItems, groupSeparator, makeDimension } from '@jesscss/core';

/**
 * Less `length()` — the number of items in a list (or `1` for a single value).
 * @param value a list or single value
 * @returns the item count as a unitless `Dimension`
 */
const length = defineFunction('length', {
  params: [{ type: 'any' }],
  variadic: true,
  body: (list) => {
    const args = groupItems(list);
    const target = groupSeparator(list) === ',' ? args[0] : list;
    const items = groupItems(target);
    return makeDimension(items.length);
  }
});

export default length;
