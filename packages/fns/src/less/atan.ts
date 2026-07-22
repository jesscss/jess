import { defineFunction, makeDimension } from '@jesscss/core/value';

/**
 * Less `atan()` — arc tangent, returned in radians.
 * @param value unitless number or `Dimension`
 * @returns the angle as a `rad` `Dimension`
 */
/** Less `atan(value)` — canonical value-domain callable, returned in radians. */
const atan = defineFunction('atan', {
  params: [{ name: 'value', kinds: ['Dimension'] }] as const,
  body: value => makeDimension(Math.atan(value.number), 'rad')
});

export { atan };
export default atan;
