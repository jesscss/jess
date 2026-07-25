import { describe, it, expect } from 'vitest';
import { makeKeyword, makeQuoted } from '@jesscss/core/value';
import { lessFns } from '../registry.js';
import { e } from '../e.js';

describe('e()', () => {
  it('returns unquoted value for Quoted and unchanged node otherwise', () => {
    const quoted = makeQuoted('hello');
    const ident = makeKeyword('world');

    expect(e(quoted)).toMatchObject({ type: 'Keyword', bytes: 'hello' });
    expect(e(ident)).toBe(ident);
  });

  it('uses the canonical implementation registered for Less', () => {
    expect(lessFns.find(fn => fn.name === 'e')).toBe(e);
  });
});
