import { defineFunction, makeDimension } from '@jesscss/core';

/** Less `floor()` and Sass `math.floor()` over the canonical value domain. */
const floor = defineFunction('floor', {
  params: [{ name: 'value', type: 'Dimension' }] as const,
  body: value => makeDimension(Math.floor(value.number), value.unit)
});

export default floor;
