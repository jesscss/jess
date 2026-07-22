import { defineFunction, makeDimension } from '@jesscss/core/value';

/** Less `floor()` over the canonical typed value domain. */
const floor = defineFunction('floor', {
  params: [{ name: 'value', kinds: ['Dimension'] }] as const,
  body: value => makeDimension(Math.floor(value.number), value.unit)
});

export { floor };
export default floor;
