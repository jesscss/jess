import { defineFunction, makeDimension } from '@jesscss/core/value';

/**
 * Less `asin()` — arc sine, returned in radians.
 * @param value unitless number or `Dimension`
 * @returns the angle as a `rad` `Dimension`
 */
/** Less `asin(value)` — canonical value-domain callable, returned in radians. */
const asin = defineFunction('asin', {
  params: [{ name: 'value', kinds: ['Dimension'] }] as const,
  body: value => makeDimension(Math.asin(value.number), 'rad')
});

export { asin };
export default asin;
