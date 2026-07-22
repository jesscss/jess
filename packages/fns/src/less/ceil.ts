import { defineFunction, makeDimension } from '@jesscss/core/value';

/** Less `ceil()` over the canonical typed value domain. */
const ceil = defineFunction('ceil', {
  params: [{ name: 'value', kinds: ['Dimension'] }] as const,
  body: value => makeDimension(Math.ceil(value.number), value.unit)
});

export { ceil };
export default ceil;
