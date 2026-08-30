import { describe, expect, it } from 'vitest';
import type { Operation } from '@jesscss/core/ast';
import { parse } from '@jesscss/scss-parser';

/**
 * SCSS has ONE math behaviour, and this file pins it.
 *
 * `parse` takes no math option, on purpose. dart-sass has no user-settable math
 * policy: its full compile-option surface carries none, its CLI has no such
 * flag, and `slash-div` is a DEPRECATION in its registry — silenceable and
 * fatal-able, but not a mode that changes how anything parses. Ledger P5 says no
 * dialect composes on another, so SCSS does not inherit Less's `math:` either.
 *
 * Measured against dart-sass 1.101.0, which is where these expectations come
 * from rather than from our own engine:
 *
 *   (4px / 2)     ->  2px      parens are a math context
 *   4px / 2       ->  4px/2    a bare slash is a CSS separator
 *   1 + 2         ->  3        every other operator computes bare
 *
 * That is exactly `Operation.mathOutsideParens === (operator !== '/')`, which is
 * what `cssBaseMathOutsideParens` states once for every dialect without a math
 * option. This file is the ratchet: if someone re-introduces a mode for SCSS,
 * or flips the fixed answer, these go red.
 */

function deepOperation(source: string): Operation {
  const found = find(parse(source).rules);
  if (found === null) {
    throw new TypeError('no Operation in the parsed tree');
  }
  return found;
}

function find(value: unknown): Operation | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = find(item);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  if ('type' in value && value.type === 'Operation') {
    return value as Operation;
  }
  for (const item of Object.values(value)) {
    const found = find(item);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

describe('SCSS math is FIXED — there is no mode to pass', () => {
  it('a non-slash operator computes with no enclosing math context', () => {
    expect(deepOperation('.a { k: 1 + 2; }').mathOutsideParens).toBe(true);
    expect(deepOperation('.a { k: 3 * 4; }').mathOutsideParens).toBe(true);
    expect(deepOperation('.a { k: 5 - 1; }').mathOutsideParens).toBe(true);
  });

  it('a slash does NOT, because `/` is also a CSS separator', () => {
    expect(deepOperation('.a { k: (4px / 2); }').mathOutsideParens).toBe(false);
  });

  it('unary minus computes bare', () => {
    expect(deepOperation('$x: 3px; .a { k: -$x; }').mathOutsideParens).toBe(true);
  });

  /*
   * The signature itself is the ratchet against a mode creeping back: `parse`
   * takes exactly one argument. A second parameter would make this stop
   * compiling, which is the point.
   */
  it('parse takes source and nothing else', () => {
    expect(parse.length).toBe(1);
  });
});
