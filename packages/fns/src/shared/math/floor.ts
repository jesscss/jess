import { defineFunction, makeDimension } from '@jesscss/core/value';

/** Less `floor()` and Sass `math.floor()` over the canonical value domain. */
const floor = defineFunction('floor', {
  params: [{ name: 'value', kinds: ['Dimension'] }] as const,
  body: value => makeDimension(Math.floor(value.number), value.unit)
});

export default floor;
