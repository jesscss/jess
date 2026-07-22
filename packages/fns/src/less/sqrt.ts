import { defineFunction, makeDimension } from '@jesscss/core/value';

/**
 * Less `sqrt()` — square root, preserving the input unit.
 * @param value number or `Dimension`
 * @returns the square root as a `Dimension` carrying the input's unit
 */
/** Less `sqrt(value)` — canonical value-domain callable, preserving its unit. */
const sqrt = defineFunction('sqrt', {
  params: [{ name: 'value', kinds: ['Dimension'] }] as const,
  body: value => makeDimension(Math.sqrt(value.number), value.unit)
});

export { sqrt };
export default sqrt;
