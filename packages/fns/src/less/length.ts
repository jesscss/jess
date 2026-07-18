import { defineFunction, Node, Dimension, coerceListItems } from '@jesscss/core';

/**
 * Less `length()` — the number of items in a list (or `1` for a single value).
 * @param value a list or single value
 * @returns the item count as a unitless `Dimension`
 */
const length = defineFunction(
  'length',
  function(value: Node): Dimension {
    const items = coerceListItems(value);
    return new Dimension({ number: items.length, unit: undefined });
  },
  {
    params: [{
      name: 'value',
      type: Node
    }]
  }
);

export default length;
