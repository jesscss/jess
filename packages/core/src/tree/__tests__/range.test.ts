import { describe, expect, it } from 'vitest';
import { num, range } from '../index.js';

describe('Range', () => {
  it('renders range syntax through toTrimmedString()', () => {
    expect(range({
      start: num(1),
      end: num(3),
      step: num(2)
    }, {
      includeEnd: false
    }).toTrimmedString()).toBe('1 to <3 step 2');
  });

  it('serializes inclusive/exclusive range boundaries canonically', () => {
    expect(`${range({
      start: num(1),
      end: num(3)
    }, {
      includeStart: false,
      includeEnd: false
    })}`).toBe('1> to <3');
  });
});
