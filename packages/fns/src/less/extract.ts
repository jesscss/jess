import { defineFunction, Node, List, Dimension, toNumber, coerceListItems } from '@jesscss/core';

const extract = defineFunction(
  'extract',
  function(this: { rawArgs?: List } | undefined, value: Node, index: number): Node {
    const items = coerceListItems(value);
    const raw = Math.trunc(index);
    if (!Number.isFinite(raw)) {
      if (items.length === 1) {
        return items[0]!;
      }
    }

    const normalized = raw;
    if (normalized < 1 || normalized > items.length) {
      throw new RangeError(`extract() index ${raw} out of range for length ${items.length}`);
    }
    const out = items[normalized - 1]!;
    return out.copy(true).detachTrivia(true);
  },
  {
    params: [{
      name: 'value',
      type: Node
    }, {
      name: 'index',
      type: Dimension,
      convert: [toNumber()]
    }]
  }
);

export default extract;
