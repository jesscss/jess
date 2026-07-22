import { defineFunction, makeDimension } from '@jesscss/core/value';

/**
 * Less `range()` — build a numeric list. With one argument, `1…start`; with two,
 * `start…end`; an optional `step` sets the increment.
 * @param start range end (one-arg form) or start (multi-arg form)
 * @param end optional inclusive end
 * @param step optional increment (default `1`, may not be `0`)
 * @returns a default-spaced group of `Dimension`s carrying the end value's unit
 * @throws `RangeError` if `step` is `0`
 */
const range = defineFunction('range', {
  params: [{ name: 'start', kinds: ['Dimension'] }, { name: 'end', kinds: ['Dimension'], optional: true }, { name: 'step', kinds: ['Dimension'], optional: true }] as const,
  body: (start, end, step) => {
    let from: number;
    const to = end ?? start;
    const stepValue = step?.number ?? 1;
    if (stepValue === 0) {
      throw new RangeError('range() step cannot be 0');
    }

    if (end !== undefined) {
      from = start.number;
    } else {
      from = 1;
    }

    const out = [];
    for (let i = from; i <= to.number; i += stepValue) {
      out.push(makeDimension(i, to.unit));
    }
    return out;
  }
});

export default range;
