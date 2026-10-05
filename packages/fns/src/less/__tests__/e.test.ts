import { describe, it, expect } from 'vitest';
import { makeKeyword, makeQuoted } from '@jesscss/core';
import { lessFns } from '../registry.js';
import { e } from '../e.js';

describe('e()', () => {
  it('returns an escaped string, written with ", for quoted and unquoted values', () => {
    const quoted = makeQuoted('hello');
    const ident = makeKeyword('world');

    expect(e(quoted)).toEqual({ type: 'Any', bytes: 'hello', escapedQuote: '"' });
    expect(e(ident)).toEqual({ type: 'Any', bytes: 'world', escapedQuote: '"' });
  });

  it('uses the canonical implementation registered for Less', () => {
    expect(lessFns.find(fn => fn.name === 'e')).toBe(e);
  });
});
