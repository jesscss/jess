import { defineFunction, Dimension, Sequence } from '@jesscss/core';

/**
 * Less `range()` — build a numeric list. With one argument, `1…start`; with two,
 * `start…end`; an optional `step` sets the increment.
 * @param start range end (one-arg form) or start (multi-arg form)
 * @param end optional inclusive end
 * @param step optional increment (default `1`, may not be `0`)
 * @returns a `Sequence` of `Dimension`s carrying the end value's unit
 * @throws `RangeError` if `step` is `0`
 */
const range = defineFunction(
  'range',
  function(start: Dimension, end?: Dimension, step?: Dimension): Sequence {
    let from: number;
    let to: Dimension;
    let stepValue = step?.number ?? 1;
    if (stepValue === 0) {
      throw new RangeError('range() step cannot be 0');
    }

    if (end) {
      from = start.number;
      to = end;
    } else {
      from = 1;
      to = start;
    }

    const out: Dimension[] = [];
    for (let i = from; i <= to.number; i += stepValue) {
      out.push(new Dimension({
        number: i,
        unit: to.unit
      }));
    }
    return new Sequence(out);
  },
  {
    params: [{
      name: 'start',
      type: Dimension
    }, {
      name: 'end',
      type: Dimension,
      optional: true
    }, {
      name: 'step',
      type: Dimension,
      optional: true
    }]
  }
);

export default range;
