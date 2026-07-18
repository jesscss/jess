import {
  Any,
  Dimension,
  Quoted,
  defineFunction
} from '@jesscss/core';

/**
 * Less `unit()` — return `dimension` with its unit replaced by `unit` (or the unit
 * stripped when `unit` is omitted). Only the unit changes; the number is untouched.
 * @param dimension the input `Dimension`
 * @param unit optional replacement unit keyword/string
 * @returns a `Dimension` with the new (or no) unit
 */
export default defineFunction(
  'unit',
  function(dimension: Dimension, unit?: Any<'keyword'> | Quoted) {
    const resolvedUnit = unit?.valueOf();
    return new Dimension(
      resolvedUnit
        ? {
            number: dimension.number,
            unit: resolvedUnit
          }
        : { number: dimension.number }
    );
  },
  {
    params: [{
      name: 'dimension',
      type: Dimension
    }, {
      name: 'unit',
      type: [Any, Quoted],
      optional: true
    }]
  }
);