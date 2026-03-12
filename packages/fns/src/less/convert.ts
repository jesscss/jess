import { Any, Dimension, Quoted, defineFunction } from '@jesscss/core';

const unitConversions: Record<string, Record<string, number>> = {
  length: {
    m: 1,
    cm: 0.01,
    mm: 0.001,
    in: 0.0254,
    px: 0.0254 / 96,
    pt: 0.0254 / 72,
    pc: 0.0254 / 72 * 12
  },
  duration: {
    s: 1,
    ms: 0.001
  },
  angle: {
    rad: 1 / (2 * Math.PI),
    deg: 1 / 360,
    grad: 1 / 400,
    turn: 1
  }
};

export default defineFunction(
  'convert',
  function(value: Dimension, unit: Any<'keyword'> | Quoted) {
    const from = value.data.unit;
    const target = unit.valueOf();
    if (!from || !target || from === target) {
      return value;
    }
    for (const group of Object.values(unitConversions)) {
      if (group[from] !== undefined && group[target] !== undefined) {
        const converted = value.data.number * (group[from] / group[target]);
        return new Dimension({ number: converted, unit: target });
      }
    }
    return value;
  },
  {
    params: [{
      name: 'value',
      type: Dimension
    }, {
      name: 'unit',
      type: [Any, Quoted]
    }]
  }
);
