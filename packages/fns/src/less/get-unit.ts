import { Any, defineFunction, Dimension } from '@jesscss/core';

/**
 * Less `get-unit()` — the unit of a `Dimension` as a keyword (empty when unitless).
 * @param value the input `Dimension`
 * @returns the unit as an unquoted keyword
 */
const getUnit = defineFunction(
  'get-unit',
  function(value: Dimension) {
    return new Any(value.unit ?? '', { role: 'keyword' });
  },
  {
    params: [{
      name: 'value',
      type: Dimension
    }]
  }
);

export default getUnit;
