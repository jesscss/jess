import { defineFunction, makeDimension, round as roundNumber } from '@jesscss/core';

/**
 * Less `round(value, precision = 0)` — the second argument is DECIMAL PRECISION.
 *
 * Not shared with Sass: `math.round`'s second argument is a step to round to the
 * nearest multiple of, so `round(1.234, 2)` is `1.23` in Less and `2` in Sass.
 * Body is unchanged from when this lived in `shared/`; only ownership moved.
 */
const round = defineFunction('round', {
  params: [
    { name: 'value', type: 'Dimension' },
    { name: 'precision', type: 'Dimension', optional: true }
  ] as const,
  body: (value, precision) => makeDimension(
    roundNumber(value.number, precision?.number ?? 0),
    value.unit
  )
});

export { round };
export default round;
