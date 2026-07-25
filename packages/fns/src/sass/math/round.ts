import { defineFunction, makeDimension } from '@jesscss/core/value';

/**
 * Sass `math.round($number)` / the global `round()`.
 *
 * NOT the same function as Less's `round`, which is why this is dialect-owned:
 * Less's second argument is DECIMAL PRECISION (`round(1.234, 2)` → `1.23`),
 * while Sass follows CSS `round()`, whose second argument is the STEP to round
 * to the nearest multiple of (`round(1.234, 2)` → `2`).
 *
 * Half-way values round away from zero, matching `math.round(-2.5)` → `-3`.
 */
const roundHalfAwayFromZero = (n: number): number =>
  n < 0 ? -Math.round(-n) : Math.round(n);

const round = defineFunction('round', {
  params: [
    { name: 'number', kinds: ['Dimension'] },
    { name: 'step', kinds: ['Dimension'], optional: true }
  ] as const,
  body: (number, step) => {
    if (step === undefined) {
      return makeDimension(roundHalfAwayFromZero(number.number), number.unit);
    }
    if (step.number === 0) {
      return makeDimension(Number.NaN, number.unit);
    }
    const multiple = roundHalfAwayFromZero(number.number / step.number) * step.number;
    // Re-derive through the step so binary-fraction steps do not leak float dust.
    return makeDimension(Number(multiple.toPrecision(15)), number.unit || step.unit);
  }
});

export { round };
export default round;
