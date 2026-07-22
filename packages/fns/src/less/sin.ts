import { defineFunction, makeDimension } from '@jesscss/core/value';

/**
 * Less `sin()` — sine of an angle. Angle units (`deg`/`grad`/`turn`) are
 * normalized to radians first; a unitless input is treated as radians.
 * @param value angle as a `Dimension` (or unitless number, in radians)
 * @returns the unitless sine
 */
const sin = defineFunction('sin', {
  params: [{ name: 'value', kinds: ['Dimension'] }] as const,
  body: value => makeDimension(Math.sin(value.unit === 'deg' ? value.number * Math.PI / 180 : value.unit === 'grad' ? value.number * Math.PI / 200 : value.unit === 'turn' ? value.number * 2 * Math.PI : value.number))
});

export { sin };
export default sin;
