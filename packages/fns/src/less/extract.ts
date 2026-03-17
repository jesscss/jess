import { defineFunction, Node, List, Sequence, Dimension, toNumber } from '@jesscss/core';

function getItems(value: Node): readonly Node[] {
  if (value instanceof List && value.length === 1 && value.value[0] instanceof Sequence) {
    return value.value[0].value;
  }
  if (value instanceof List || value instanceof Sequence) {
    return value.value;
  }
  return [value];
}

const extract = defineFunction(
  'extract',
  function(this: { rawArgs?: List } | undefined, value: Node, index: number): Node {
    const items = getItems(value);
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
    if (out instanceof Sequence) {
      const normalizedOut = out.copy(true) as Sequence;
      normalizedOut.value.forEach((node, index) => {
        node.pre = index === 0 ? 0 : 1;
      });
      return normalizedOut;
    }
    return out;
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
