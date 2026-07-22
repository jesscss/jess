import { defineFunction, makeDimension, round as roundNumber } from '@jesscss/core/value';

/**
 * Less `round(value, precision = 0)` and Sass `math.round(value)` over the
 * canonical value domain. Sass's optional argument is retained as a harmless
 * shared capability so Less keeps its documented precision behavior.
 */
const round = defineFunction('round', {
  params: [
    { name: 'value', kinds: ['Dimension'] },
    { name: 'precision', kinds: ['Dimension'], optional: true }
  ] as const,
  body: (value, precision) => makeDimension(
    roundNumber(value.number, precision?.number ?? 0),
    value.unit
  )
});

export { round };
export default round;
