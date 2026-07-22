import { defineFunction, makeDimension } from '@jesscss/core/value';

/** Sass `math.abs()` / global `abs()` over the canonical value domain. */
const abs = defineFunction('abs', {
  params: [{ name: 'value', kinds: ['Dimension'] }] as const,
  body: value => makeDimension(Math.abs(value.number), value.unit)
});

export default abs;
