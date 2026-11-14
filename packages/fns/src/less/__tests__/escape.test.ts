import { describe, expect, it } from 'vitest';
import { ctx } from '../../__tests__/harness.js';
import { makeQuoted } from '@jesscss/core';
import { lessFns } from '../registry.js';
import { escape } from '../escape.js';

describe('escape()', () => {
  it('URL-encodes a typed value using the canonical value callable', () => {
    const result = escape([makeQuoted('a b=x:y#z;()', '"', false)], ctx);

    expect(result).toEqual({
      type: 'Any',
      bytes: 'a%20b%3Dx%3Ay%23z%3B%28%29',
      escapedQuote: '',
      groups: 0
    });
  });

  it('uses the canonical implementation registered for Less', () => {
    expect(lessFns.find(fn => fn.name === 'escape')).toBe(escape);
  });
});
