import { describe, it, expect } from 'vitest';
import { invoke } from '../../__tests__/harness.js';
import { makeKeyword, makeQuoted } from '@jesscss/core';
import { lessFns } from '../registry.js';
import { e } from '../e.js';

describe('e()', () => {
  it('returns an escaped string, written with ", for quoted and unquoted values', () => {
    const quoted = makeQuoted('hello', '"', false);
    const ident = makeKeyword('world');

    expect(invoke(e, quoted)).toEqual({ type: 'Any', bytes: 'hello', escapedQuote: '"', groups: 0 });
    expect(invoke(e, ident)).toEqual({ type: 'Any', bytes: 'world', escapedQuote: '"', groups: 0 });
  });

  it('uses the canonical implementation registered for Less', () => {
    expect(lessFns.find(fn => fn.name === 'e')).toBe(e);
  });
});
