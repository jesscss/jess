import { describe, expect, it } from 'vitest';
import { ctx } from '../../__tests__/harness.js';
import { makeKeyword, makeList, makeQuoted } from '@jesscss/core';
import { lessFns } from '../registry.js';
import { escape } from '../escape.js';

describe('escape()', () => {
  it('URL-encodes a typed value using the canonical value callable', () => {
    const result = escape(makeList([makeQuoted('a b=x:y#z;()', '"', false)], ','), ctx);

    expect(result).toEqual({
      type: 'Any',
      bytes: 'a%20b%3Dx%3Ay%23z%3B%28%29',
      escapedQuote: ''
    });
  });

  it('uses the canonical implementation registered for Less', () => {
    expect(lessFns.find(fn => fn.name === 'escape')).toBe(escape);
  });

  it('does not accept a non-list direct call for this variadic function', () => {
    expect(() => Reflect.apply(escape, undefined, [makeKeyword('value')])).toThrow('direct calls to variadic functions require a List and FnCtx');
  });
});
