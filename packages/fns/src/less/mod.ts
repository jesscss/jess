import { defineFunction, makeDimension } from '@jesscss/core/value';

/**
 * Less `mod()` — remainder of `a / b` (JavaScript `%`), keeping `a`'s unit.
 * @param a dividend `Dimension`
 * @param b divisor `Dimension`
 * @returns `a % b` as a `Dimension` with `a`'s unit
 */
const mod = defineFunction('mod', {
  params: [{ name: 'a', kinds: ['Dimension'] }, { name: 'b', kinds: ['Dimension'] }] as const,
  body: (a, b) => makeDimension(a.number % b.number, a.unit)
});

export { mod };
export default mod;
