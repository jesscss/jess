import { defineFunction, makeDimension } from '@jesscss/core/value';

/** Less `abs()` over the canonical typed value domain. */
const abs = defineFunction('abs', {
  params: [{ name: 'value', kinds: ['Dimension'] }] as const,
  body: value => makeDimension(Math.abs(value.number), value.unit)
});

export { abs };
export default abs;
