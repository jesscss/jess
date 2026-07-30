import { defineFunction, makeDimension } from '@jesscss/core';

/** Less `ceil()` and Sass `math.ceil()` over the canonical value domain. */
const ceil = defineFunction('ceil', {
  params: [{ name: 'value', type: 'Dimension' }] as const,
  body: value => makeDimension(Math.ceil(value.number), value.unit)
});

export default ceil;
