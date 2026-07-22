import { defineFunction, makeDimension } from '@jesscss/core/value';

/**
 * Less `percentage()` — convert a number to a percentage by multiplying by 100 and
 * applying the `%` unit (e.g. `0.5` → `50%`).
 * @param value unitless number or `Dimension`
 * @returns the value as a `%` `Dimension`
 */
const percentage = defineFunction('percentage', {
  params: [{ name: 'value', kinds: ['Dimension'] }] as const,
  body: value => makeDimension(value.number * 100, '%')
});

export { percentage };
export default percentage;
