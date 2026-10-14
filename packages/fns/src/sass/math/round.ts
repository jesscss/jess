import { defineFunction, makeDimension, round as roundNumber } from '@jesscss/core';

/**
 * Sass `math.round($number)` / the global `round()`.
 *
 * NOT the same function as Less's `round`, which is why this is dialect-owned:
 * Less's second argument is DECIMAL PRECISION (`round(1.234, 2)` → `1.23`),
 * while Sass follows CSS `round()`, whose second argument is the STEP to round
 * to the nearest multiple of (`round(1.234, 2)` → `2`).
 *
 * Ties go through the shared core kernel, so they break away from zero as in
 * dart-sass and Less (`math.round(-2.5)` → `-3`). That rule is symmetric, so the
 * step's sign does not matter (`round(2.5, -1)` → `3`).
 */
const round = defineFunction('round', {
  params: [
    { name: 'number', type: 'Dimension' },
    { name: 'step', type: 'Dimension', optional: true }
  ] as const,
  body: (number, step) => {
    if (step === undefined) {
      return makeDimension(roundNumber(number.number), number.unit);
    }
    if (step.number === 0) {
      return makeDimension(Number.NaN, number.unit);
    }
    const multiple = roundNumber(number.number / step.number) * step.number;

    // Re-derive through the step so binary-fraction steps do not leak float dust.
    return makeDimension(Number(multiple.toPrecision(15)), number.unit || step.unit);
  }
});

export { round };
export default round;
