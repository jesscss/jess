import { defineFunction, makeDimension, round as roundNumber } from '@jesscss/core/value';

/** Less `round(value, precision = 0)` — canonical value-domain callable. */
const round = defineFunction('round', {
  params: [
    { name: 'value', kinds: ['Dimension'] },
    { name: 'precision', kinds: ['Dimension'], optional: true }
  ] as const,
  body: (value, precision) => {
    return makeDimension(roundNumber(value.number, precision?.number ?? 0), value.unit);
  }
});

export { round };
export default round;
