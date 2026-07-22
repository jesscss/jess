import { defineFunction, makeDimension } from '@jesscss/core/value';

/** `abs(value)` — the shared Less/Sass value-domain implementation. */
export const abs = defineFunction('abs', {
  params: [{ name: 'value', kinds: ['Dimension'] }] as const,
  body: value => makeDimension(Math.abs(value.number), value.unit)
});

export default abs;
