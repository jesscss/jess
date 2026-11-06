import { defineFunction, makeDimension } from '@jesscss/core/value';

/** `abs(value)` — the shared Less/Sass value-domain implementation. */
export const abs = defineFunction('abs', {
  cssFunction: true,

  /* CSS's abs() takes any number, length or angle, as this one does. */
  params: [{ name: 'number', type: 'Dimension', fits: () => true }] as const,
  body: value => makeDimension(Math.abs(value.number), value.unit)
});

export default abs;
