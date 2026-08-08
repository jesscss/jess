import { defineFunction, makeDimension, type Dimension, type Null } from '@jesscss/core';

/**
 * Sass's fuzzy integer test. Sass compares numbers at 10 digits of precision, so
 * `math.random(1.0000000000001)` is accepted as the integer `1`
 * (`spec/core_functions/math/random.hrx` § `within_precision`).
 *
 * This is `random`'s own ARGUMENT semantics, not a numeric emit policy — it does
 * not round any emitted value and must not be confused with `formatNumber`'s
 * 1e-10 tolerance trim.
 */
const SASS_EPSILON = 1e-11;

const fuzzyInt = (value: number): number | undefined => {
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < SASS_EPSILON ? rounded : undefined;
};

/**
 * Sass `math.random($limit: null)` / the global `random()`.
 *
 * Verified against `spec/core_functions/math/random.hrx` and
 * `spec/core_functions/global/math.hrx` § `random`:
 *   math.random()                 → a float in [0, 1)
 *   math.random(1)                → 1
 *   math.random(2)                → 1 or 2
 *   math.random(100)              → an integer in (0, 100]
 *   math.random(null)             → a float in [0, 1)
 *   math.random(1px)              → 1     (units IGNORED)
 *   math.random(1.0000000000001)  → 1     (fuzzy integer)
 *   math.random(c)                → Error: $limit: c is not a number.
 *   math.random(1.5)              → Error: $limit: 1.5 is not an int.
 *   math.random(0)                → Error: $limit: Must be greater than 0, was 0.
 *   math.random(-1)               → Error: $limit: Must be greater than 0, was -1.
 *
 * OPEN DESIGN QUESTION (deliberately NOT decided here). dart-sass is genuinely
 * non-deterministic: it draws from the platform RNG on every compile and exposes
 * no seeding API, so two builds of one unchanged file emit different bytes. In a
 * build tool that breaks reproducible output and content-hash caching. The
 * options are (a) match dart-sass exactly, (b) seed per render so one input
 * always yields one output, (c) decline to implement it. This body implements
 * (a) so the port is faithful to the spec; the ruling is the owner's.
 */
const random = defineFunction('random', {
  params: [{ name: 'limit', type: ['Dimension', 'Null'], optional: true }] as const,
  body: (limit: Dimension | Null | undefined) => {
    if (limit === undefined || limit.type === 'Null') {
      return makeDimension(Math.random());
    }
    const bound = fuzzyInt(limit.number);
    if (bound === undefined) {
      throw new TypeError(`$limit: ${limit.bytes} is not an int.`);
    }
    if (bound < 1) {
      throw new RangeError(`$limit: Must be greater than 0, was ${limit.bytes}.`);
    }
    return makeDimension(Math.floor(Math.random() * bound) + 1);
  }
});

export { random };
export default random;
